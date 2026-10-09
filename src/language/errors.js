// Typed, human-readable error objects for the Code Factory mini-language.
// Errors carry a line number (when known) so the editor can point at a spot.

export class CodeError extends Error {
  constructor(message, { line = null, kind = 'runtime' } = {}) {
    super(message);
    this.name = 'CodeError';
    this.kind = kind; // 'syntax' | 'validation' | 'feature' | 'resource' | 'limit' | 'runtime'
    this.line = line;
  }
}

export function syntaxError(message, line) {
  return new CodeError(message, { line, kind: 'syntax' });
}

export function validationError(message, line) {
  return new CodeError(message, { line, kind: 'validation' });
}

export function featureLocked(feature, line) {
  return new CodeError(
    `'${feature}' is not unlocked yet. Keep meeting production goals to unlock it.`,
    { line, kind: 'feature' }
  );
}

export function unknownIdentifier(name, line, knownNames = []) {
  const hint = knownNames.length ? ` Known names: ${knownNames.join(', ')}.` : '';
  return new CodeError(`Unknown name '${name}'.${hint}`, { line, kind: 'validation' });
}

export function limitExceeded(reason, line) {
  return new CodeError(reason, { line, kind: 'limit' });
}
