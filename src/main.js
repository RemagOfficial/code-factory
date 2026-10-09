// App bootstrap: build the store + panels, wire the git-like Push/Reset flow
// (the factory always runs; edits land only after push + compile), drive the
// fixed-timestep simulation loop, and keep every view in sync with state.

import './styles/main.css';
import { createStore, EVENTS } from './game/state.js';
import { executeProgram } from './language/interpreter.js';
import { step as simStep, checkGoal, SIM_DT } from './game/simulation.js';
import { budgetFor, isResourceRevealed, PUSH_SECONDS, COMPILE_SECONDS } from './game/definitions.js';
import { buyUpgrade, recomputeThroughputs } from './game/world.js';
import { unlockFeature, resetFeatures } from './language/features.js';
import { createEditor } from './ui/editor.js';
import { createGraph } from './ui/graph.js';
import { createStockpileSheet } from './ui/stockpileSheet.js';
import { createDetailPanel } from './ui/detailPanel.js';
import { createGoals } from './ui/goals.js';
import { createResearch } from './ui/research.js';

const $ = (id) => document.getElementById(id);
const store = createStore();

// ---- Panels -----------------------------------------------------------------
const graph = createGraph({ svgEl: $('graph'), onSelect: (sel) => store.select(sel) });
const sheet = createStockpileSheet({ containerEl: $('stockpile-sheet'), onSelect: (sel) => store.select(sel) });
const detail = createDetailPanel({ containerEl: $('detail-panel') });
const goals = createGoals({ containerEl: $('goals'), hudEl: $('goal-hud') });
const research = createResearch({
  containerEl: $('research'),
  onBuy: (id) => purchaseUpgrade(id),
});
const errorList = $('error-list');

const editor = createEditor({
  mountEl: $('editor'),
  initialDoc: store.program,
  counterEl: $('char-counter'),
  getBudget: () => budgetFor(store.goals),
  onChange: (doc) => { store.program = doc; schedulePreview(); updateDeployUi(); },
  onRun: () => pushProgram(),
});

// ---- Push / Reset (git-style deploy pipeline) -------------------------------
// The factory keeps running whatever is currently deployed. Pressing Push
// validates the code IMMEDIATELY (so nobody waits 30s to hit a syntax error),
// then the snapshot goes through PUSH_SECONDS of transfer + COMPILE_SECONDS of
// building before it lands. Only one update can be in flight at a time.
let deploy = null;              // { stage:'pushing'|'compiling', endsAt, program, world }
let deployedProgram = null;     // text currently running (null = nothing pushed yet)

function pushProgram() {
  if (deploy) return; // an update is already in progress
  const source = editor.getValue();
  const budget = budgetFor(store.goals);
  if (source.length > budget) {
    showError([{ message: `Program is ${source.length} characters, over the ${budget} budget. Complete goals to raise the ceiling; comments and spaces cost characters too - delete what you do not need.`, kind: 'budget', line: null }]);
    return;
  }
  const { world, errors } = executeProgram(source);
  if (errors.length || !world) {
    showError(errors.length ? errors : [{ message: 'Could not build the factory.', kind: 'error', line: null }]);
    return; // rejected up front; keep the current factory running
  }
  clearErrors();
  deploy = { stage: 'pushing', endsAt: Date.now() + PUSH_SECONDS * 1000, program: source, world };
  // Pushing reverts the view to the live factory that keeps running meanwhile.
  viewMode = 'live';
  renderView();
  updateDeployUi();
}

// Called every frame; advances pushing -> compiling -> deployed.
// Real-time deadlines (not frame deltas) so background-tab throttling does not
// stretch the wait.
function tickDeploy() {
  if (!deploy) return;
  const now = Date.now();
  if (now >= deploy.endsAt) {
    if (deploy.stage === 'pushing') {
      deploy.stage = 'compiling';
      deploy.endsAt = now + COMPILE_SECONDS * 1000;
    } else {
      finishDeploy();
    }
  }
  updateDeployUi();
}

function finishDeploy() {
  const { program, world } = deploy;
  const old = store.world;
  // Carry accumulated + stored stock into the new layout so redeploying never
  // wipes production, goal progress, or banked research back to zero.
  for (const key of Object.keys(world.stockpiles)) {
    const oldSp = old.stockpiles[key];
    if (oldSp) {
      world.stockpiles[key].amount = oldSp.amount;
      world.stockpiles[key].stored = oldSp.stored;
    }
  }
  // Purchased research upgrades persist across deploys: copy the multipliers
  // onto the freshly built machines (built at base rate) and rescale them.
  world.multipliers = { ...old.multipliers };
  world.upgradesDone = [...old.upgradesDone];
  recomputeThroughputs(world);
  deployedProgram = program;
  deploy = null;
  store.setWorld(world); // emits FACTORY_BUILT -> live render
}

// Buy a research upgrade from the LIVE running factory's stored points. Upgrades
// are global/persistent, so this always acts on store.world, never a preview.
function purchaseUpgrade(id) {
  if (buyUpgrade(store.world, id)) {
    research.render(store.world);
    goals.render(store.goals, store.world); // completion may flip
    if (viewMode === 'live') graph.update(store.world);
  }
}

function updateDeployUi() {
  const btn = $('run-btn');
  const badge = $('deploy-status');
  if (deploy) {
    const secs = Math.max(0, Math.ceil((deploy.endsAt - Date.now()) / 1000));
    const label = deploy.stage === 'pushing' ? 'Pushing' : 'Compiling';
    btn.disabled = true;
    btn.textContent = `${label} ${secs}s`;
    badge.textContent = `Update in progress - ${label.toLowerCase()} ${secs}s`;
    badge.className = 'deploy-status deploying';
    badge.removeAttribute('role');
    badge.removeAttribute('title');
    return;
  }
  btn.disabled = false;
  btn.textContent = '\u21E7 Push';
  if (deployedProgram === null) {
    // Nothing deployed yet: the graph already shows the starter blueprint.
    badge.textContent = 'Preview - press Push to build';
    badge.className = 'deploy-status pending';
    badge.removeAttribute('role');
    badge.removeAttribute('title');
  } else if (store.program !== deployedProgram) {
    // Unpushed edits: the badge is a live <-> preview toggle.
    const previewing = viewMode === 'preview';
    badge.textContent = previewing ? '\u25C0 Viewing code - click for live factory'
                                   : '\u25B6 Changes not pushed - click to preview code';
    badge.className = `deploy-status pending toggle${previewing ? ' active' : ''}`;
    badge.setAttribute('role', 'button');
    badge.setAttribute('tabindex', '0');
    badge.title = 'Toggle between the running factory and your un-pushed code';
  } else {
    badge.className = 'deploy-status hidden';
    badge.textContent = '';
    badge.removeAttribute('role');
    badge.removeAttribute('title');
  }
}

$('run-btn').addEventListener('click', pushProgram);

// ---- Settings + progress reset (behind a warning confirmation) --------------
// Destructive actions don't live in the top bar; they go in Settings and must
// survive a confirmation popup.
const settingsOverlay = $('settings-overlay');
const confirmOverlay = $('confirm-overlay');

function openOverlay(el) { el.classList.remove('hidden'); }
function closeOverlay(el) { el.classList.add('hidden'); }
function isClosed(el) { return el.classList.contains('hidden'); }

$('settings-btn').addEventListener('click', () => openOverlay(settingsOverlay));
$('settings-close').addEventListener('click', () => closeOverlay(settingsOverlay));
// Click on the dimmed backdrop (but not the dialog) closes settings.
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeOverlay(settingsOverlay);
});

$('reset-progress-btn').addEventListener('click', () => {
  closeOverlay(settingsOverlay);
  openOverlay(confirmOverlay);
});
$('confirm-cancel').addEventListener('click', () => closeOverlay(confirmOverlay));
// The confirm dialog is deliberately NOT dismissable by backdrop click -
// destructive actions need an explicit Cancel / Yes / Escape choice.
$('confirm-ok').addEventListener('click', () => {
  closeOverlay(confirmOverlay);
  resetProgress();
});

// Escape closes the top-most open overlay.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!isClosed(confirmOverlay)) closeOverlay(confirmOverlay);
  else if (!isClosed(settingsOverlay)) closeOverlay(settingsOverlay);
});

function resetProgress() {
  deploy = null;
  deployedProgram = null;
  viewMode = 'preview'; // nothing is deployed, so show the code blueprint
  resetFeatures();      // loops / crafter go back to locked
  store.reset();
  editor.refreshCounter(); // budget falls back to the base ceiling
  clearErrors();
  renderView();
  goals.render(store.goals, store.world);
  updateResearchVisibility();
  updateDeployUi();
}

// ---- Live vs preview display ------------------------------------------------
// The graph shows EITHER the live running factory OR a static blueprint of the
// current (possibly unpushed) code. The simulation keeps running underneath no
// matter which view is shown, so flipping to preview never pauses production.
// `viewMode` is the single source of truth for which world is displayed.
let viewMode = 'live';            // 'live' | 'preview'
let previewWorld = null;          // last valid blueprint built from the editor text
let previewTimer = null;
let displayWorld = store.world;   // whatever the panels are currently showing

function pendingChanges() {
  return deployedProgram !== null && store.program !== deployedProgram && !deploy;
}

// Rebuild the blueprint from current code. Cheap enough to run synchronously on
// toggle; debounced on typing so it stays fresh while previewing.
function rebuildPreview() {
  const { world, errors } = executeProgram(store.program);
  if (errors.length || !world) return false; // keep last valid blueprint on errors
  previewWorld = world;
  return true;
}

// Render the currently-selected view. Live = running factory; preview = blueprint.
function renderView() {
  if (viewMode === 'preview') rebuildPreview();
  const world = viewMode === 'preview' && previewWorld ? previewWorld : store.world;
  displayWorld = world;
  store.select(null); // structure/view changed; clear any stale selection
  graph.render(world, { live: viewMode === 'live' });
  sheet.render(world, store.goals);
  detail.render(world, null);
}

function schedulePreview() {
  if (viewMode !== 'preview') return; // only refresh the blueprint when it's shown
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderView, 120);
}

// Clicking the "Changes not pushed" badge flips between live and preview.
function toggleView() {
  if (!pendingChanges()) return;
  viewMode = viewMode === 'live' ? 'preview' : 'live';
  renderView();
  updateDeployUi();
}

$('deploy-status').addEventListener('click', toggleView);

// ---- Error list -------------------------------------------------------------
function showError(errors) {
  store.setErrors(errors);
  errorList.replaceChildren(...errors.map(renderError));
  errorList.classList.add('has-errors');
}
function clearErrors() {
  errorList.replaceChildren();
  errorList.classList.remove('has-errors');
}
function renderError(err) {
  const row = document.createElement('div');
  row.className = `error error-${err.kind}`;
  const tag = document.createElement('span');
  tag.className = 'error-kind';
  tag.textContent = (err.kind || 'error').toUpperCase();
  const msg = document.createElement('span');
  msg.className = 'error-msg';
  msg.textContent = err.line ? `Line ${err.line}: ${err.message}` : err.message;
  row.append(tag, msg);
  return row;
}

// ---- State subscriptions ----------------------------------------------------
store.on(EVENTS.FACTORY_BUILT, () => {
  renderView(); // honors viewMode; on deploy this lands the new live factory
  goals.render(store.goals, store.world);
  research.render(store.world);
});

// Applying a goal reward is intentionally centralised here: any code path that
// marks a goal complete (the sim loop, save/load later, etc.) just emits
// GOAL_COMPLETE and the features + budget update consistently.
store.on(EVENTS.GOAL_COMPLETE, (g) => {
  const u = g && g.unlocks;
  if (u && Array.isArray(u.features)) {
    for (const f of u.features) unlockFeature(f);
  }
  // Refresh the char counter so the new ceiling is visible immediately.
  editor.refreshCounter();
  // Re-render goals so the panel advances to the next incomplete card.
  goals.render(store.goals, store.world);
  // Always re-render the sheet: locked-material labels ("???" -> real name)
  // can change even when no feature flipped (e.g. researchPoints reveals on
  // Goal 2 completion via its unlockAfterGoal field).
  renderView();
  // The Research panel is hidden until research is revealed; flip it on the
  // same gate and populate it once so the player sees the upgrade line
  // immediately instead of waiting for the next frame-loop tick.
  const wasHidden = updateResearchVisibility();
  if (wasHidden === true) research.render(store.world);
});

store.on(EVENTS.SELECT, (sel) => {
  detail.render(displayWorld, sel);
  const key = sel && sel.kind === 'stockpile' ? sel.key : null;
  graph.setHighlight(key);
  sheet.highlight(key);
});

store.on(EVENTS.RESET, () => {
  detail.render(store.world, null);
  graph.setHighlight(null);
  sheet.highlight(null);
});

// ---- Simulation loop --------------------------------------------------------
// Fixed-timestep accumulator. We only bank real time into the accumulator while
// a factory is actually running, and clear it while idle, so time spent reading
// the UI (before the first Run, or after a Reset) can never fast-forward the
// simulation and pre-complete a goal.
let acc = 0;
let last = performance.now();
let uiFrame = 0;

function frame(now) {
  const dtReal = (now - last) / 1000;
  last = now;

  tickDeploy(); // push/compile timers run in real time, independently of the sim

  if (store.running) {
    acc += Math.min(0.25, dtReal); // clamp long frames (tab switch etc.)
    let guard = 0;
    while (acc >= SIM_DT && guard < 120) { // catch up, but avoid spiral-of-death
      simStep(store.world, SIM_DT);
      acc -= SIM_DT;
      guard++;
    }
    updateGoalState();

    // Refresh live views ~12 times/sec, but ONLY when the live factory is the
    // shown view - never overwrite an open code-preview blueprint with live data.
    uiFrame++;
    if (uiFrame % 5 === 0 && viewMode === 'live') {
      graph.update(store.world);
      sheet.update(store.world);
      if (store.selected) detail.render(store.world, store.selected);
    }
    goals.render(store.goals, store.world); // goals always track real production
    // Research panel reflects the LIVE factory regardless of view mode. Rebuild
    // at a low cadence (~2/s) so the Buy button isn't torn down mid-click by the
    // 12 Hz live refresh.
    if (uiFrame % 30 === 0) research.render(store.world);
  } else {
    acc = 0; // paused / not built yet: never accumulate time
  }

  requestAnimationFrame(frame);
}

function updateGoalState() {
  for (const g of store.goals) {
    if (!g.complete && checkGoal(store.world, g)) {
      g.complete = true;
      store.emit(EVENTS.GOAL_COMPLETE, g);
    }
  }
}

// ---- Go ---------------------------------------------------------------------
// Nothing is deployed yet: show a static blueprint of the starter program and
// wait for the first Push, then start the simulation loop.
viewMode = deployedProgram === null ? 'preview' : 'live';
goals.render(store.goals, store.world);
updateResearchVisibility();
research.render(store.world);
renderView();
updateDeployUi();
editor.focus();
requestAnimationFrame(frame);

// ---- Research panel visibility ----------------------------------------------
// The Research panel is only revealed once researchPoints is (which is tied to
// the 'scaled-plates' goal via RESOURCES.researchPoints.unlockAfterGoal).
// Returns true when this call *just* revealed the panel (was hidden, now shown),
// so callers can decide whether to force an immediate render.
function updateResearchVisibility() {
  const revealed = isResourceRevealed('researchPoints', store.goals);
  const section = document.getElementById('research-section');
  const wasHidden = section.classList.contains('hidden');
  section.classList.toggle('hidden', !revealed);
  return revealed && wasHidden;
}
