// Recursive-descent parser producing a small AST. It accepts the full grammar
// (including for / if / function) so those constructs give a clean "feature not
// unlocked" error at execution time rather than a confusing syntax error.

import { syntaxError } from './errors.js';
import { tokenize } from './lexer.js';

export function parse(source) {
  const tokens = tokenize(source);
  let pos = 0;

  const peek = (o = 0) => tokens[pos + o];
  const next = () => tokens[pos++];
  const isPunct = (v, o = 0) => peek(o).type === 'punct' && peek(o).value === v;
  const isKw = (v, o = 0) => peek(o).type === 'keyword' && peek(o).value === v;

  function expectPunct(v) {
    if (!isPunct(v)) throw syntaxError(`Expected '${v}' but found '${describe(peek())}'`, peek().line);
    return next();
  }
  function expectIdent() {
    if (peek().type !== 'identifier') throw syntaxError(`Expected a name but found '${describe(peek())}'`, peek().line);
    return next();
  }
  function eatPunct(v) { if (isPunct(v)) { next(); return true; } return false; }
  function eatKw(v) { if (isKw(v)) { next(); return true; } return false; }

  function describe(t) {
    if (t.type === 'eof') return 'end of input';
    return `'${t.value}'`;
  }

  // ---- Program ----
  function parseProgram() {
    const body = [];
    while (peek().type !== 'eof') body.push(parseStatement());
    return { type: 'Program', body };
  }

  // ---- Statements ----
  function parseStatement() {
    const t = peek();
    if (t.type === 'keyword') {
      switch (t.value) {
        case 'var': return parseVar();
        case 'for': return parseFor();
        case 'if': return parseIf();
        case 'function': return parseFunctionDecl();
        default: break;
      }
    }
    if (isPunct('{')) return parseBlock();
    if (isPunct(';')) { next(); return { type: 'EmptyStatement' }; }
    return parseExpressionStatement();
  }

  function parseBlock() {
    expectPunct('{');
    const body = [];
    while (!isPunct('}')) {
      if (peek().type === 'eof') throw syntaxError("Expected '}' to close block", peek().line);
      body.push(parseStatement());
    }
    expectPunct('}');
    return { type: 'BlockStatement', body };
  }

  function parseVar() {
    const kw = next(); // 'var'
    const id = expectIdent();
    let init = null;
    if (eatPunct('=')) init = parseExpression();
    else if (peek().type !== 'eof') throw syntaxError(`Expected '=' after '${id.value}'`, peek().line);
    eatSemicolon();
    return { type: 'VarDeclaration', name: id.value, init, line: kw.line };
  }

  function parseExpressionStatement() {
    const expr = parseExpression();
    eatSemicolon();
    return { type: 'ExpressionStatement', expression: expr };
  }

  function eatSemicolon() {
    if (isPunct(';')) next();
    // Newlines are not significant; missing semicolons are tolerated.
  }

  function parseFor() {
    const kw = next(); // 'for'
    expectPunct('(');
    let init = null;
    if (!isPunct(';')) {
      init = isKw('var') ? parseVarNoSemi() : { type: 'ExpressionStatement', expression: parseExpression() };
    }
    eatPunct(';');
    const test = isPunct(';') ? null : parseExpression();
    eatPunct(';');
    const update = isPunct(')') ? null : { type: 'ExpressionStatement', expression: parseExpression() };
    expectPunct(')');
    const body = parseStatement();
    return { type: 'ForStatement', init, test, update, body, line: kw.line };
  }

  function parseVarNoSemi() {
    const kw = next();
    const id = expectIdent();
    let init = null;
    if (eatPunct('=')) init = parseExpression();
    return { type: 'VarDeclaration', name: id.value, init, line: kw.line };
  }

  function parseIf() {
    const kw = next(); // 'if'
    expectPunct('(');
    const test = parseExpression();
    expectPunct(')');
    const consequent = parseStatement();
    let alternate = null;
    if (isKw('else')) { next(); alternate = parseStatement(); }
    return { type: 'IfStatement', test, consequent, alternate, line: kw.line };
  }

  function parseFunctionDecl() {
    const kw = next(); // 'function'
    const id = expectIdent();
    expectPunct('(');
    const params = [];
    while (!isPunct(')')) {
      params.push(expectIdent().value);
      if (!eatPunct(',')) break;
    }
    expectPunct(')');
    const body = parseBlock();
    return { type: 'FunctionDeclaration', name: id.value, params, body, line: kw.line };
  }

  // ---- Expressions (precedence climbing) ----
  function parseExpression() {
    // Assignment: target = value (identifier target only)
    const left = parseConditional();
    if (isPunct('=')) {
      next();
      if (left.type !== 'Identifier') throw syntaxError('Invalid assignment target', left.line || peek().line);
      const value = parseExpression();
      return { type: 'Assignment', target: left, value, line: left.line };
    }
    return left;
  }

  function parseConditional() {
    let test = parseLogical('||');
    if (isPunct('?')) {
      next();
      const cons = parseExpression();
      expectPunct(':');
      const alt = parseExpression();
      return { type: 'Conditional', test, consequent: cons, alternate: alt };
    }
    return test;
  }

  const LOGIC = ['||', '&&'];
  function parseLogical(op) {
    const idx = LOGIC.indexOf(op);
    const lower = idx + 1 < LOGIC.length ? LOGIC[idx + 1] : parseEquality;
    let left = typeof lower === 'string' ? parseLogical(lower) : lower();
    while (isPunct(op)) {
      const t = next();
      const right = typeof lower === 'string' ? parseLogical(lower) : lower();
      left = { type: 'Logical', operator: op, left, right, line: t.line };
    }
    return left;
  }

  function parseEquality() { return parseBinary(['==', '!=', '===', '!=='], parseRelational); }
  function parseRelational() { return parseBinary(['<', '>', '<=', '>='], parseAdditive); }
  function parseAdditive() { return parseBinary(['+', '-'], parseMultiplicative); }
  function parseMultiplicative() { return parseBinary(['*', '/'], parseUnary); }

  function parseBinary(ops, lower) {
    let left = lower();
    while (peek().type === 'punct' && ops.includes(peek().value)) {
      const t = next();
      const right = lower();
      left = { type: 'Binary', operator: t.value, left, right, line: t.line };
    }
    return left;
  }

  function parseUnary() {
    if (isPunct('-') || isPunct('+') || isPunct('!')) {
      const t = next();
      const arg = parseUnary();
      return { type: 'Unary', operator: t.value, argument: arg, line: t.line };
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let expr = parseCallMember();
    if (isPunct('++') || isPunct('--')) {
      const t = next();
      expr = { type: 'Update', operator: t.value, argument: expr, line: t.line };
    }
    return expr;
  }

  function parseCallMember() {
    let expr = parsePrimary();
    for (;;) {
      if (isPunct('(')) {
        expr = parseArgs(expr);
      } else if (isPunct('.')) {
        next();
        const prop = expectIdent();
        expr = { type: 'Member', object: expr, property: prop.value, line: prop.line };
      } else if (isPunct('[')) {
        next();
        const index = parseExpression();
        expectPunct(']');
        expr = { type: 'Index', object: expr, index, line: index.line };
      } else {
        break;
      }
    }
    return expr;
  }

  function parseArgs(callee) {
    expectPunct('(');
    const args = [];
    while (!isPunct(')')) {
      args.push(parseExpression());
      if (!eatPunct(',')) break;
    }
    const close = peek();
    if (close.type === 'eof') throw syntaxError("Expected ')' to close call", close.line);
    expectPunct(')');
    return { type: 'Call', callee, args, line: callee.line };
  }

  function parsePrimary() {
    const t = peek();
    if (t.type === 'number') { next(); return { type: 'Literal', value: t.value, line: t.line }; }
    if (t.type === 'string') { next(); return { type: 'Literal', value: t.value, line: t.line }; }
    if (t.type === 'identifier') { next(); return { type: 'Identifier', name: t.value, line: t.line }; }
    if (t.type === 'keyword' && (t.value === 'true' || t.value === 'false')) {
      next(); return { type: 'Literal', value: t.value === 'true', line: t.line };
    }
    if (isPunct('(')) {
      next();
      const e = parseExpression();
      expectPunct(')');
      return e;
    }
    throw syntaxError(`Unexpected ${describe(t)} in expression`, t.line);
  }

  return parseProgram();
}
