// What each FW_RTC.txt key means, in the camera's own terms.
//
// Values and ranges are taken from the DATA STRUCTURE block the firmware writes
// into the file itself, so this table is documentation the camera agrees with.

export const AWB = [
  ['0', 'Auto'],
  ['1', '2800K incandescent'],
  ['2', '4000K fluorescent'],
  ['3', '5000K daylight D50'],
  ['4', '6500K daylight D65'],
  ['5', '7500K cloudy'],
  ['6', '9000K shade'],
  ['7', '10000K xenon HID'],
];

export const PHOTO_INTERVALS = ['1', '3', '5', '10', '30', '60'];

// Resolution letters mean different frame rates depending on the global FPS
// setting: 25 is PAL, 30 is NTSC. Same letter, different video.
export function resolutionOptions(fps) {
  const pal = String(fps) === '25';
  const base = pal ? 25 : 30;
  const fast = pal ? 50 : 60;
  return [
    ['A', `1080p · 1920×1080 ${base}fps`],
    ['B', `960p · 1280×960 ${base}fps`],
    ['C', `720p · 1280×720 ${base}fps`],
    ['D', `720p · 1280×720 ${fast}fps`],
    ...PHOTO_INTERVALS.map((s) => [`P/${s}`, `Photo · 5MP every ${s}s`]),
  ];
}

// Fields that live under a per-switch-position prefix ("1RES", "1BR", ...).
// The Roam2 has one recording position; Contour+2 and ContourHD have two.
export const PROFILE_FIELDS = [
  { id: 'RES', label: 'Resolution', type: 'enum', group: 'video', options: resolutionOptions, dependsOn: 'FPS' },
  { id: 'BR', label: 'Bitrate', type: 'enum', group: 'video', options: [['H', 'High'], ['L', 'Low']] },
  { id: 'EV', label: 'Exposure', type: 'range', group: 'video', min: -4, max: 4, step: 1, hint: '0 is neutral' },
  { id: 'AE', label: 'Metering', type: 'enum', group: 'video', options: [['C', 'Center'], ['A', 'Average'], ['S', 'Spot']] },
  { id: 'AWB', label: 'White balance', type: 'enum', group: 'video', options: AWB },
  { id: 'SHRP', label: 'Sharpness', type: 'range', group: 'image', min: 1, max: 5, step: 1 },
  { id: 'CTST', label: 'Contrast', type: 'range', group: 'image', min: 1, max: 255, step: 1, hint: 'factory default is 62' },
  { id: 'MIC', label: 'Mic level', type: 'range', group: 'audio', min: 0, max: 42, step: 1, unit: 'dB' },
  { id: 'LSR', label: 'Alignment lasers', type: 'toggle', group: 'camera', on: '1', off: '0' },
  { id: 'LED', label: 'Status LEDs', type: 'toggle', group: 'camera', on: '1', off: '0' },
  // Stored inverted: SILENT:1 means beeps are off.
  { id: 'SILENT', label: 'Beeps', type: 'toggle', group: 'camera', on: '0', off: '1' },
];

export const GLOBAL_FIELDS = [
  { id: 'FPS', label: 'Frame rate', type: 'enum', group: 'video', options: [['25', '25 / 50 · PAL'], ['30', '30 / 60 · NTSC']] },
  { id: 'CAMERA NAME', label: 'Camera name', type: 'text', group: 'camera', maxLength: 20 },
  { id: 'DATA', label: 'Note', type: 'text', group: 'camera', maxLength: 100 },
  { id: 'DT', label: 'Clock', type: 'clock', group: 'camera', hint: (v) => `camera reads ${v}` },
];

// Plain-language explanation of each setting, keyed by field id. Kept apart
// from the field definitions so the prose is easy to read and edit on its own.
// Written for someone who owns the camera, not someone who reads spec sheets.
export const ABOUT = {
  RES: 'Frame size and speed. 1080p captures the most detail; the 720p fast option gives the smoothest motion and handles shake better. Larger settings fill the card faster.',
  BR: 'How much data per second the video is encoded with. High looks better and makes bigger files. Low fits noticeably more footage on the card.',
  EV: 'Brightens or darkens the whole picture. Raise it when your subject sits in shadow, lower it when bright sky washes everything out.',
  AE: 'Which part of the frame the camera reads to set exposure. Center suits most mounted use, Spot reads the middle only, Average balances the whole frame.',
  AWB: 'Corrects colour for the light you are shooting in. Auto handles most situations. Pick a preset if footage comes out too orange or too blue.',
  SHRP: 'How much edge definition the camera adds. 3 is neutral. Higher looks crisper but can leave visible halos along edges.',
  CTST: 'Separation between the darkest and lightest parts of the picture. 62 is the factory value. Higher is punchier but loses detail in shadows.',
  MIC: 'Microphone gain. Lower it when wind or engine noise drowns everything out. Raise it for quiet speech.',
  LSR: 'The two red lasers that project a level line so you can aim the camera while mounting it. They never appear in the recording.',
  LED: 'The indicator lights on the camera body. Turning them off is less conspicuous and saves a little battery.',
  SILENT: 'The tones the camera plays to confirm that recording started and stopped.',
  FPS: 'PAL or NTSC timing. This also decides what the resolution options mean: the fast option is 50fps on PAL and 60fps on NTSC. Match it to the standard where you live.',
  'CAMERA NAME': 'A label stored on the camera, up to 20 characters. Cosmetic, and handy if you own more than one.',
  DATA: 'A free text line the camera stores and otherwise leaves alone, up to 100 characters.',
  DT: 'The camera’s own date and time, stamped onto every file it records. It falls back to 2012 whenever the battery goes flat, so it is worth setting while you are here.',
};

export const GROUPS = [
  { id: 'video', label: 'Video' },
  { id: 'image', label: 'Image' },
  { id: 'audio', label: 'Audio' },
  { id: 'camera', label: 'Camera' },
];

// Keys the app must never write. UPDATE_FW triggers a firmware flash on the next
// boot, and CUID / FW version identify the hardware.
export const READ_ONLY = new Set(['UPDATE_FW', 'CUID', 'FW VERSION', 'FW NAME']);

// Copies values out of the camera's own FW_RTC_DEFAULTS.txt into the live
// settings. Only keys that exist in both files and are actually editable move
// across, so identity (CUID, FW version) and the firmware flag stay put — the
// defaults file carries its own CUID and a differently formatted version line.
export function applyDefaults(file, defaults) {
  const editable = new Set();
  for (const field of GLOBAL_FIELDS) editable.add(normalizeFieldKey(field.id));
  for (const profile of detectProfiles(file)) {
    for (const field of PROFILE_FIELDS) editable.add(normalizeFieldKey(profile + field.id));
  }

  const applied = [];
  for (const key of defaults.keys()) {
    if (!editable.has(key) || READ_ONLY.has(key)) continue;
    if (!file.has(key)) continue;
    const next = defaults.get(key);
    if (file.get(key) === next) continue;
    file.set(key, next);
    applied.push(key);
  }
  return applied;
}

const normalizeFieldKey = (key) => key.trim().toUpperCase().replace(/\s+/g, ' ');

export function detectProfiles(file) {
  const found = new Set();
  for (const key of file.keys()) {
    const m = /^(\d+)(RES|BR|MIC|LED|LSR|SILENT|EV|SHRP|AE|CTST|AWB)$/.exec(key);
    if (m) found.add(m[1]);
  }
  return [...found].sort((a, b) => Number(a) - Number(b));
}

export function describeCamera(file) {
  const name = (file.get('FW name') || '').trim();
  const version = (file.get('FW version') || '').trim();
  const supported = /contour/i.test(name);
  return { name: name || 'Unknown camera', version, supported };
}

// The firmware documents its clock as accepting 2012 through 2040.
export const DT_MIN_YEAR = 2012;
export const DT_MAX_YEAR = 2040;

// Between the camera's "YYYY/MM/DD hh:mm:ss" and what <input type="datetime-local"> wants.
export function toInputValue(cameraDT) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(cameraDT ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : '';
}

export function fromInputValue(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  if (year < DT_MIN_YEAR || year > DT_MAX_YEAR) return null;
  return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}:${m[6] ?? '00'}`;
}

// "2013/02/06 16:57:29" as written by the camera.
export function formatDT(date) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${p(date.getFullYear(), 4)}/${p(date.getMonth() + 1)}/${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

export function fieldOptions(field, fps) {
  return typeof field.options === 'function' ? field.options(fps) : field.options;
}

// Validate a value against its field, returning null when it is acceptable.
export function validate(field, value, fps) {
  const raw = String(value);
  if (field.type === 'enum') {
    const ok = fieldOptions(field, fps).some(([v]) => v === raw);
    return ok ? null : `"${raw}" is not a value this camera accepts`;
  }
  if (field.type === 'range') {
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Must be a whole number';
    if (n < field.min || n > field.max) return `Must be between ${field.min} and ${field.max}`;
    return null;
  }
  if (field.type === 'toggle') {
    return raw === field.on || raw === field.off ? null : `"${raw}" is not a valid value`;
  }
  if (field.type === 'text') {
    if (field.maxLength && raw.length > field.maxLength) return `Limit is ${field.maxLength} characters`;
    if (/[\r\n]/.test(raw)) return 'Cannot contain line breaks';
    return null;
  }
  if (field.type === 'datetime') {
    return /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? null : 'Expected YYYY/MM/DD hh:mm:ss';
  }
  return null;
}
