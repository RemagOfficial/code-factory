// The factory model produced by running a program. Pure data + a few helpers;
// the simulation mutates the amounts/status on an existing World.

import { RESOURCES, UPGRADES, MACHINES, MINE_RATE } from './definitions.js';

let machineSeq = 0;
export function resetMachineSeq() {
  machineSeq = 0;
}

// A stockpile is either a shared resource pool or an independent named output.
function makeStockpile(key, label, kind, sourceRate = 0) {
  return {
    key,
    label,
    kind,            // 'resource' | 'named'
    sourceRate,      // continuous inflow from a resource source (per second)
    amount: 0,
    stored: 0,       // cumulative amount absorbed by sink machines (e.g. research)
    netRate: 0,      // smoothed production - consumption (items/s)
    producers: [],   // machine ids that add to this
    consumers: [],   // machine ids that draw from this
  };
}

export function createWorld() {
  const stockpiles = {};

  // Seed shared resource stockpiles from definitions.
  for (const r of Object.values(RESOURCES)) {
    stockpiles[r.key] = makeStockpile(r.key, r.label, 'resource', r.sourceRate);
  }

  return {
    stockpiles,          // key -> stockpile
    machines: [],        // machine instances
    edges: [],           // { from, to, kind, resource } for graph rendering
    multipliers: {},     // upgradeTarget -> throughput factor (research upgrades)
    upgradesDone: [],    // purchased UPGRADE ids
    ensureNamed(key) {
      if (!this.stockpiles[key]) {
        this.stockpiles[key] = makeStockpile(key, key, 'named', 0);
      }
      return this.stockpiles[key];
    },
  };
}

// Create a machine instance from a recipe definition object (a MACHINES entry or
// a generated miner def) and wire it to stockpiles. `outputName` selects an
// independent named output; when omitted the definition's default shared
// stockpile is used. Definitions with `output: null` are sinks (they store
// instead of produce) and take no output name.
export function addMachine(world, def, outputName) {
  const isSink = !def.output;
  const destKey = isSink ? null : (outputName || def.defaultOutput);
  if (!isSink) {
    if (outputName) world.ensureNamed(outputName);
    if (!world.stockpiles[destKey]) world.ensureNamed(destKey);
  }

  // Research upgrades scale this machine's whole throughput.
  const tp = throughputFor(world, def);

  const id = `m${machineSeq++}`;
  const machine = {
    id,
    type: def.type,
    label: def.label,
    outputName: outputName || null,   // null => shared default
    destKey,
    inputs: def.inputs.map((i) => ({ ...i, rate: i.rate * tp })),
    store: def.store || null,         // sink: stockpile whose consumption is stored
    outputRate: isSink ? 0 : def.output.rate * tp,
    outputResource: isSink ? null : def.output.resource,
    // Snapshot of the base recipe so recomputeThroughputs can rescale any
    // machine (including crafter()s) without a MACHINES[type] lookup.
    baseInputs: def.inputs.map((i) => ({ ...i })),
    baseOutput: isSink ? null : { ...def.output },
    upgradeTarget: def.upgradeTarget || null,
    status: 'active',      // 'active' | 'throttled' | 'stalled'
    factor: 0,             // last throttle factor (0..1)
    actualRate: 0,         // smoothed actual output items/s
    capacityRate: isSink ? 0 : def.output.rate * tp, // theoretical max output items/s
  };

  world.machines.push(machine);

  // Register graph edges + stockpile participation.
  for (const inp of machine.inputs) {
    world.edges.push({ from: inp.resource, to: id, kind: 'input', resource: inp.resource });
    world.stockpiles[inp.resource]?.consumers.push(id);
  }
  if (!isSink) {
    world.edges.push({ from: id, to: destKey, kind: 'output', resource: def.output.resource });
    world.stockpiles[destKey].producers.push(id);
  }

  return machine;
}

// Which upgrade track a machine type belongs to ('miner', or the recipe's
// upgradeTarget). Null when a machine is not affected by any upgrade.
function targetFor(type) {
  if (type === 'miner') return 'miner';
  return MACHINES[type]?.upgradeTarget || null;
}

// Current throughput factor for a machine definition, from purchased research.
export function throughputFor(world, def) {
  const target = def.type === 'miner' ? 'miner' : def.upgradeTarget;
  return (target && world.multipliers[target]) || 1;
}

// The miner recipe is generated in stdlib; mirror its base definition here so
// upgrades can rescale running miners by type.
function baseDefForType(type) {
  if (type === 'miner') {
    return { type: 'miner', inputs: [], output: { rate: MINE_RATE }, upgradeTarget: 'miner' };
  }
  return MACHINES[type] || null;
}

// Idempotently rebuild every machine's rates as base * its track multiplier.
// Called on purchase and after a redeploy (when multipliers are carried over),
// so rates never drift from repeated scaling.
export function recomputeThroughputs(world) {
  for (const m of world.machines) {
    // Prefer the base recipe captured on the machine itself (crafters built via
    // crafter() have no MACHINES entry keyed by 'crafter', so they must carry
    // their own recipe snapshot).
    const baseInputs = m.baseInputs || baseDefForType(m.type)?.inputs || m.inputs;
    const baseOutput = m.baseOutput || baseDefForType(m.type)?.output || null;
    const target = m.upgradeTarget || (baseDefForType(m.type) || {}).upgradeTarget || null;
    const tp = (target && world.multipliers[target]) || 1;
    m.inputs.forEach((inp, i) => { inp.rate = (baseInputs[i]?.rate ?? 0) * tp; });
    if (baseOutput) {
      m.outputRate = baseOutput.rate * tp;
      m.capacityRate = m.outputRate;
    } else {
      m.outputRate = 0;
      m.capacityRate = 0;
    }
  }
  return world;
}

// Purchase an upgrade from STORED research points. Returns true on success.
export function buyUpgrade(world, id) {
  const index = world.upgradesDone.length;
  const up = UPGRADES[index];
  if (!up || up.id !== id) return false;              // must buy in order
  const sp = world.stockpiles.researchPoints;
  if (!sp || sp.stored < up.cost) return false;        // not enough stored research
  sp.stored -= up.cost;
  world.upgradesDone.push(up.id);
  if (up.effect.kind === 'throughput') {
    world.multipliers[up.effect.target] = (world.multipliers[up.effect.target] || 1) * up.effect.factor;
    recomputeThroughputs(world);
  }
  return true;
}
