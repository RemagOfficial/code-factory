// Production goals panel. Shows ONLY the current (first incomplete) goal so
// the player focuses on one step at a time; completed goals are hidden until
// the whole line is done, at which point we surface a single "validated"
// card. The HUD element (top bar) mirrors the same focus goal.

import { goalProgress } from '../game/simulation.js';

export function createGoals({ containerEl, hudEl }) {
  function render(goals, world) {
    while (containerEl.firstChild) containerEl.removeChild(containerEl.firstChild);

    const active = goals.find((g) => !g.complete);

    if (!active) {
      // Everything is done - celebrate once and keep the panel informative.
      const card = document.createElement('div');
      card.className = 'goal-card goal-complete goal-card-final';
      const head = document.createElement('div');
      head.className = 'goal-head';
      const check = document.createElement('span');
      check.className = 'goal-check';
      check.textContent = '\u2713';
      const title = document.createElement('span');
      title.className = 'goal-title';
      title.textContent = 'Checkpoint complete';
      head.append(check, title);
      const detail = document.createElement('div');
      detail.className = 'goal-detail';
      detail.textContent = 'All research applied. Loops, crafter() and the upgrade line are yours - keep optimising.';
      card.append(head, detail);
      containerEl.appendChild(card);
      hudEl.textContent = 'All goals complete — factory validated.';
      hudEl.className = 'goal-hud goal-hud-done';
      return;
    }

    const { have, amount, unit } = goalProgress(world, active);
    const pctRaw = amount > 0 ? Math.max(0, Math.min(100, (have / amount) * 100)) : 0;
    const pct = pctRaw;

    const card = document.createElement('div');
    card.className = 'goal-card';

    const head = document.createElement('div');
    head.className = 'goal-head';
    const check = document.createElement('span');
    check.className = 'goal-check';
    check.textContent = '\u25CB'; // open circle for the current goal
    const title = document.createElement('span');
    title.className = 'goal-title';
    title.textContent = active.title;
    head.append(check, title);

    const detail = document.createElement('div');
    detail.className = 'goal-detail';
    detail.textContent = active.detail;

    const bar = document.createElement('div');
    bar.className = 'goal-bar';
    const fill = document.createElement('div');
    fill.className = 'goal-fill';
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    const progress = document.createElement('div');
    progress.className = 'goal-progress';
    const shown = amount > 0 ? Math.min(have, amount) : have;
    progress.textContent = `${shown.toFixed(0)} / ${amount} ${unit}`;

    card.append(head, detail, bar, progress);

    // Reward chip: hints what completing this goal grants. Since we only show
    // the current goal now, this doubles as the "next unlock" teaser.
    const unlocks = active.unlocks;
    if (unlocks && (unlocks.label || unlocks.budget)) {
      const reward = document.createElement('div');
      reward.className = 'goal-reward';
      const bits = [];
      if (unlocks.label) bits.push(unlocks.label);
      else if (unlocks.features?.length) bits.push(unlocks.features.join(' + '));
      if (unlocks.budget) bits.push(`budget → ${unlocks.budget}`);
      reward.textContent = 'Reward: ' + bits.join(' · ');
      card.appendChild(reward);
    }

    // Small "N of M" footer so players know how long the ladder is without
    // revealing what the future goals are.
    const done = goals.filter((g) => g.complete).length;
    const foot = document.createElement('div');
    foot.className = 'goal-foot';
    foot.textContent = `Goal ${done + 1} of ${goals.length}`;
    card.appendChild(foot);

    containerEl.appendChild(card);
    renderHud(active.title, shown, amount, unit);
  }

  function renderHud(title, have, amount, unit) {
    hudEl.textContent = `Goal: ${title} — ${have.toFixed(0)}/${amount} ${unit}`;
    hudEl.className = 'goal-hud';
  }

  return { render };
}
