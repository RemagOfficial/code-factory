// The player-facing function library. These are the only callable names in the
// language besides user-defined functions. They build into a World that the
// interpreter is constructing, and respect the machine-count limit.

import { addMachine } from '../game/world.js';
import { MACHINES, RESOURCES, MINE_RATE, MAX_MACHINES, RECIPES } from '../game/definitions.js';
import { validationError, limitExceeded, featureLocked } from './errors.js';
import { isUnlocked } from './features.js';

const MINEABLE = Object.values(RESOURCES).filter((r) => r.mineable).map((r) => r.key);

// A generated recipe definition for a miner that extracts `resourceKey`.
function minerDef(resourceKey) {
  return {
    type: 'miner',
    label: `${RESOURCES[resourceKey].label} Miner`,
    inputs: [],
    output: { resource: resourceKey, rate: MINE_RATE },
    defaultOutput: resourceKey,
    upgradeTarget: 'miner',
  };
}

// A generated recipe definition for a crafter building `resourceKey` from its
// RECIPES entry. The type stays 'crafter' so the graph/detail panel can label
// it, while the upgradeTarget comes from the underlying machine so research
// upgrades (Better Bellows etc.) still apply through the same track.
function crafterDef(recipeKey) {
  const r = RECIPES[recipeKey];
  return {
    type: 'crafter',
    label: `Crafter · ${r.label}`,
    inputs: r.inputs,
    output: r.output,
    defaultOutput: r.output.resource,
    upgradeTarget: r.upgradeTarget,
  };
}

// Validate an optional named-output argument, guarding against clashes with the
// machine's own inputs and reserved names.
function parseOutputName(name, def, line) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw validationError(`Output name must be a non-empty string, e.g. smelter("myLine").`, line);
  }
  if (!isUnlocked('namedOutputs')) {
    throw validationError('Named outputs are not unlocked yet.', line);
  }
  if (RESOURCES[name] || def.inputs.some((i) => i.resource === name)) {
    throw validationError(`Output name "${name}" clashes with a reserved resource name.`, line);
  }
  return name;
}

// Returns a fresh call-environment bound to `world`.
export function createStdlib(world) {
  const functions = {};

  const assertCapacity = (line) => {
    if (world.machines.length >= MAX_MACHINES) {
      throw limitExceeded(
        `Too many machines (limit ${MAX_MACHINES} per program). Use loops once unlocked.`,
        line
      );
    }
  };

  // Every recipe machine becomes a callable builder: smelter(), lab(), etc.
  // Machines that gate behind a feature (lab & researchCenter need 'crafter')
  // throw a friendly lock error until the corresponding goal is complete.
  for (const type of Object.keys(MACHINES)) {
    const def = MACHINES[type];
    functions[type] = (args, line) => {
      if (def.requiresFeature && !isUnlocked(def.requiresFeature)) {
        throw featureLocked(`${def.label} (${type}())`, line);
      }
      assertCapacity(line);
      // Sink buildings (e.g. researchCenter) store inputs and take no output name.
      if (!def.output) {
        if (args.length > 0) {
          throw validationError(`${def.label} is a storage building and takes no output name.`, line);
        }
        return addMachine(world, def, null);
      }
      const outputName = args.length > 0 ? parseOutputName(args[0], def, line) : null;
      return addMachine(world, def, outputName);
    };
  }

  // miner(resource[, outputName]) extracts a mineable raw resource.
  functions.miner = (args, line) => {
    assertCapacity(line);
    const target = args[0];
    if (target === undefined || target === null) {
      throw validationError('miner() needs a resource to mine, e.g. miner(ironOre) or miner(coal).', line);
    }
    if (typeof target !== 'string') {
      throw validationError('miner() takes a resource name, e.g. miner(ironOre).', line);
    }
    const res = RESOURCES[target];
    if (!res) {
      throw validationError(`'${target}' is not a known resource. Mineable: ${MINEABLE.join(', ')}.`, line);
    }
    if (!res.mineable) {
      throw validationError(`${res.label} cannot be mined - it must be produced by a machine.`, line);
    }
    const outputName = args.length > 1 ? parseOutputName(args[1], { inputs: [] }, line) : null;
    return addMachine(world, minerDef(target), outputName);
  };

  // crafter(recipeName[, outputName]) builds a machine that crafts any known
  // recipe from its inputs. Unlocked by a goal; until then execution is a
  // friendly "not unlocked" error so players know it exists and what to do.
  functions.crafter = (args, line) => {
    if (!isUnlocked('crafter')) {
      throw featureLocked('crafter(recipe)', line);
    }
    assertCapacity(line);
    const name = args[0];
    if (typeof name !== 'string' || name.trim() === '') {
      throw validationError('crafter() needs a recipe name string, e.g. crafter("ironPlates").', line);
    }
    const recipe = RECIPES[name];
    if (!recipe) {
      throw validationError(
        `Unknown recipe "${name}". Known recipes: ${Object.keys(RECIPES).join(', ')}.`,
        line,
      );
    }
    const def = crafterDef(name);
    const outputName = args.length > 1 ? parseOutputName(args[1], def, line) : null;
    return addMachine(world, def, outputName);
  };

  return functions;
}

// Names the editor can autocomplete for callable functions.
export function functionCatalog() {
  const list = [
    { name: 'miner', detail: `mine a raw resource (${MINEABLE.join(', ')})`, apply: 'miner(' },
  ];
  for (const type of Object.keys(MACHINES)) {
    const def = MACHINES[type];
    const gated = def.requiresFeature && !isUnlocked(def.requiresFeature);
    const verb = def.output ? 'make' : 'build';
    const detail = gated ? `locked - complete Goal 2 to unlock` : `${verb} ${def.label}`;
    list.push({ name: type, detail, apply: `${type}(` });
  }
  // Always show crafter so players can discover it, but flag its locked state
  // in the detail blurb. Executing while locked raises a friendly error.
  const crafterDetail = isUnlocked('crafter')
    ? `craft a recipe (${Object.keys(RECIPES).join(', ')})`
    : 'locked - complete Goal 2 to unlock';
  list.push({ name: 'crafter', detail: crafterDetail, apply: 'crafter("' });
  return list;
}
