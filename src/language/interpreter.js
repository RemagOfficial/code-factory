// Tree-walking interpreter for the Code Factory mini-language.
//
// Design guarantees:
//  - Deterministic and isolated: the only names in scope are the resource
//    stockpiles and the stdlib functions. No browser / global access.
//  - Feature-gated: constructs present in `features.js` as locked still parse,
//    but executing them raises a friendly "not unlocked" error.
//  - Budgeted: a step counter blocks runaway programs; the stdlib blocks
//    excessive machine counts.

import { parse } from './parser.js';
import { createWorld, resetMachineSeq } from '../game/world.js';
import { createStdlib } from './stdlib.js';
import { RESOURCES, MACHINES, MAX_STEPS } from '../game/definitions.js';
import { NODE_FEATURE, isUnlocked } from './features.js';
import { CodeError, featureLocked, unknownIdentifier, limitExceeded, validationError } from './errors.js';

class Scope {
  constructor(parent = null) {
    this.vars = new Map();
    this.parent = parent;
  }
  lookup(name) {
    if (this.vars.has(name)) return this.vars.get(name);
    if (this.parent) return this.parent.lookup(name);
    return undefined;
  }
  has(name) {
    if (this.vars.has(name)) return true;
    return this.parent ? this.parent.has(name) : false;
  }
  define(name, value) { this.vars.set(name, value); }
  assign(name, value) {
    if (this.vars.has(name)) { this.vars.set(name, value); return; }
    if (this.parent) { this.parent.assign(name, value); return; }
    throw validationError(`Variable '${name}' is not declared. Use 'var ${name} = ...' first.`, null);
  }
}

class Interpreter {
  constructor() {
    this.steps = 0;
  }

  tick(line) {
    if (++this.steps > MAX_STEPS) {
      throw limitExceeded(`Program ran too long (over ${MAX_STEPS} steps). Check for an endless loop.`, line);
    }
  }

  run(source) {
    resetMachineSeq();
    const ast = parse(source);
    const world = createWorld();
    const stdlib = createStdlib(world);

    const global = new Scope();
    // Resource identifiers resolve to their stockpile key (a stable string).
    for (const r of Object.values(RESOURCES)) global.define(r.key, r.key);

    for (const stmt of ast.body) this.runStatement(stmt, global, stdlib);
    return world;
  }

  // ---- Statements ----
  runStatement(node, scope, stdlib) {
    this.tick(node.line);

    // Gate whole statement categories that are parsed but not yet unlocked.
    const featureKey = NODE_FEATURE[node.type];
    if (featureKey && !isUnlocked(featureKey)) {
      throw featureLocked(labelFor(node.type), node.line);
    }

    switch (node.type) {
      case 'VarDeclaration': {
        const value = node.init ? this.evalNode(node.init, scope, stdlib) : null;
        scope.define(node.name, value);
        return;
      }
      case 'ExpressionStatement':
        this.evalNode(node.expression, scope, stdlib);
        return;
      case 'BlockStatement': {
        const inner = new Scope(scope);
        for (const s of node.body) this.runStatement(s, inner, stdlib);
        return;
      }
      case 'IfStatement': {
        // Reachable only once conditionals are unlocked.
        if (this.truthy(this.evalNode(node.test, scope, stdlib))) {
          this.runStatement(node.consequent, new Scope(scope), stdlib);
        } else if (node.alternate) {
          this.runStatement(node.alternate, new Scope(scope), stdlib);
        }
        return;
      }
      case 'ForStatement': {
        // Reachable only once loops are unlocked.
        const loopScope = new Scope(scope);
        if (node.init) this.runStatement(node.init, loopScope, stdlib);
        while (node.test == null || this.truthy(this.evalNode(node.test, loopScope, stdlib))) {
          this.tick(node.line);
          this.runStatement(node.body, new Scope(loopScope), stdlib);
          if (node.update) this.evalNode(node.update.expression, loopScope, stdlib);
        }
        return;
      }
      case 'FunctionDeclaration': {
        // Reachable only once user functions are unlocked.
        scope.define(node.name, { __userFunction: true, params: node.params, body: node.body, closure: scope });
        return;
      }
      case 'EmptyStatement':
        return;
      default:
        throw validationError(`Unsupported statement '${node.type}'.`, node.line);
    }
  }

  // ---- Expressions ----
  evalNode(node, scope, stdlib) {
    this.tick(node.line);

    switch (node.type) {
      case 'Literal':
        return node.value;

      case 'Identifier':
        return this.resolveIdentifier(node, scope, stdlib);

      case 'Assignment': {
        const value = this.evalNode(node.value, scope, stdlib);
        scope.assign(node.target.name, value);
        return value;
      }

      case 'Binary':
        return this.binary(node, scope, stdlib);

      case 'Unary': {
        const v = this.evalNode(node.argument, scope, stdlib);
        if (node.operator === '-') return -toNum(v, node.line);
        if (node.operator === '+') return toNum(v, node.line);
        if (node.operator === '!') return !this.truthy(v);
        throw validationError(`Unknown operator '${node.operator}'.`, node.line);
      }

      case 'Logical': {
        const l = this.evalNode(node.left, scope, stdlib);
        if (node.operator === '&&') return this.truthy(l) ? this.evalNode(node.right, scope, stdlib) : l;
        return this.truthy(l) ? l : this.evalNode(node.right, scope, stdlib);
      }

      case 'Conditional':
        return this.truthy(this.evalNode(node.test, scope, stdlib))
          ? this.evalNode(node.consequent, scope, stdlib)
          : this.evalNode(node.alternate, scope, stdlib);

      case 'Update': {
        const cur = toNum(this.evalNode(node.argument, scope, stdlib), node.line);
        const nextVal = node.operator === '++' ? cur + 1 : cur - 1;
        if (node.argument.type === 'Identifier') scope.assign(node.argument.name, nextVal);
        return nextVal;
      }

      case 'Member': {
        const obj = this.evalNode(node.object, scope, stdlib);
        if (obj && typeof obj === 'object') return obj[node.property];
        throw validationError(`Cannot read property '.${node.property}' of a non-object.`, node.line);
      }

      case 'Index': {
        const obj = this.evalNode(node.object, scope, stdlib);
        const idx = this.evalNode(node.index, scope, stdlib);
        if (obj && typeof obj === 'object') return obj[idx];
        throw validationError('Cannot index a non-object.', node.line);
      }

      case 'Call':
        return this.call(node, scope, stdlib);

      case 'VarDeclaration':
      case 'ExpressionStatement': {
        // A var/expression used as a value (e.g. in for init/update positions).
        if (node.expression) return this.evalNode(node.expression, scope, stdlib);
        if (node.init) { const v = this.evalNode(node.init, scope, stdlib); scope.define(node.name, v); return v; }
        return null;
      }

      default:
        throw validationError(`Unsupported expression '${node.type}'.`, node.line);
    }
  }

  resolveIdentifier(node, scope, stdlib) {
    const name = node.name;
    if (scope.has(name)) return scope.lookup(name);
    if (Object.prototype.hasOwnProperty.call(stdlib, name)) return stdlib[name];
    throw unknownIdentifier(name, node.line, this.knownNames(stdlib));
  }

  knownNames(stdlib) {
    const funcs = stdlib ? Object.keys(stdlib) : Object.keys(MACHINES);
    return [...new Set([...Object.keys(RESOURCES), ...funcs])];
  }

  binary(node, scope, stdlib) {
    const l = this.evalNode(node.left, scope, stdlib);
    const r = this.evalNode(node.right, scope, stdlib);
    switch (node.operator) {
      case '+':
        if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r);
        return toNum(l, node.line) + toNum(r, node.line);
      case '-': return toNum(l, node.line) - toNum(r, node.line);
      case '*': return toNum(l, node.line) * toNum(r, node.line);
      case '/': {
        const d = toNum(r, node.line);
        if (d === 0) throw validationError('Division by zero.', node.line);
        return toNum(l, node.line) / d;
      }
      case '==': return l == r;          // eslint-disable-line eqeqeq
      case '===': return l === r;
      case '!=': return l != r;          // eslint-disable-line eqeqeq
      case '!==': return l !== r;
      case '<': return toNum(l, node.line) < toNum(r, node.line);
      case '>': return toNum(l, node.line) > toNum(r, node.line);
      case '<=': return toNum(l, node.line) <= toNum(r, node.line);
      case '>=': return toNum(l, node.line) >= toNum(r, node.line);
      default: throw validationError(`Unknown operator '${node.operator}'.`, node.line);
    }
  }

  call(node, scope, stdlib) {
    const line = node.line;
    const args = node.args.map((a) => this.evalNode(a, scope, stdlib));

    // Direct stdlib call by bare identifier name (machine builders).
    if (node.callee.type === 'Identifier') {
      const name = node.callee.name;
      if (Object.prototype.hasOwnProperty.call(stdlib, name)) {
        return stdlib[name](args, line);
      }
      const bound = scope.has(name) ? scope.lookup(name) : undefined;
      if (bound && bound.__userFunction) return this.invokeUser(bound, args, line);
      if (bound !== undefined && typeof bound === 'function') return bound(args, line);
      if (!scope.has(name)) throw unknownIdentifier(name, line, this.knownNames(stdlib));
      throw validationError(`'${name}' is not a function.`, line);
    }

    const fn = this.evalNode(node.callee, scope, stdlib);
    if (typeof fn === 'function') return fn(args, line);
    if (fn && fn.__userFunction) return this.invokeUser(fn, args, line);
    throw validationError('Attempted to call a value that is not a function.', line);
  }

  invokeUser(fn, args, line) {
    if (args.length !== fn.params.length) {
      throw validationError(`Wrong number of arguments (expected ${fn.params.length}, got ${args.length}).`, line);
    }
    const local = new Scope(fn.closure);
    fn.params.forEach((p, i) => local.define(p, args[i]));
    this.runStatement(fn.body, local, {});
    return null;
  }

  truthy(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length > 0;
    return true;
  }
}

function toNum(v, line) {
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (Number.isNaN(n)) throw validationError(`Expected a number but got '${v}'.`, line);
  return n;
}

function labelFor(nodeType) {
  return { ForStatement: 'Loops', IfStatement: 'Conditionals', FunctionDeclaration: 'Custom functions' }[nodeType] || nodeType;
}

// Public entry point. Returns { world } on success or { errors } on failure.
export function executeProgram(source) {
  try {
    const world = new Interpreter().run(source);
    return { world, errors: [] };
  } catch (err) {
    if (err instanceof CodeError) {
      return { world: null, errors: [{ message: err.message, line: err.line, kind: err.kind }] };
    }
    // Unexpected internal error -> surface as a generic runtime message.
    return { world: null, errors: [{ message: `Internal error: ${err.message}`, line: null, kind: 'runtime' }] };
  }
}
