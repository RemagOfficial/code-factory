// Detail panel for the currently selected node (machine or stockpile). Shows
// recipe / input requirements / output rate / live status for machines, and
// producers/consumers for materials.

import { RESOURCES } from '../game/definitions.js';

export function createDetailPanel({ containerEl }) {
  function clear() { while (containerEl.firstChild) containerEl.removeChild(containerEl.firstChild); }

  function render(world, selection) {
    clear();
    if (!selection) {
      const hint = document.createElement('div');
      hint.className = 'detail-hint';
      hint.textContent = 'Select a machine or material to inspect it.';
      containerEl.appendChild(hint);
      return;
    }

    if (selection.kind === 'machine') {
      const m = world.machines.find((x) => x.id === selection.id);
      if (!m) return;
      const card = el('div', 'detail-card');
      card.appendChild(title(`${m.label}${m.outputName ? ` → ${m.outputName}` : ''}`));
      card.appendChild(statusLine(m));
      const inputs = el('div', 'detail-section');
      inputs.appendChild(sub('Consumes'));
      if (m.inputs.length === 0) {
        inputs.appendChild(line('Raw deposit', 'extracts, no inputs'));
      } else {
        for (const inp of m.inputs) {
          inputs.appendChild(line(`${RESOURCES[inp.resource].label}: ${inp.rate}/s`, `holding ${fmt(world.stockpiles[inp.resource].amount)}`));
        }
      }
      card.appendChild(inputs);
      const out = el('div', 'detail-section');
      if (m.destKey) {
        // Regular producer (miner, smelter, lab, crafter): show output line.
        out.appendChild(sub('Produces'));
        const outLabel = RESOURCES[m.outputResource]?.label || m.outputResource;
        out.appendChild(line(`${outLabel}: ${m.outputRate}/s capacity`, `actual ${m.actualRate.toFixed(2)}/s`));
      } else {
        // Sink (e.g. researchCenter): consumes and banks into `stored`.
        out.appendChild(sub('Stores'));
        const storeLabel = RESOURCES[m.store]?.label || m.store || '—';
        const sp = m.store ? world.stockpiles[m.store] : null;
        out.appendChild(line(storeLabel, sp ? `${fmt(sp.stored)} banked` : 'no storage target'));
      }
      card.appendChild(out);
      containerEl.appendChild(card);
      return;
    }

    // stockpile
    const sp = world.stockpiles[selection.key];
    if (!sp) return;
    const card = el('div', 'detail-card');
    card.appendChild(title(sp.label));
    card.appendChild(line('Net rate', `${sp.netRate >= 0 ? '+' : ''}${sp.netRate.toFixed(2)}/s`, sp.netRate >= 0 ? 'rate-pos' : 'rate-neg'));
    card.appendChild(line('Amount held', `${sp.amount.toFixed(1)}`));
    if (sp.sourceRate > 0) card.appendChild(line('Source inflow', `${sp.sourceRate}/s`));
    const rel = el('div', 'detail-section');
    rel.appendChild(sub('Producers'));
    rel.appendChild(listLine(sp.producers.map((id) => world.machines.find((m) => m.id === id)?.label || id)));
    rel.appendChild(sub('Consumers'));
    rel.appendChild(listLine(sp.consumers.map((id) => world.machines.find((m) => m.id === id)?.label || id)));
    card.appendChild(rel);
    containerEl.appendChild(card);
  }

  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function title(t) { const h = el('div', 'detail-title'); h.textContent = t; return h; }
  function sub(t) { const h = el('div', 'detail-sub'); h.textContent = t; return h; }
  function line(label, value, cls = '') {
    const row = el('div', `detail-line ${cls}`);
    const l = el('span', 'detail-label'); l.textContent = label;
    const v = el('span', 'detail-value'); v.textContent = value;
    row.append(l, v);
    return row;
  }
  function listLine(items) {
    const row = el('div', 'detail-line');
    const v = el('span', 'detail-value');
    v.textContent = items.length ? [...new Set(items)].join(', ') : '—';
    row.appendChild(v);
    return row;
  }
  function statusLine(m) {
    const row = el('div', `detail-status status-${m.status}`);
    row.textContent = `${m.status.toUpperCase()} · ${(m.factor * 100).toFixed(0)}% capacity`;
    return row;
  }
  function fmt(n) { return n < 10 ? n.toFixed(1) : Math.round(n).toString(); }

  return { render };
}
