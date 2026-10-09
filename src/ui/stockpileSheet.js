// Variable & stockpile sheet. Two sections: shared materials and independently
// named outputs. Each row shows the code name, net rate (items/s) and current
// stockpile amount. Clicking a row highlights the material across the graph.
// Hovering shows a native tooltip with the recipe line so players can discover
// the builder call for that material (once it's unlocked). Locked materials
// render as "???" with no tooltip so unrevealed systems don't leak their
// names before the corresponding goal lands.

import { RESOURCES, resourceHint, isResourceRevealed } from '../game/definitions.js';

// Row name for a stockpile. Resource rows respect the unlock gate; named
// outputs are always user-chosen so they can't be "hidden" (they only exist
// because the player wrote code that creates them).
function displayName(sp, goals) {
  if (sp.kind !== 'resource') return sp.key;
  if (!isResourceRevealed(sp.key, goals)) return '???';
  return sp.key;
}

export function createStockpileSheet({ containerEl, onSelect }) {
  let selectedKey = null;
  let currentGoals = []; // kept so `update()` can refresh labels after goals complete

  function buildRow(sp, section, goals) {
    const row = document.createElement('div');
    row.className = `sheet-row ${section}`;
    row.dataset.key = sp.key;
    const revealed = sp.kind !== 'resource' || isResourceRevealed(sp.key, goals);
    const name = document.createElement('span');
    name.className = 'sheet-name';
    name.textContent = displayName(sp, goals);
    const rate = document.createElement('span');
    rate.className = 'sheet-rate';
    const amount = document.createElement('span');
    amount.className = 'sheet-amount';
    row.append(name, rate, amount);
    // Locked rows get no title (and no amount/rate info, filled in below).
    if (revealed) row.title = resourceHint(sp.key, goals) || (section === 'named' ? 'Named output' : 'Shared material');
    else row.classList.add('sheet-locked');
    row.addEventListener('click', () => {
      // Clicking a locked row shouldn't reveal it via the detail panel either.
      if (!revealed) return;
      onSelect({ kind: 'stockpile', key: sp.key });
    });
    return row;
  }

  function render(world, goals) {
    if (goals) currentGoals = goals;
    containerEl.innerHTML = '';
    const shared = Object.values(world.stockpiles).filter((s) => s.kind === 'resource');
    const named = Object.values(world.stockpiles).filter((s) => s.kind === 'named');

    containerEl.appendChild(section('Shared Materials', shared, 'shared', currentGoals));
    if (named.length) containerEl.appendChild(section('Named Outputs', named, 'named', currentGoals));
    else {
      const hint = document.createElement('div');
      hint.className = 'sheet-hint';
      hint.textContent = 'Named outputs appear when you call a machine with a name, e.g. smelter("myLine").';
      containerEl.appendChild(hint);
    }
    update(world);
  }

  function section(title, items, cls, goals) {
    const wrap = document.createElement('div');
    wrap.className = `sheet-section sheet-${cls}`;
    const head = document.createElement('div');
    head.className = 'sheet-section-title';
    head.textContent = title;
    wrap.appendChild(head);
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'sheet-empty';
      empty.textContent = 'None yet';
      wrap.appendChild(empty);
    }
    for (const sp of items) wrap.appendChild(buildRow(sp, cls, goals));
    return wrap;
  }

  function update(world) {
    for (const sp of Object.values(world.stockpiles)) {
      const row = containerEl.querySelector(`.sheet-row[data-key="${cssKey(sp.key)}"]`);
      if (!row) continue;
      const revealed = sp.kind !== 'resource' || isResourceRevealed(sp.key, currentGoals);
      const nameEl = row.querySelector('.sheet-name');
      if (nameEl) nameEl.textContent = displayName(sp, currentGoals);
      const rateEl = row.querySelector('.sheet-rate');
      const amtEl = row.querySelector('.sheet-amount');
      if (!revealed) {
        // Fully hide the state of a locked material: no rates, no amounts.
        rateEl.textContent = '';
        amtEl.textContent = '';
        row.classList.toggle('is-selected', false);
        continue;
      }
      const rate = sp.netRate;
      rateEl.textContent = `${rate >= 0 ? '+' : ''}${rate.toFixed(2)}/s`;
      rateEl.className = `sheet-rate ${rate >= 0 ? 'rate-pos' : 'rate-neg'}`;
      amtEl.textContent = `${sp.amount.toFixed(1)} ${sp.kind === 'resource' && RESOURCES[sp.key] ? RESOURCES[sp.key].label : 'held'}`;
      row.classList.toggle('is-selected', selectedKey === sp.key);
    }
  }

  function highlight(key) {
    selectedKey = key;
    containerEl.querySelectorAll('.sheet-row').forEach((r) =>
      r.classList.toggle('is-selected', r.dataset.key === key));
  }

  return { render, update, highlight };
}

function cssKey(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, (c) => '\\' + c);
}
