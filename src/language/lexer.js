// Tokenizer for the Code Factory mini-language (JavaScript-like subset).
// Produces a flat token array with 1-based line numbers for error reporting.

import { syntaxError } from './errors.js';

const KEYWORDS = new Set(['var', 'for', 'if', 'function', 'true', 'false']);

// token: { type, value, line }
// types: number | string | identifier | keyword | punct | eof

export function tokenize(source) {
  const tokens = [];
  const src = source;
  let i = 0;
  let line = 1;

  const punct3 = ['===', '!=='];
  const punct2 = ['==', '!=', '<=', '>=', '&&', '||', '=>', '++'];
  const punct1 = ['(', ')', '{', '}', '[', ']', ';', ',', '.', '+', '-', '*', '/', '<', '>', '=', '!'];

  const isIdentStart = (c) => /[A-Za-z_$]/.test(c);
  const isIdentPart = (c) => /[A-Za-z0-9_$]/.test(c);
  const isDigit = (c) => /[0-9]/.test(c);

  while (i < src.length) {
    const c = src[i];

    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }

    // Line comment
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      if (i >= src.length) throw syntaxError('Unterminated block comment', line);
      i += 2;
      continue;
    }

    // Number
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let start = i;
      while (i < src.length && (isDigit(src[i]) || src[i] === '.')) i++;
      const raw = src.slice(start, i);
      const value = Number(raw);
      if (Number.isNaN(value)) throw syntaxError(`Invalid number '${raw}'`, line);
      tokens.push({ type: 'number', value, line });
      continue;
    }

    // String
    if (c === '"' || c === "'") {
      const quote = c;
      const startLine = line;
      i++;
      let out = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\n') throw syntaxError('Unterminated string literal', startLine);
        if (src[i] === '\\' && i + 1 < src.length) {
          const esc = src[i + 1];
          out += esc === 'n' ? '\n' : esc;
          i += 2;
        } else {
          out += src[i];
          i++;
        }
      }
      if (i >= src.length) throw syntaxError('Unterminated string literal', startLine);
      i++; // consume closing quote
      tokens.push({ type: 'string', value: out, line: startLine });
      continue;
    }

    // Identifier / keyword
    if (isIdentStart(c)) {
      let start = i;
      while (i < src.length && isIdentPart(src[i])) i++;
      const raw = src.slice(start, i);
      tokens.push(KEYWORDS.has(raw)
        ? { type: 'keyword', value: raw, line }
        : { type: 'identifier', value: raw, line });
      continue;
    }

    // Punctuation (longest match first)
    const three = src.substr(i, 3);
    const two = src.substr(i, 2);
    if (punct3.includes(three)) { tokens.push({ type: 'punct', value: three, line }); i += 3; continue; }
    if (punct2.includes(two)) { tokens.push({ type: 'punct', value: two, line }); i += 2; continue; }
    if (punct1.includes(c)) { tokens.push({ type: 'punct', value: c, line }); i += 1; continue; }

    throw syntaxError(`Unexpected character '${c}'`, line);
  }

  tokens.push({ type: 'eof', value: null, line });
  return tokens;
}
