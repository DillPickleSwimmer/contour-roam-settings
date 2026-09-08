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
  { id: 'DT', label: 'Clock', type: 'datetime', group: 'camera' },
];

export const GROUPS = [
  { id: 'video', label: 'Video' },
  { id: 'image', label: 'Image' },
  { id: 'audio', label: 'Audio' },
  { id: 'camera', label: 'Camera' },
];

// Keys the app must never write. UPDATE_FW triggers a firmware flash on the next
// boot, and CUID / FW version identify the hardware.
export const READ_ONLY = new Set(['UPDATE_FW', 'CUID', 'FW VERSION', 'FW NAME']);

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
