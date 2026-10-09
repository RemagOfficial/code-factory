// SVG factory-network visualisation.
//
// Layout: a layered DAG. Machines and materials are separate nodes; every
// material appears EXACTLY ONCE, sitting between its producers and consumers, so
// edges read left-to-right:  miner -> iron ore node -> smelter -> plates node.
// Named outputs are distinct material nodes (unique resources), never merged
// with a same-typed shared stockpile.
//
// Two render modes:
//   live    = factory running: animated flow dots, status colours, live numbers
//   preview = not running: static dashed "blueprint", neutral, no motion
// Supports mouse-wheel zoom and drag-to-pan for larger factories.

import { RESOURCES } from '../game/definitions.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const NODE_W = 172;
const NODE_H = 54;
const COL_W = 260; // horizontal gap between layers
const ROW_H = 82;  // vertical gap between nodes in a layer
const PAD = 24;

export function createGraph({ svgEl, onSelect }) {
  let world = null;
  let live = true;
  const nodeIndex = new Map(); // id (machine id or material key) -> node group
  let linkIndex = new Map();   // material key -> Set of connected node ids
  let highlightKey = null;
  let structureSig = '';

  // Viewport transform (pan/zoom) lives on a wrapping <g>.
  let tx = 0, ty = 0, scale = 1;
  const viewport = el('g', { class: 'viewport' });

  const host = svgEl.parentElement;
  svgEl.appendChild(viewport);
  setupControls();
  setupPanZoom();

  function applyTransform() {
    viewport.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
  }

  // ---- Build graph structures from the world ----
  function buildGraph(w) {
    const nodes = [];
    const byId = new Map();
    for (const m of w.machines) { const n = { id: m.id, kind: 'machine', m }; nodes.push(n); byId.set(m.id, n); }

    const materials = new Set();
    for (const m of w.machines) {
      if (m.destKey) materials.add(m.destKey);   // sinks (research center) have no output
      for (const i of m.inputs) materials.add(i.resource);
    }
    // Which underlying resource each material node actually holds (a named
    // output can hold, e.g., iron plates under a unique name).
    const holds = new Map();
    for (const m of w.machines) if (m.destKey) holds.set(m.destKey, m.outputResource);

    for (const key of materials) {
      const sp = w.stockpiles[key];
      const n = { id: key, kind: 'material', sp, isNamed: sp ? sp.kind === 'named' : true, holdsResource: holds.get(key) || key };
      nodes.push(n); byId.set(key, n);
    }

    const succ = new Map(nodes.map((n) => [n.id, []]));
    const pred = new Map(nodes.map((n) => [n.id, []]));
    const edges = [];
    linkIndex = new Map();

    const link = (matKey, nodeId) => {
      if (!linkIndex.has(matKey)) linkIndex.set(matKey, new Set());
      linkIndex.get(matKey).add(nodeId);
    };

    for (const m of w.machines) {
      if (m.destKey) {
        edges.push({ from: m.id, to: m.destKey, kind: 'output', material: m.destKey });
        succ.get(m.id).push(m.destKey); pred.get(m.destKey).push(m.id);
        link(m.destKey, m.id); link(m.destKey, m.destKey);
      }

      for (const i of m.inputs) {
        if (!byId.has(i.resource)) continue;
        edges.push({ from: i.resource, to: m.id, kind: 'input', material: i.resource });
        succ.get(i.resource).push(m.id); pred.get(m.id).push(i.resource);
        link(i.resource, m.id); link(i.resource, i.resource);
      }
    }
    return { nodes, byId, succ, pred, edges };
  }

  // ---- Layered (longest-path) layout with barycenter ordering ----
  function layout(g) {
    const { nodes, succ, pred } = g;
    const indeg = new Map(nodes.map((n) => [n.id, pred.get(n.id).length]));
    const layerOf = new Map();
    const queue = [];
    for (const n of nodes) if (indeg.get(n.id) === 0) { layerOf.set(n.id, 0); queue.push(n.id); }

    let guard = 0;
    while (queue.length && guard++ < 100000) {
      const id = queue.shift();
      for (const s of succ.get(id)) {
        layerOf.set(s, Math.max(layerOf.get(s) ?? 0, (layerOf.get(id) ?? 0) + 1));
        indeg.set(s, indeg.get(s) - 1);
        if (indeg.get(s) === 0) queue.push(s);
      }
    }
    nodes.forEach((n) => { if (!layerOf.has(n.id)) layerOf.set(n.id, 0); }); // cycle fallback

    const maxLayer = Math.max(0, ...[...layerOf.values()]);
    const cols = Array.from({ length: maxLayer + 1 }, () => []);
    // keep a stable initial order: machines/materials by insertion
    for (const n of nodes) cols[layerOf.get(n.id)].push(n);

    const pos = new Map();
    cols.forEach((col) => col.forEach((n, i) => pos.set(n.id, i)));
    const avg = (ids) => ids.length ? ids.reduce((s, id) => s + (pos.get(id) ?? 0), 0) / ids.length : 0;
    const reorder = (col, neigh) => {
      col.sort((a, b) => avg(neigh.get(a.id)) - avg(neigh.get(b.id)));
      col.forEach((n, i) => pos.set(n.id, i));
    };
    for (let li = 1; li <= maxLayer; li++) reorder(cols[li], pred);
    for (let li = maxLayer - 1; li >= 0; li--) reorder(cols[li], succ);

    const maxCount = Math.max(1, ...cols.map((c) => c.length));
    const totalH = maxCount * ROW_H;
    cols.forEach((col, li) => {
      const startY = PAD + (totalH - col.length * ROW_H) / 2;
      col.forEach((n, i) => { n.x = PAD + li * COL_W; n.y = startY + i * ROW_H; });
    });

    const width = PAD * 2 + (maxLayer + 1) * COL_W;
    const height = PAD * 2 + totalH;
    return { width, height };
  }

  // ---- Render ----
  function render(w, opts = {}) {
    world = w;
    live = opts.live !== false;
    svgEl.classList.toggle('live', live);
    svgEl.classList.toggle('preview', !live);
    clear();

    const hasMachines = w.machines.length > 0;
    if (!hasMachines) {
      const t = el('text', { x: 300, y: 120, 'text-anchor': 'middle', class: 'graph-empty' });
      t.textContent = live
        ? 'No machines yet — write a program and press Run.'
        : 'Nothing to preview yet — write valid code to see the factory.';
      viewport.appendChild(t);
      return;
    }

    const g = buildGraph(w);
    const bounds = layout(g);

    const edgeLayer = el('g', { class: 'edges' });
    viewport.appendChild(edgeLayer);
    for (const e of g.edges) edgeLayer.appendChild(makeEdge(g.byId.get(e.from), g.byId.get(e.to), e));

    const nodeLayer = el('g', { class: 'nodes' });
    viewport.appendChild(nodeLayer);
    for (const n of g.nodes) {
      nodeLayer.appendChild(n.kind === 'machine'
        ? makeMachineNode(n.m, n)
        : makeStockpileNode(n.sp.key, n));
    }

    // Auto-fit when the overall structure changes, else preserve the current view.
    const sig = [...nodeIndex.keys()].sort().join(',');
    if (sig !== structureSig) {
      structureSig = sig;
      zoomToFit(bounds.width, bounds.height);
    } else {
      applyTransform();
    }

    if (live) update(w); else renderStatic(w);
  }

  function makeEdge(from, to, e) {
    const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
    const x2 = to.x, y2 = to.y + NODE_H / 2;
    const dx = Math.max(40, (x2 - x1) / 2);
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    const path = el('path', { d, class: `edge edge-${e.kind}`, 'data-material': e.material });
    const g = el('g', { class: 'edge-wrap', 'data-material': e.material });
    g.appendChild(path);
    if (live) {
      const dot = el('circle', { r: 4, class: `flow-dot flow-${e.kind}` });
      dot.appendChild(el('animateMotion', { dur: `${1.2 + Math.random()}s`, repeatCount: 'indefinite', path: d }));
      g.appendChild(dot);
    }
    return g;
  }

  function makeStockpileNode(key, node) {
    const sp = node.sp;
    const g = el('g', {
      class: `node node-material ${sp.kind === 'named' ? 'node-named' : 'node-shared'}`,
      transform: `translate(${node.x},${node.y})`,
      'data-id': key,
    });
    g.appendChild(el('rect', { width: NODE_W, height: NODE_H, rx: 10, class: 'node-box' }));
    const label = el('text', { x: 12, y: 22, class: 'node-label' });
    label.textContent = sp.kind === 'named' ? sp.label : (RESOURCES[sp.key]?.label || sp.key);
    g.appendChild(label);
    const sub = el('text', { x: 12, y: 38, class: 'node-sub' });
    const hr = node.holdsResource;
    sub.textContent = sp.kind === 'named'
      ? `named · ${RESOURCES[hr]?.label || hr}`
      : (sp.sourceRate > 0 ? 'source' : 'stockpile');
    g.appendChild(sub);
    const amt = el('text', { x: 12, y: 48, class: 'node-amount' });
    amt.setAttribute('data-amount', key);
    g.appendChild(amt);
    g.addEventListener('click', (ev) => { ev.stopPropagation(); onSelect({ kind: 'stockpile', key }); });
    nodeIndex.set(key, g);
    return g;
  }

  function makeMachineNode(m, node) {
    const g = el('g', {
      class: `node node-machine ${live ? 'status-' + m.status : 'status-preview'}`,
      transform: `translate(${node.x},${node.y})`,
      'data-id': m.id,
    });
    g.appendChild(el('rect', { width: NODE_W, height: NODE_H, rx: 10, class: 'node-box' }));
    const label = el('text', { x: 12, y: 22, class: 'node-label' });
    label.textContent = m.label;
    g.appendChild(label);
    const rate = el('text', { x: 12, y: 42, class: 'node-rate' });
    rate.setAttribute('data-rate', m.id);
    g.appendChild(el('circle', { cx: NODE_W - 14, cy: NODE_H / 2, r: 6, class: 'status-indicator' }));
    g.appendChild(rate);
    g.addEventListener('click', (ev) => { ev.stopPropagation(); onSelect({ kind: 'machine', id: m.id }); });
    nodeIndex.set(m.id, g);
    return g;
  }

  function renderStatic(w) {
    for (const m of w.machines) {
      const g = nodeIndex.get(m.id); if (!g) continue;
      const rate = g.querySelector(`[data-rate="${m.id}"]`);
      if (rate) rate.textContent = `→ ${m.outputRate}/s when run`;
    }
    for (const key of Object.keys(w.stockpiles)) {
      const g = nodeIndex.get(key); if (!g) continue;
      const amt = g.querySelector(`[data-amount="${key}"]`);
      if (amt) { amt.textContent = 'idle'; amt.setAttribute('class', 'node-amount rate-idle'); }
    }
    applyHighlight();
  }

  // Live refresh of numbers + status colour (called each tick while running).
  function update(w) {
    if (!w) return;
    for (const m of w.machines) {
      const g = nodeIndex.get(m.id); if (!g) continue;
      g.setAttribute('class', `node node-machine status-${m.status}`);
      const rate = g.querySelector(`[data-rate="${m.id}"]`);
      if (rate) rate.textContent = `${m.actualRate.toFixed(2)}/${m.capacityRate.toFixed(2)} /s`;
    }
    for (const key of Object.keys(w.stockpiles)) {
      const g = nodeIndex.get(key); if (!g) continue;
      const amt = g.querySelector(`[data-amount="${key}"]`);
      if (amt) {
        const sp = w.stockpiles[key];
        amt.textContent = `${fmt(sp.amount)} · ${fmtRate(sp.netRate)}`;
        amt.setAttribute('class', `node-amount ${sp.netRate >= 0 ? 'rate-pos' : 'rate-neg'}`);
      }
    }
    applyHighlight();
  }

  function clear() {
    while (viewport.firstChild) viewport.removeChild(viewport.firstChild);
    nodeIndex.clear();
  }

  // ---- Selection highlight (material -> connected nodes) ----
  function setHighlight(key) { highlightKey = key; applyHighlight(); }

  function applyHighlight() {
    viewport.classList.toggle('has-highlight', !!highlightKey);
    viewport.querySelectorAll('.edge-wrap').forEach((g) => {
      const m = g.getAttribute('data-material');
      g.classList.toggle('dim', !!highlightKey && m !== highlightKey);
      g.classList.toggle('lit', !!highlightKey && m === highlightKey);
    });
    const connected = highlightKey ? linkIndex.get(highlightKey) : null;
    viewport.querySelectorAll('.node').forEach((g) => {
      const id = g.getAttribute('data-id');
      const isLit = !!highlightKey && connected && connected.has(id);
      g.classList.toggle('dim', !!highlightKey && !isLit);
      g.classList.toggle('lit', isLit);
    });
  }

  // ---- Pan / zoom ----
  function zoomToFit(contentW, contentH) {
    const hostW = host.clientWidth || 800;
    const hostH = host.clientHeight || 400;
    scale = Math.min(1.5, Math.max(0.3, Math.min(hostW / contentW, hostH / contentH)));
    tx = (hostW - contentW * scale) / 2;
    ty = (hostH - contentH * scale) / 2;
    applyTransform();
  }

  function zoomBy(factor) {
    const hostW = host.clientWidth || 800, hostH = host.clientHeight || 400;
    const cx = hostW / 2, cy = hostH / 2;
    const wx = (cx - tx) / scale, wy = (cy - ty) / scale;
    scale = Math.min(3, Math.max(0.25, scale * factor));
    tx = cx - wx * scale; ty = cy - wy * scale;
    applyTransform();
  }

  function setupPanZoom() {
    svgEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = svgEl.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const wx = (mx - tx) / scale, wy = (my - ty) / scale;
      scale = Math.min(3, Math.max(0.25, scale * factor));
      tx = mx - wx * scale; ty = my - wy * scale;
      applyTransform();
    }, { passive: false });

    let panning = false, moved = false, lastX = 0, lastY = 0;
    svgEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.node')) return; // let node clicks select, not pan
      panning = true; moved = false; lastX = e.clientX; lastY = e.clientY;
      svgEl.classList.add('grabbing');
      svgEl.setPointerCapture(e.pointerId);
    });
    svgEl.addEventListener('pointermove', (e) => {
      if (!panning) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      tx += dx; ty += dy; lastX = e.clientX; lastY = e.clientY;
      applyTransform();
    });
    const endPan = (e) => {
      if (!panning) return;
      panning = false; svgEl.classList.remove('grabbing');
      try { svgEl.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    svgEl.addEventListener('pointerup', endPan);
    svgEl.addEventListener('pointercancel', endPan);
  }

  function setupControls() {
    const bar = document.createElement('div');
    bar.className = 'graph-controls';
    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'graph-ctl'; b.textContent = label; b.title = title;
      b.addEventListener('click', fn); return b;
    };
    bar.appendChild(mk('+', 'Zoom in', () => zoomBy(1.2)));
    bar.appendChild(mk('−', 'Zoom out', () => zoomBy(1 / 1.2)));
    bar.appendChild(mk('⤢', 'Fit to view', () => {
      if (!world) return;
      const g = buildGraph(world); const b = layout(g); zoomToFit(b.width, b.height);
    }));
    host.appendChild(bar);
  }

  return { render, update, setHighlight };
}

function fmt(n) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(n < 10 ? 1 : 0); }
function fmtRate(r) { return `${r >= 0 ? '+' : ''}${r.toFixed(2)}/s`; }
