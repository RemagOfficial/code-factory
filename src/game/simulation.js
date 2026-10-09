// Continuous, deterministic production simulation. Decoupled from the editor:
// given a World, it advances stockpiles and machine status by dt seconds.

import {
  SIM_HZ,
  RATE_SMOOTHING,
  STATUS_EPS,
  ACTIVE_EPS,
  RESOURCES,
  UPGRADES,
} from './definitions.js';

export const SIM_DT = 1 / SIM_HZ;

// Advance the whole world by one fixed step of dt seconds.
export function step(world, dt = SIM_DT) {
  // 1) Resource sources add continuously.
  for (const sp of Object.values(world.stockpiles)) {
    if (sp.sourceRate > 0) {
      sp.amount += sp.sourceRate * dt;
    }
  }

  // 2) Machines consume then produce, throttled by what inputs are available.
  for (const m of world.machines) {
    // Throttle factor = how much of a full-capacity step every input can support.
    let factor = 1;
    for (const inp of m.inputs) {
      const sp = world.stockpiles[inp.resource];
      const required = inp.rate * dt;
      if (required <= 0) continue;
      const avail = sp ? sp.amount : 0;
      factor = Math.min(factor, avail / required);
    }
    factor = Math.max(0, Math.min(1, factor));

    // Deduct inputs at the supported fraction.
    for (const inp of m.inputs) {
      const sp = world.stockpiles[inp.resource];
      if (!sp) continue;
      const used = inp.rate * dt * factor;
      sp.amount = Math.max(0, sp.amount - used); // never negative
      // Sink machines (e.g. Research Center) bank what they consume as `stored`.
      if (m.store && inp.resource === m.store) sp.stored += used;
    }

    // Add output to its destination stockpile (sinks have no destination).
    if (m.destKey) {
      const dest = world.stockpiles[m.destKey];
      const produced = m.outputRate * dt * factor;
      if (dest) dest.amount += produced;
    }

    // Status + smoothed actual rate for the UI.
    m.factor = factor;
    m.status = factor <= STATUS_EPS ? 'stalled'
      : factor < ACTIVE_EPS ? 'throttled'
      : 'active';
    m.actualRate = smooth(m.actualRate, m.outputRate * factor);
  }

  // 3) Net rates per stockpile (production - consumption), smoothed.
  recomputeNetRates(world, dt);
}

function smooth(prev, next) {
  const a = RATE_SMOOTHING;
  return prev + (next - prev) * a;
}

// Instantaneous (this-step) production/consumption converted to items/s, then
// exponentially smoothed into each stockpile's netRate for display.
function recomputeNetRates(world, dt) {
  const prod = {};
  const cons = {};
  for (const key of Object.keys(world.stockpiles)) {
    prod[key] = 0;
    cons[key] = 0;
  }

  for (const m of world.machines) {
    if (m.destKey) {
      const outAmount = m.outputRate * dt * m.factor;
      prod[m.destKey] = (prod[m.destKey] || 0) + outAmount;
    }
    for (const inp of m.inputs) {
      cons[inp.resource] = (cons[inp.resource] || 0) + inp.rate * dt * m.factor;
    }
  }

  for (const sp of Object.values(world.stockpiles)) {
    const producedPerSec = (prod[sp.key] || 0) / dt;
    const consumedPerSec = (cons[sp.key] || 0) / dt;
    const sourcePerSec = sp.sourceRate;
    // Net = what is added (source + machine output) minus what machines draw.
    sp.netRate = smooth(sp.netRate, sourcePerSec + producedPerSec - consumedPerSec);
  }
}

// Snapshot for goals/UI: is the target met this run?
export function checkGoal(world, goal) {
  const p = goalProgress(world, goal);
  return p.have >= p.amount;
}

// Where a goal stands right now, for both completion checks and the UI.
// Goals either track a stockpile (amount, or cumulative `stored`) or overall
// research-upgrade completion.
export function goalProgress(world, goal) {
  const t = goal.target;
  if (t.type === 'upgrades') {
    return { have: world.upgradesDone.length, amount: UPGRADES.length, unit: 'upgrades' };
  }
  const sp = world.stockpiles[t.stockpile];
  const have = sp ? (t.metric === 'stored' ? sp.stored : sp.amount) : 0;
  const unit = RESOURCES[t.stockpile]?.label || t.stockpile;
  return { have, amount: t.amount, unit };
}
