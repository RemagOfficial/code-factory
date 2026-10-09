// CodeMirror 6 editor host: JS-like syntax highlighting, an autocomplete source
// limited to unlocked names, a live character counter, and Ctrl+Enter to Run.

import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxHighlighting, HighlightStyle, StreamLanguage,
  bracketMatching, indentOnInput,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { RESOURCES, MAX_CHARS } from '../game/definitions.js';
import { functionCatalog } from '../language/stdlib.js';

const FUNC_NAMES = new Set(functionCatalog().map((f) => f.name));
const KEYWORDS = ['var', 'for', 'if', 'else', 'function', 'true', 'false', 'return'];

// ---- Custom JS-like tokenizer ----
// StreamLanguage requires token() to return a SPACE-SEPARATED STRING of tag
// names (these auto-resolve to @lezer/highlight tags); colours come from the
// HighlightStyle below. Returning Tag *objects* here would crash the parser.
const codeLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'lineComment'; }
    if (stream.match('/*')) {
      while (!stream.eol() && !stream.match('*/', false)) stream.next();
      stream.match('*/');
      return 'blockComment';
    }
    if (stream.match(/^["'][^"']*["']/)) return 'string';
    if (stream.match(/^["']/)) { stream.skipToEnd(); return 'string'; }
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    const word = stream.match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (word) {
      const w = word[0];
      if (KEYWORDS.includes(w)) return 'keyword';
      if (FUNC_NAMES.has(w)) return 'macroName';   // machine builders (miner, smelter)
      if (RESOURCES[w]) return 'className';        // resource / stockpile names
      if (stream.peek() === '(') return 'function'; // other calls
      return 'variableName';                       // plain identifier
    }
    stream.next();
    return null;
  },
});

// Token colours, bound to the tags the token names resolve to.
const tokenStyles = HighlightStyle.define([
  { tag: [tags.lineComment, tags.blockComment], color: '#5f7695', fontStyle: 'italic' },
  { tag: tags.string, color: '#e8b47a' },
  { tag: tags.number, color: '#7fd1b9' },
  { tag: tags.keyword, color: '#c792ea', fontWeight: '600' },
  { tag: tags.macroName, color: '#82aaff', fontWeight: '600' },
  { tag: tags.function, color: '#82aaff' },
  { tag: tags.className, color: '#ffcb6b' },
  { tag: tags.variableName, color: '#d6deeb' },
]);

// Editor chrome (background, cursor, gutters) - not token colours.
const baseTheme = EditorView.baseTheme({
  '&': { fontSize: '14px', color: '#d6deeb' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', Consolas, Menlo, monospace" },
  '.cm-content': { caretColor: '#7ee0ff' },
  '.cm-gutters': { background: '#121923', color: '#4a6076', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 8px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid #7ee0ff' },
  '.cm-selectionBackground, .cm-content ::selection': { background: '#22405a' },
  '.cm-activeLine': { backgroundColor: '#ffffff08' },
  '.cm-activeLineGutter': { backgroundColor: '#ffffff0c' },
});

export function createEditor({ mountEl, initialDoc, onChange, onRun, counterEl, getBudget }) {
  const readBudget = typeof getBudget === 'function' ? getBudget : () => MAX_CHARS;
  function updateCounter(doc) {
    const n = doc.length;
    const max = readBudget();
    counterEl.textContent = `${n} / ${max} chars`;
    counterEl.classList.toggle('over-budget', n > max);
  }

  const completionSource = (context) => {
    const word = context.matchBefore(/[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!word && !context.explicit) return null;
    const options = [];
    for (const fn of functionCatalog()) {
      options.push({ label: fn.name, type: 'function', detail: fn.detail, apply: fn.apply });
    }
    for (const key of Object.keys(RESOURCES)) {
      const r = RESOURCES[key];
      options.push({ label: key, type: 'variable', detail: r.label + (r.mineable ? ' (mineable)' : ' stockpile') });
    }
    options.push({ label: 'var', type: 'keyword', detail: 'declare a variable' });
    return { from: word ? word.from : context.pos, options, validFor: /^[A-Za-z_$][A-Za-z0-9_$]*$/ };
  };

  const state = EditorState.create({
    doc: initialDoc,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      autocompletion({ override: [completionSource], activateOnTyping: true }),
      codeLanguage,
      baseTheme,
      syntaxHighlighting(tokenStyles),
      EditorView.lineWrapping,
      // Ctrl/Cmd-Enter to push. Registered BEFORE defaultKeymap so it wins over
      // @codemirror/commands, which binds Mod-Enter to insertBlankLine.
      keymap.of([{
        key: 'Ctrl-Enter',
        mac: 'Cmd-Enter',
        run: () => { onRun(); return true; },
      }]),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const doc = update.state.doc.toString();
          updateCounter(doc);
          onChange(doc);
        }
      }),
    ],
  });

  const view = new EditorView({ state, parent: mountEl });
  updateCounter(initialDoc);

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (text) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      updateCounter(text);
    },
    focus: () => view.focus(),
    // Called when the budget ceiling changes (goal unlock) so the counter
    // re-renders without a doc edit.
    refreshCounter: () => updateCounter(view.state.doc.toString()),
  };
}
