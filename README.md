# Code Factory

A factory-building game where **your code *is* the factory**. Write a small
JS-like program in the editor, push it, and the running factory you built
produces resources continuously. Every machine, cable and stockpile in the
graph comes from a line of code you wrote.

## ▶ Play it

**Live demo:** https://remagofficial.github.io/code-factory/

## 🧩 The core loop

1. Write a program inside a **strict character budget** (comments and spaces
   count too).
2. Press **⇧ Push** (or Ctrl/Cmd+Enter). The code validates instantly, then
   spends 15 s pushing + 15 s compiling before it lands, git-style. The
   factory that's already running keeps producing throughout.
3. Watch the graph: miners dig ore, smelters forge plates, labs research.
   Every stockpile updates live and you can hover any material to see its
   recipe.
4. Meet a production goal to unlock the next language feature and a bigger
   budget.

## 🎯 Progression (first checkpoint)

| # | Goal                                        | Unlocks                                        | Budget |
|---|---------------------------------------------|------------------------------------------------|--------|
| 1 | Produce **50 Iron Plates**                  | **Loops** (`for (var i = 0; i < N; i = i + 1)`) | 100 → 150 |
| 2 | Produce **500 Iron Plates**                 | **`crafter(recipe)`** + research reveals         | 150 → 210 |
| 3 | Store **20 Research Points**                | Bigger budget for larger factories               | 210 → 260 |
| 4 | **Complete All Research** (buy every upgrade) | Final budget — checkpoint cleared              | 260 → 300 |

Research upgrades (`Better Bellows`, `Heated Dies`, `Reinforced Drills`) boost
productivity and efficiency via global throughput multipliers on the running
factory - they never unlock new language features.

## 🏭 Production chain

```
iron ore + coal  ──smelter()──▶  iron plates
iron plates + coal ──extruder()─▶  conductors
conductors + iron plates ──lab()▶  research points
research points  ──researchCenter()─▶  banked research (spent on upgrades)
```

`crafter("conductors")` and `crafter("researchPoints")` build the same
machines via the generic interface (unlocked at Goal 2). Iron plates are
**smelter-only by design**, so `crafter("ironPlates")` is rejected.

Materials you haven't reached yet appear as **???** in the stockpile sheet
with no tooltip, so unrevealed systems don't leak their names.

## 🧰 Tech stack

- [Vite 5](https://vitejs.dev/) for the dev server + build.
- [CodeMirror 6](https://codemirror.net/) for the editor.
- A hand-written **lexer + parser + tree-walking interpreter** for the
  Code Factory mini-language (see `src/language/`). No `eval`, no real JS.
- Vanilla ES modules everywhere else - no framework.

## 🚀 Running it locally

```bash
# from this folder
npm install
npm run dev          # starts Vite on http://localhost:5173 (or next free port)
```

Building for production:

```bash
npm run build        # emits static assets to ./dist
npm run preview      # serves ./dist locally
```

## 🗂 Project layout

```
.
├─ index.html                App shell: top bar, three panes, settings overlay
├─ src/
│  ├─ main.js                Bootstrap: deploy pipeline, view toggle, goal unlocks
│  ├─ styles/main.css        Theme + all panel styling
│  ├─ game/
│  │  ├─ definitions.js      Central data: resources, machines, recipes, goals, upgrades
│  │  ├─ world.js            Machine + stockpile model, upgrades, throughput recompute
│  │  ├─ simulation.js       Fixed-timestep production simulation + goal tracking
│  │  └─ state.js            Minimal observable store + event bus
│  ├─ language/
│  │  ├─ lexer.js            Tokenizer for the mini-language
│  │  ├─ parser.js           Recursive-descent parser → AST
│  │  ├─ interpreter.js      Tree-walking interpreter with feature gates
│  │  ├─ stdlib.js           miner, smelter, lab, extruder, researchCenter, crafter
│  │  ├─ features.js         Loops / crafter / etc. unlock flags
│  │  └─ errors.js           Typed, human-readable errors with line numbers
│  └─ ui/
│     ├─ editor.js           CodeMirror 6 host + syntax highlighting + char counter
│     ├─ graph.js            Layered-DAG factory view (pan/zoom, live vs blueprint)
│     ├─ stockpileSheet.js   Live materials table with hover recipes and ??? gates
│     ├─ detailPanel.js      Machine / material inspector
│     ├─ goals.js            Current-goal card with progress bar + reward chip
│     └─ research.js         Upgrade line + stored-research bank
```

## 📝 Notes on the design

- **Comments cost characters.** The starter program is intentionally over the
  100-char budget; the first lesson is to trim it.
- **The factory always runs.** Your edits are inert until pushed. A "Changes
  not pushed" badge flips between the live factory and a blueprint of your
  current code.
- **Feature-gated, not hidden.** Loops and `crafter()` parse from the start
  but throw a friendly "not unlocked yet" error when executed, so autocomplete
  can tease them without spoiling them.
- **Research is persistent across deploys.** Stored points, purchased
  upgrades, and their multipliers survive every Push and are re-applied to
  freshly built machines.

## 📄 License

Prototype - all rights reserved for now.
