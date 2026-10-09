// Feature-gate table. The interpreter and autocomplete consult this so that
// progression is data-driven: unlocking a construct is a flag flip here, not
// a new code path. `unlocked: false` constructs still parse, but the
// interpreter raises a helpful "not unlocked yet" error when executed.
//
// Goals raise these flags from `false` to `true` when the player completes
// them (see `main.js` -> GOAL_COMPLETE handler). `resetFeatures()` restores
// the initial state so Settings -> Reset progress really wipes unlocks too.

const DEFAULTS = {
  comments:      true,
  variables:     true,
  arithmetic:    true,
  functionCalls: true,
  namedOutputs:  true,
  loops:         false,
  conditionals:  false,
  userFunctions: false,
  crafter:       false,
};

const LABELS = {
  comments:      'Comments',
  variables:     'Variables & assignment',
  arithmetic:    'Arithmetic expressions',
  functionCalls: 'Function calls',
  namedOutputs:  'Named machine outputs',
  loops:         'Loops (for)',
  conditionals:  'Conditionals (if)',
  userFunctions: 'Custom functions',
  crafter:       'crafter(recipe) function',
};

function seed() {
  const out = {};
  for (const [key, unlocked] of Object.entries(DEFAULTS)) {
    out[key] = { unlocked: !!unlocked, label: LABELS[key] };
  }
  return out;
}

// Live table read by the interpreter / stdlib / autocomplete. Mutated in place
// by `unlockFeature` (goal rewards) and re-seeded by `resetFeatures`.
export const FEATURES = seed();

// Restore the initial unlocked/locked state (used by Settings -> Reset).
// Mutates in place so anything holding a reference to FEATURES sees the reset.
export function resetFeatures() {
  const fresh = seed();
  for (const key of Object.keys(fresh)) FEATURES[key] = fresh[key];
}

// Unlock a named feature (called by goal rewards). Returns true if it flipped.
export function unlockFeature(name) {
  const f = FEATURES[name];
  if (!f || f.unlocked) return false;
  f.unlocked = true;
  return true;
}

export function isUnlocked(name) {
  const f = FEATURES[name];
  return !!f && f.unlocked;
}

// Map a locked AST node type to the feature key, for error messages.
export const NODE_FEATURE = {
  ForStatement: 'loops',
  IfStatement: 'conditionals',
  FunctionDeclaration: 'userFunctions',
};
