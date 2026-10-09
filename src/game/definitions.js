// Central tunable data for the prototype factory. Adding a resource, machine
// recipe, or goal is done here — the rest of the game reads from these tables.

// ---- Character budget -------------------------------------------------------
// Base budget. Each completed goal may raise the ceiling via `unlocks.budget`
// (see GOALS below); `budgetFor(goals)` is the single source of truth for the
// currently-allowed length.
export const MAX_CHARS = 100;

// ---- Interpreter safety limits ---------------------------------------------
export const MAX_STEPS = 100000; // op budget per Run (blocks runaway programs)
export const MAX_MACHINES = 200; // most machine instances a single program can build

// ---- Simulation -------------------------------------------------------------
export const SIM_HZ = 60;            // fixed simulation timestep rate
export const RATE_SMOOTHING = 0.12;  // exponential smoothing for displayed rates
export const STATUS_EPS = 0.01;      // factor below which a machine is 'stalled'
export const ACTIVE_EPS = 0.99;      // factor above which a machine is 'active'

// ---- Deploy pipeline (git-like: edits only land when pushed) ----------------
export const PUSH_SECONDS = 15;      // transfer time after pressing Push
export const COMPILE_SECONDS = 15;   // build time after the transfer completes

// ---- Resources (shared stockpiles) -----------------------------------------
// key -> { key, label, sourceRate, mineable, unlockAfterGoal? }
// sourceRate is the FREE inflow from a natural source (all 0: nothing is free).
// mineable resources can be extracted with miner(<resource>); non-mineable ones
// must be produced by a recipe machine.
// `unlockAfterGoal` gates the UI: materials whose goal isn't complete render
// as "???" in the stockpile sheet with no tooltip, so unrevealed systems
// don't leak their names before the player reaches them.
export const RESOURCES = {
  ironOre:   { key: 'ironOre',   label: 'Iron Ore',    sourceRate: 0, mineable: true },
  coal:      { key: 'coal',      label: 'Coal',        sourceRate: 0, mineable: true },
  ironPlates:{ key: 'ironPlates',label: 'Iron Plates', sourceRate: 0, mineable: false },
  conductors: {
    key: 'conductors',
    label: 'Conductors',
    sourceRate: 0,
    mineable: false,
    unlockAfterGoal: 'scaled-plates', // first intermediate: revealed with research
  },
  researchPoints: {
    key: 'researchPoints',
    label: 'Research Points',
    sourceRate: 0,
    mineable: false,
    unlockAfterGoal: 'scaled-plates', // revealed once the crafter goal lands
  },
};

// A miner produces its target resource at this rate (items/s) with no inputs.
export const MINE_RATE = 1;

// ---- Machines ---------------------------------------------------------------
// Recipe machines draw inputs from shared stockpiles and push their product to
// a shared or independently named output. Miners are built separately via the
// miner(resource) stdlib call, so they are not listed here.
// Fields that drive progression:
//   craftable:      true = `crafter("<output>")` can build this recipe.
//                   false = only the dedicated builder function works.
//   requiresFeature: gate the builder behind a feature key (lab / researchCenter
//                   appear once `crafter` unlocks, i.e. after the pre-research
//                   goal). Locked builders throw a friendly feature error.
export const MACHINES = {
  smelter: {
    type: 'smelter',
    label: 'Smelter',
    inputs: [
      { resource: 'ironOre', rate: 1 },    // per second, at full capacity
      { resource: 'coal',    rate: 0.25 },
    ],
    output: { resource: 'ironPlates', rate: 1 },
    defaultOutput: 'ironPlates', // shared stockpile used when no name given
    upgradeTarget: 'smelter',    // throughput upgrades multiply this machine type
    craftable: false,            // plates are smelter-only by design
  },
  lab: {
    type: 'lab',
    label: 'Laboratory',
    inputs: [
      { resource: 'conductors',   rate: 0.5 },
      { resource: 'ironPlates',   rate: 0.5 },
    ],
    output: { resource: 'researchPoints', rate: 0.2 },
    defaultOutput: 'researchPoints',
    upgradeTarget: 'lab',
    craftable: true,
    requiresFeature: 'crafter',
  },
  // Extruder converts plates + coal into the conductors labs need. Sits between
  // smelters and labs so research requires a real production chain rather
  // than "plates and coal again".
  extruder: {
    type: 'extruder',
    label: 'Extruder',
    inputs: [
      { resource: 'ironPlates', rate: 2 },
      { resource: 'coal',       rate: 0.5 },
    ],
    output: { resource: 'conductors', rate: 0.5 },
    defaultOutput: 'conductors',
    upgradeTarget: 'extruder',
    craftable: true,
    requiresFeature: 'crafter',
  },
  // The Research Center stores research: it consumes points without producing
  // an item - whatever it consumes accumulates in the stockpile's `stored`
  // amount, which is what research upgrades spend from.
  researchCenter: {
    type: 'researchCenter',
    label: 'Research Center',
    inputs: [
      { resource: 'researchPoints', rate: 0.4 },
    ],
    output: null,                // sink machine: consumes, stores, outputs nothing
    defaultOutput: null,
    store: 'researchPoints',     // material whose consumption is stored
    upgradeTarget: null,
    craftable: false,            // sink, not a recipe
    requiresFeature: 'crafter',
  },
};

// ---- Research upgrades --------------------------------------------------------
// Research never unlocks new functions (that stays the goals' job) - it boosts
// productivity/efficiency via global throughput multipliers on machine types.
// Upgrades are purchased from STORED research and must be bought in order.
export const UPGRADES = [
  {
    id: 'smelterBoost',
    name: 'Better Bellows',
    desc: 'Smelters run twice as fast.',
    cost: 20,
    effect: { kind: 'throughput', target: 'smelter', factor: 2 },
  },
  {
    id: 'extruderBoost',
    name: 'Heated Dies',
    desc: 'Extruders run twice as fast.',
    cost: 30,
    effect: { kind: 'throughput', target: 'extruder', factor: 2 },
  },
  {
    id: 'minerBoost',
    name: 'Reinforced Drills',
    desc: 'Miners extract twice as fast.',
    cost: 40,
    effect: { kind: 'throughput', target: 'miner', factor: 2 },
  },
];

// True when every upgrade has been purchased (used by the final goal).
export function allUpgradesComplete(world) {
  return world.upgradesDone.length >= UPGRADES.length;
}

// Functions exposed to player code (recipe machines; `miner` lives in stdlib).
export const FUNCTION_NAMES = Object.keys(MACHINES); // ['smelter']

// ---- Recipes ----------------------------------------------------------------
// Derived view of MACHINES keyed by OUTPUT resource, restricted to machines
// explicitly marked `craftable: true`. That means ironPlates is NOT a recipe
// (smelter-only by design) while researchPoints IS. Sinks are also excluded
// because they consume rather than produce.
export const RECIPES = Object.fromEntries(
  Object.values(MACHINES)
    .filter((m) => m.output && m.craftable)
    .map((m) => [
      m.output.resource,
      {
        key: m.output.resource,
        label: RESOURCES[m.output.resource]?.label || m.output.resource,
        inputs: m.inputs,
        output: m.output,
        upgradeTarget: m.upgradeTarget,
        viaMachine: m.type,
      },
    ]),
);

// Find the machine definition that produces `resourceKey`, regardless of
// whether it's craftable. Used by the stockpile tooltip to say "made by
// smelter()" for plates but "crafter(\"researchPoints\") or lab()" for rp.
function producerFor(resourceKey) {
  return Object.values(MACHINES).find((m) => m.output && m.output.resource === resourceKey) || null;
}

// Human-readable tooltip line for a stockpile row.
//   mineable     -> miner()
//   craftable    -> recipe inputs/outputs + crafter("<key>") or its dedicated builder
//   non-craftable-> "made by <builder>()" (no recipe line, keeps smelter as THE plate source)
//   sink storage -> special-cased so researchPoints mentions the researchCenter
// Returns null for unknown keys and for locked resources (their row is hidden
// behind "???" so no tooltip is shown either).
export function resourceHint(resourceKey, goals) {
  const res = RESOURCES[resourceKey];
  if (!res) return null;
  if (!isResourceRevealed(resourceKey, goals)) return null;
  if (res.mineable) return `${res.label}: mine with miner(${resourceKey})`;
  if (resourceKey === 'researchPoints') {
    return 'Research Points: lab() or crafter("researchPoints") consumes conductors + iron plates; researchCenter() banks them.';
  }
  if (resourceKey === 'conductors') {
    return 'Conductors: extruder() or crafter("conductors") pulls them from iron plates + coal. Labs need them.';
  }
  const producer = producerFor(resourceKey);
  if (!producer) return res.label;
  if (producer.craftable) {
    const ins = producer.inputs.map((i) => `${RESOURCES[i.resource]?.label || i.resource} ${i.rate}/s`).join(' + ');
    return `${ins} → ${res.label} ${producer.output.rate}/s  ·  build with ${producer.type}() or crafter("${resourceKey}")`;
  }
  // Non-craftable producer (e.g. ironPlates): hint the dedicated builder only.
  const ins = producer.inputs.map((i) => `${RESOURCES[i.resource]?.label || i.resource} ${i.rate}/s`).join(' + ');
  return `${ins} → ${res.label} ${producer.output.rate}/s  ·  build with ${producer.type}()`;
}

// Back-compat wrapper used elsewhere (kept for anything already importing it).
export function recipeHintText(resourceKey) {
  const r = RECIPES[resourceKey];
  if (!r) return null;
  const ins = r.inputs.map((i) => `${RESOURCES[i.resource]?.label || i.resource} ${i.rate}/s`).join(' + ');
  return `${ins} → ${r.label} ${r.output.rate}/s  ·  build with crafter("${resourceKey}")`;
}

// Is a resource past its unlock gate? Rows with an `unlockAfterGoal` id stay
// hidden behind "???" until that goal is marked complete in store.goals.
export function isResourceRevealed(resourceKey, goals) {
  const res = RESOURCES[resourceKey];
  if (!res) return false;
  const gate = res.unlockAfterGoal;
  if (!gate) return true;
  return !!(goals && goals.some((g) => g.id === gate && g.complete));
}

// ---- Goals ------------------------------------------------------------------
// Progression checkpoint leading into research. Each goal can carry `unlocks`
// which `main.js` applies on completion:
//   unlocks.features: string[]  -> flips FEATURES flags (loops, crafter, ...)
//   unlocks.budget:   number    -> raises the character budget ceiling
//   unlocks.label:    string    -> short blurb shown on the goal card
// Design: goal 1 teaches the raw loop, goal 2 rewards scaling with `crafter`,
// goal 3 opens research, goal 4 spends it.
export const GOALS = [
  {
    id: 'first-plates',
    title: 'Produce 50 Iron Plates',
    detail: 'Mine iron ore + coal, smelt them into 50 iron plates.',
    target: { stockpile: 'ironPlates', amount: 50 },
    unlocks: { features: ['loops'], budget: 150, label: 'Loops + a slightly bigger budget' },
  },
  {
    id: 'scaled-plates',
    title: 'Produce 500 Iron Plates',
    detail: 'Manual smelter() calls no longer fit the budget - use a for-loop to scale: for (var i = 0; i < 5; i = i + 1) { smelter(); }',
    target: { stockpile: 'ironPlates', amount: 500 },
    unlocks: { features: ['crafter'], budget: 210, label: 'crafter(recipe) + reveal research' },
  },
  {
    id: 'first-research',
    title: 'Store 20 Research Points',
    detail: 'Chain it up: smelter() -> extruder() -> lab(), with a researchCenter() banking the points. Each center absorbs 0.4/s, so loop multiple centers if you scale labs.',
    target: { stockpile: 'researchPoints', metric: 'stored', amount: 20 },
    unlocks: { features: [], budget: 260, label: 'Bigger budget for larger factories' },
  },
  {
    id: 'apply-research',
    title: 'Complete All Research',
    detail: 'Spend stored research points on every upgrade in the Research panel.',
    target: { type: 'upgrades' },
    unlocks: { features: [], budget: 300, label: 'Checkpoint cleared - final budget' },
  },
];

// Current character budget: base MAX_CHARS, raised by any completed goal that
// grants a bigger one. Reading from the store.goals clone (which carries the
// `unlocks` field via spread) keeps this reactive to progress.
export function budgetFor(goals) {
  let b = MAX_CHARS;
  for (const g of goals) {
    const u = g.unlocks?.budget;
    if (g.complete && typeof u === 'number' && u > b) b = u;
  }
  return b;
}

// The starter program is intentionally OVER budget: the player's first lesson
// is that comments cost characters, so they must trim it down to fit before
// the factory will build.
export const DEFAULT_PROGRAM = `// CODE FACTORY - your code IS the factory.
// Comments cost characters too - trim what you don't need!

miner(ironOre);   // mine iron ore
miner(coal);      // mine coal for fuel
smelter();        // iron ore + coal -> iron plates

// GOAL 1: 50 iron plates. Later goals unlock loops, crafter() and research.
`;
