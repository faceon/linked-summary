// Handles incremental key point updates from a streaming summarizer output.
export class KeyPointStream {
  constructor(onUpdate) {
    this._onUpdate = typeof onUpdate === "function" ? onUpdate : null;
    this._entries = [];
    this._currentEntry = null;
    this._currentRaw = "";
    this._nextId = 0;
    this._readyForNewEntry = true;
  }

  ingest(chunk = "") {
    if (!chunk) return;

    let mutated = false;

    for (const char of chunk) {
      if (char === "*") {
        mutated = this._handleDelimiter() || mutated;
        continue;
      }
      mutated = this._appendChar(char) || mutated;
    }

    if (mutated) {
      this._notify();
    }
  }

  complete() {
    const mutated = this._finalizeCurrent();
    if (mutated) {
      this._notify();
    }
    return this._snapshot();
  }

  value() {
    return this._snapshot();
  }

  _appendChar(char) {
    if (
      this._readyForNewEntry &&
      this._isWhitespace(char) &&
      !this._currentEntry
    ) {
      return false;
    }

    if (!this._currentEntry) {
      this._beginNewEntry();
    }

    this._readyForNewEntry = false;
    this._currentRaw += char;

    const normalized = this._normalizePartial(this._currentRaw);
    if (normalized === this._currentEntry.text) {
      return false;
    }

    this._currentEntry.text = normalized;
    return true;
  }

  _handleDelimiter() {
    const finalized = this._finalizeCurrent();
    this._readyForNewEntry = true;
    return finalized;
  }

  _beginNewEntry() {
    this._currentEntry = {
      id: this._nextId++,
      text: "",
    };
    this._currentRaw = "";
    this._entries.push(this._currentEntry);
    return true;
  }

  _finalizeCurrent() {
    if (!this._currentEntry) {
      this._readyForNewEntry = true;
      return false;
    }

    const trimmed = this._normalizeFinal(this._currentRaw);
    const lastIndex = this._entries.lastIndexOf(this._currentEntry);

    let mutated = false;
    if (!trimmed) {
      if (lastIndex !== -1) {
        this._entries.splice(lastIndex, 1);
        mutated = true;
      }
    } else if (trimmed !== this._currentEntry.text) {
      this._currentEntry.text = trimmed;
      mutated = true;
    }

    this._currentEntry = null;
    this._currentRaw = "";
    this._readyForNewEntry = true;
    return mutated;
  }

  _normalizePartial(raw) {
    return raw.replace(/^\s+/, "").replace(/\s*\n\s*/g, " ");
  }

  _normalizeFinal(raw) {
    return raw
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  _isWhitespace(char) {
    return /\s/.test(char);
  }

  _snapshot() {
    return this._entries.map(({ id, text }) => ({
      id,
      text,
    }));
  }

  _notify() {
    if (!this._onUpdate) return;
    this._onUpdate(this._snapshot());
  }
}

function isAsyncIterable(value) {
  return value != null && typeof value[Symbol.asyncIterator] === "function";
}

function resolveOnUpdate(arg, onUpdate) {
  if (typeof arg === "function") {
    return arg;
  }
  if (typeof onUpdate === "function") {
    return onUpdate;
  }
  return undefined;
}

async function consumeStream(stream, onUpdate) {
  const keyPointStream = new KeyPointStream(onUpdate);
  if (typeof onUpdate === "function") {
    onUpdate(keyPointStream.value());
  }

  for await (const chunk of stream) {
    keyPointStream.ingest(chunk);
  }

  return keyPointStream.complete();
}

export function createKeyPointStream(arg, onUpdate) {
  const callback = resolveOnUpdate(arg, onUpdate);

  if (isAsyncIterable(arg)) {
    return consumeStream(arg, callback);
  }

  return new KeyPointStream(callback);
}
