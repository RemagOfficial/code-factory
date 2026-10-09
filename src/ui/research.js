// Research & Upgrades panel. Shows stored (bankable) research and the ordered
// upgrade line. Upgrades are bought from STORED research and boost machine
// throughput; they never unlock new functions (goals do that). One panel render
// reflects the live running world, since research is persistent factory state.
//
// The DOM is built once and then updated in place. Full teardown on every
// ~2 Hz refresh used to swallow clicks that landed a moment before a rebuild,
// so we keep the same button node across renders and just mutate its
// textContent / disabled / className instead.

import { UPGRADES } from '../game/definitions.js';

export function createResearch({ containerEl, onBuy }) {
  let shell = null; // { valueEl, rows: [{ rowEl, btnEl, up }] }

  function build() {
    while (containerEl.firstChild) containerEl.removeChild(containerEl.firstChild);

    const head = document.createElement('div');
    head.className = 'research-head';
    const label = document.createElement('span');
    label.className = 'research-label';
    label.textContent = 'Stored Research';
    const val = document.createElement('span');
    val.className = 'research-value';
    head.append(label, val);
    containerEl.appendChild(head);

    const rows = UPGRADES.map((up, i) => {
      const row = document.createElement('div');
      row.className = 'upgrade';

      const info = document.createElement('div');
      info.className = 'upgrade-info';
      const name = document.createElement('div');
      name.className = 'upgrade-name';
      name.textContent = up.name;
      const desc = document.createElement('div');
      desc.className = 'upgrade-desc';
      desc.textContent = up.desc;
      const cost = document.createElement('div');
      cost.className = 'upgrade-cost';
      cost.textContent = `Cost: ${up.cost} research`;
      info.append(name, desc, cost);

      const btn = document.createElement('button');
      btn.className = 'btn upgrade-btn';
      // Persistent handler: no-op while `disabled`, so we never need to
      // detach/reattach and never destroy the node mid-click.
      btn.addEventListener('click', () => { if (!btn.disabled) onBuy(up.id); });

      row.append(info, btn);
      containerEl.appendChild(row);
      return { rowEl: row, btnEl: btn, up, index: i };
    });

    shell = { valueEl: val, rows };
  }

  function render(world) {
    if (!shell) build();
    const sp = world.stockpiles.researchPoints;
    const stored = sp ? sp.stored : 0;
    shell.valueEl.textContent = stored.toFixed(0);

    const owned = new Set(world.upgradesDone);
    const nextIndex = world.upgradesDone.length; // must buy in order

    for (const { rowEl, btnEl, up, index } of shell.rows) {
      const isOwned = owned.has(up.id);
      const isCurrent = index === nextIndex && !isOwned;
      rowEl.classList.toggle('owned', isOwned);
      rowEl.classList.toggle('current', isCurrent);

      btnEl.classList.remove('can-buy', 'done', 'locked');
      if (isOwned) {
        btnEl.textContent = '\u2713 Owned';
        btnEl.disabled = true;
        btnEl.classList.add('done');
      } else if (!isCurrent) {
        btnEl.textContent = 'Locked';
        btnEl.disabled = true;
        btnEl.classList.add('locked');
      } else if (stored < up.cost) {
        btnEl.textContent = `Need ${(up.cost - stored).toFixed(0)}`;
        btnEl.disabled = true;
      } else {
        btnEl.textContent = 'Buy';
        btnEl.disabled = false;
        btnEl.classList.add('can-buy');
      }
    }
  }

  return { render };
}
