import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, normalizeKey } from '../src/format.js';
import { detectProfiles, describeCamera, validate, resolutionOptions, PROFILE_FIELDS, formatDT } from '../src/schema.js';

const SAMPLE = readFileSync(new URL('../samples/ContourROAM2_FW_RTC.txt', import.meta.url), 'latin1');

test('round trips a real camera file byte for byte', () => {
  assert.equal(parse(SAMPLE).toText(), SAMPLE);
});

test('preserves CRLF line endings after an edit', () => {
  const f = parse(SAMPLE);
  f.set('1RES', 'D');
  const out = f.toText();
  assert.match(out, /1RES:D\r\n/);
  assert.equal(out.split('\r\n').length, SAMPLE.split('\r\n').length);
  assert.ok(!/[^\r]\n/.test(out), 'no bare LF should appear');
});

test('an edit changes only the intended line', () => {
  const f = parse(SAMPLE);
  f.set('1MIC', '30');
  const before = SAMPLE.split('\r\n');
  const after = f.toText().split('\r\n');
  const differing = before.map((l, i) => [i, l, after[i]]).filter(([, a, b]) => a !== b);
  assert.deepEqual(differing, [[8, '1MIC:17', '1MIC:30']]);
});

test('ignores the DATA STRUCTURE documentation block', () => {
  const f = parse(SAMPLE);
  // The docs contain lines like "\t Y:YES" and "Resolution(RES)" that look
  // parseable. None of them may become settings.
  assert.equal(f.has('Y'), false);
  assert.equal(f.has('N'), false);
  assert.equal(f.has('YYYY'), false);
  assert.equal(f.has('MM'), false);
  assert.equal(f.keys().length, 20);
});

test('keeps spacing quirks in the header', () => {
  const f = parse(SAMPLE);
  assert.equal(f.get('FW version'), '1800 V2.00');
  f.set('FW version', '1800 V2.00');
  assert.match(f.toText(), /FW version: 1800 V2\.00\r\n/);
});

test('reads values containing colons', () => {
  assert.equal(parse(SAMPLE).get('DT'), '2013/02/06 16:57:29');
});

test('key lookup is case and whitespace insensitive', () => {
  const f = parse(SAMPLE);
  assert.equal(f.get('camera name'), 'ContourROAM2');
  assert.equal(normalizeKey('  Camera   Name '), 'CAMERA NAME');
});

test('refuses to invent a key the firmware did not write', () => {
  const f = parse(SAMPLE);
  assert.throws(() => f.set('2RES', 'A'), /no "2RES" setting/);
  assert.equal(f.toText(), SAMPLE);
});

test('refuses a value that would inject a new line', () => {
  const f = parse(SAMPLE);
  assert.throws(() => f.set('CAMERA NAME', 'evil\r\nUPDATE_FW:Y'), /single line/);
});

test('tracks changes and dirty state', () => {
  const f = parse(SAMPLE);
  assert.equal(f.dirty, false);
  f.set('1EV', '2');
  assert.deepEqual(f.changes(), [{ key: '1EV', norm: '1EV', from: '0', to: '2' }]);
  f.set('1EV', '0');
  assert.equal(f.dirty, false, 'setting a value back should clear it');
});

test('handles LF-only and trailing-newline-free files', () => {
  const lf = 'UPDATE:N\n1RES:A\n';
  assert.equal(parse(lf).toText(), lf);
  const noEol = 'UPDATE:N\r\n1RES:A';
  const f = parse(noEol);
  f.set('1RES', 'B');
  assert.equal(f.toText(), 'UPDATE:N\r\n1RES:B');
});

test('preserves a byte order mark', () => {
  const withBom = '﻿UPDATE:N\r\n';
  assert.equal(parse(withBom).toText(), withBom);
});

test('identifies the camera and its profiles', () => {
  const f = parse(SAMPLE);
  assert.deepEqual(describeCamera(f), { name: 'ContourROAM2', version: '1800 V2.00', supported: true });
  assert.deepEqual(detectProfiles(f), ['1']);
});

test('resolution labels follow the PAL/NTSC frame rate', () => {
  assert.match(resolutionOptions('25')[3][1], /50fps/);
  assert.match(resolutionOptions('30')[3][1], /60fps/);
  assert.equal(resolutionOptions('25').length, 10);
});

test('validates against the ranges the firmware documents', () => {
  const field = (id) => PROFILE_FIELDS.find((f) => f.id === id);
  assert.equal(validate(field('MIC'), '42'), null);
  assert.match(validate(field('MIC'), '43'), /between 0 and 42/);
  assert.match(validate(field('EV'), '-5'), /between -4 and 4/);
  assert.equal(validate(field('EV'), '-4'), null);
  assert.match(validate(field('CTST'), '2.5'), /whole number/);
  assert.equal(validate(field('RES'), 'P/30', '25'), null);
  assert.match(validate(field('RES'), 'P/7', '25'), /not a value/);
  assert.equal(validate(field('SILENT'), '1'), null);
});

test('formats a date the way the camera writes it', () => {
  assert.equal(formatDT(new Date(2026, 8, 8, 4, 5, 6)), '2026/09/08 04:05:06');
});

test('byte decoding is an exact inverse of encoding', async () => {
  const { decodeBytes, encodeText } = await import('../src/camera.js');
  const all = new Uint8Array(256).map((_, i) => i);
  const text = decodeBytes(all.buffer);
  assert.equal(text.length, 256);
  assert.deepEqual([...encodeText(text)], [...all]);
  // The bytes windows-1252 would have mangled.
  assert.equal(text.charCodeAt(0x80), 0x80);
  assert.equal(text.charCodeAt(0x9f), 0x9f);
});

test('exposes the value a key had when the file was read', () => {
  const f = parse(SAMPLE);
  f.set('DT', '2026/01/01 00:00:00');
  assert.equal(f.original('DT'), '2013/02/06 16:57:29');
  assert.equal(f.get('DT'), '2026/01/01 00:00:00');
  // Restoring from original clears the dirty flag, which is what the clock
  // opt-out relies on.
  f.set('DT', f.original('DT'));
  assert.equal(f.dirty, false);
});

const DEFAULTS = readFileSync(new URL('../samples/ContourROAM2_FW_RTC_DEFAULTS.txt', import.meta.url), 'latin1');

test('reset copies the camera’s own defaults without touching identity', async () => {
  const { applyDefaults } = await import('../src/schema.js');
  const file = parse(SAMPLE);
  const defaults = parse(DEFAULTS);

  file.set('1MIC', '40');
  file.set('1AWB', '5');
  const applied = applyDefaults(file, defaults);

  assert.ok(applied.includes('1MIC'));
  assert.ok(applied.includes('1AWB'));
  assert.equal(file.get('1MIC'), '17');
  assert.equal(file.get('1AWB'), '0');

  // The defaults file carries its own CUID and a differently formatted version
  // line. Neither may leak into the live settings, and the firmware flag must
  // never be written from it.
  const touched = file.changes().map((c) => c.norm);
  assert.ok(!touched.includes('CUID'));
  assert.ok(!touched.includes('FW VERSION'));
  assert.ok(!touched.includes('UPDATE_FW'));
  assert.ok(!touched.includes('UPDATE'));
});

test('reset does not invent keys the live file lacks', async () => {
  const { applyDefaults } = await import('../src/schema.js');
  const file = parse('FW name:ContourROAM2\r\n1RES:A\r\n');
  applyDefaults(file, parse(DEFAULTS));
  assert.equal(file.get('1RES'), 'D');
  assert.equal(file.has('1MIC'), false, 'must not add a key the camera did not write');
  assert.equal(file.toText(), 'FW name:ContourROAM2\r\n1RES:D\r\n');
});
