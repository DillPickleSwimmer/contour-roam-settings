// Parser and serializer for the Contour FW_RTC.txt settings file.
//
// The camera writes its own documentation into the bottom of this file under a
// "DATA STRUCTURE" heading. Those lines contain colons too ("\t Y:YES"), so
// everything from that marker onward is held as opaque text and never parsed.
//
// Writing is deliberately surgical: only the characters after a key's colon are
// replaced. Line endings (CRLF), indentation, spacing, comments and unknown keys
// all survive a round trip byte for byte. The camera firmware is not forgiving.

const DOC_MARKER = /^\s*DATA STRUCTURE\s*$/i;
const KEY_VALUE = /^([^:\r\n]*:[ \t]*)(.*?)([ \t]*)$/;

function splitLines(text) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '\n' && ch !== '\r') continue;
    let eol = ch;
    if (ch === '\r' && text[i + 1] === '\n') {
      eol = '\r\n';
      i++;
    }
    lines.push({ content: text.slice(start, i - eol.length + 1), eol });
    start = i + 1;
  }
  if (start < text.length) lines.push({ content: text.slice(start), eol: '' });
  return lines;
}

export function normalizeKey(key) {
  return key.trim().toUpperCase().replace(/\s+/g, ' ');
}

export class SettingsFile {
  constructor(text) {
    this.bom = text.startsWith('﻿') ? '﻿' : '';
    const body = this.bom ? text.slice(1) : text;

    this.rows = [];
    this.index = new Map();
    this.originals = new Map();

    let inDocs = false;
    for (const { content, eol } of splitLines(body)) {
      if (!inDocs && DOC_MARKER.test(content)) inDocs = true;

      const match = inDocs ? null : content.match(KEY_VALUE);
      if (!match) {
        this.rows.push({ kind: 'raw', text: content, eol });
        continue;
      }

      const [, prefix, value, trail] = match;
      const key = prefix.replace(/[ \t]*:[ \t]*$/, '').trim();
      const norm = normalizeKey(key);
      const row = { kind: 'kv', key, norm, prefix, value, trail, eol };
      // A duplicated key means the first occurrence wins, matching how the
      // camera reads the file top-down.
      if (!this.index.has(norm)) {
        this.index.set(norm, this.rows.length);
        this.originals.set(norm, value);
      }
      this.rows.push(row);
    }
  }

  get eol() {
    const row = this.rows.find((r) => r.eol);
    return row ? row.eol : '\r\n';
  }

  has(key) {
    return this.index.has(normalizeKey(key));
  }

  get(key) {
    const at = this.index.get(normalizeKey(key));
    return at === undefined ? undefined : this.rows[at].value;
  }

  // Only ever rewrites an existing line. Inserting keys the firmware did not
  // write itself is not safe, so a missing key is a caller error.
  set(key, value) {
    const norm = normalizeKey(key);
    const at = this.index.get(norm);
    if (at === undefined) throw new Error(`FW_RTC.txt has no "${key}" setting to change`);
    const next = String(value);
    if (/[\r\n]/.test(next)) throw new Error(`Value for "${key}" must be a single line`);
    this.rows[at].value = next;
    return this;
  }

  keys() {
    return [...this.index.keys()];
  }

  // The value as the file was read, before any edit in this session.
  original(key) {
    return this.originals.get(normalizeKey(key));
  }

  // Every key whose value differs from the file as it was read.
  changes() {
    const out = [];
    for (const [norm, at] of this.index) {
      const row = this.rows[at];
      const before = this.originals.get(norm);
      if (row.value !== before) out.push({ key: row.key, norm, from: before, to: row.value });
    }
    return out;
  }

  get dirty() {
    return this.changes().length > 0;
  }

  toText() {
    let out = this.bom;
    for (const row of this.rows) {
      out += row.kind === 'kv' ? row.prefix + row.value + row.trail : row.text;
      out += row.eol;
    }
    return out;
  }
}

export function parse(text) {
  return new SettingsFile(text);
}
