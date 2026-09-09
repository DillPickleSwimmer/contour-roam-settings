import { parse, normalizeKey } from './format.js';
import {
  PROFILE_FIELDS, GLOBAL_FIELDS, GROUPS, detectProfiles, describeCamera, formatDT, fromInputValue,
  applyDefaults,
} from './schema.js';
import { fieldRow, el } from './ui.js';
import * as camera from './camera.js';
import * as media from './media.js';

const $ = (id) => document.getElementById(id);

// Stamping the clock on save is the default. These preferences are a
// per-browser convenience, so a blocked or private store just means the
// defaults apply.
const CLOCK_PREF = 'contour:sync-clock';
const CLOCK_CUSTOM_PREF = 'contour:clock-custom';

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are optional.
  }
};

// 'now' stamps the current time, 'custom' uses the picked date, 'off' keeps
// whatever the card already has. An earlier build stored on/off here.
function clockMode() {
  const stored = read(CLOCK_PREF);
  if (stored === 'off') return 'off';
  if (stored === 'custom') return 'custom';
  return 'now';
}

function setClockMode(mode) {
  write(CLOCK_PREF, mode);
  renderSaveBar();
}

const clockCustom = () => read(CLOCK_CUSTOM_PREF) ?? '';

function setClockCustom(value) {
  write(CLOCK_CUSTOM_PREF, value);
  renderSaveBar();
}

const state = {
  file: null,      // SettingsFile
  handle: null,    // FileSystemFileHandle, when we can write in place
  dir: null,       // FileSystemDirectoryHandle, when the drive itself was picked
  origin: '',      // where it came from, shown to the user
  profile: '1',
  confirmingWipe: false,
};

function show(view) {
  $('connect').hidden = view !== 'connect';
  $('editor').hidden = view !== 'editor';
}

function status(kind, node) {
  const box = $('status');
  box.className = `note ${kind}`;
  box.replaceChildren(node);
  box.hidden = false;
}

function clearStatus() {
  $('status').hidden = true;
}

// --- loading ---------------------------------------------------------------

async function load(text, { handle = null, dir = null, origin }) {
  const file = parse(text);
  const info = describeCamera(file);
  if (!info.supported) {
    throw new Error(
      `That file does not look like Contour camera settings (no "FW name" line). Pick FW_RTC.txt from the camera's drive.`
    );
  }
  const profiles = detectProfiles(file);
  if (!profiles.length) throw new Error('That FW_RTC.txt has no editable settings in it.');

  state.file = file;
  state.handle = handle;
  state.dir = dir;
  state.origin = origin;
  state.confirmingWipe = false;
  state.profile = profiles[0];
  clearStatus();
  render();
  show('editor');
}

async function fromHandle(handle, origin, dir = null) {
  if (!(await camera.verifyPermission(handle, true))) {
    throw new Error('Permission to edit that file was declined.');
  }
  await load(await camera.readHandle(handle), { handle, dir, origin });
  if (dir) refreshMedia();
}

async function guard(fn) {
  try {
    await fn();
  } catch (err) {
    if (err?.name === 'AbortError') return; // user closed the picker
    status('bad', el('span', { textContent: err.message || String(err) }));
  }
}

// --- rendering -------------------------------------------------------------

const ctx = {
  commit(key, value) {
    // Frame rate relabels every resolution option, so that one field rebuilds
    // the whole form rather than just updating the save bar.
    const rebuild = key === 'FPS' && state.file.get('FPS') !== value;
    state.file.set(key, value);
    if (rebuild) render();
    else renderSaveBar();
  },
  fps: () => state.file.get('FPS') ?? '30',
  clockMode,
  setClockMode,
  clockCustom,
  setClockCustom,
};

function render() {
  const { file, profile } = state;
  const info = describeCamera(file);

  const bar = $('bar');
  bar.className = 'bar';
  bar.replaceChildren(
    el('div', { style: 'min-width:0' }, [
      el('div', { className: 'bar-name', textContent: `${info.name}${info.version ? ` · firmware ${info.version}` : ''}` }),
      el('div', { className: 'bar-sub', textContent: state.origin }),
    ]),
    (() => {
      const b = el('button', { type: 'button', textContent: 'Disconnect' });
      b.onclick = () => guard(disconnect);
      return b;
    })()
  );

  const form = $('form');
  form.replaceChildren();

  for (const group of GROUPS) {
    const rows = el('div', { className: 'rows' });
    let used = 0;

    for (const field of GLOBAL_FIELDS.filter((f) => f.group === group.id)) {
      if (!file.has(field.id)) continue;
      rows.append(fieldRow(field, field.id, file.get(field.id), ctx));
      used++;
    }
    for (const field of PROFILE_FIELDS.filter((f) => f.group === group.id)) {
      const key = `${profile}${field.id}`;
      if (!file.has(key)) continue;
      rows.append(fieldRow(field, key, file.get(key), ctx));
      used++;
    }

    if (!used) continue;
    form.append(el('div', { className: 'group-label', textContent: group.label }), rows);
  }

  if (file.get('UPDATE_FW')?.toUpperCase() === 'Y') {
    status('warn', el('span', {}, [
      el('strong', { textContent: 'Firmware flash is armed. ' }),
      document.createTextNode(
        'This file has UPDATE_FW:Y, so the camera will try to install a .bin from the card on its next start. This app never changes that flag.'
      ),
    ]));
  }

  renderSaveBar();
}

// Tints the rows the user has actually altered, so pending edits are visible in
// the form itself and not only as a count at the bottom.
function markChangedRows() {
  const dirty = new Set(
    state.file.changes().map((c) => c.norm).filter((k) => k !== 'DT' && k !== 'UPDATE')
  );
  for (const row of $('form').querySelectorAll('.row[data-key]')) {
    row.classList.toggle('changed', dirty.has(normalizeKey(row.dataset.key)));
  }
}

function renderSaveBar() {
  const changes = state.file.changes().filter((c) => c.norm !== 'UPDATE' && c.norm !== 'DT');
  const n = changes.length;
  const clock = clockMode() !== 'off' && state.file.has('DT');

  // Syncing the clock is worth a save on its own, so it can enable the button.
  $('save').disabled = n === 0 && !clock;

  const parts = [];
  if (n === 0) parts.push(document.createTextNode(clock ? 'Clock only' : 'No changes yet'));
  else parts.push(el('b', { textContent: `${n} change${n === 1 ? '' : 's'}` }));
  parts.push(document.createTextNode(' · sets '));
  parts.push(el('code', { textContent: 'UPDATE:Y' }));
  if (clock) parts.push(document.createTextNode(' and the clock'));

  $('count').replaceChildren(el('span', {}, parts));
  $('revert').hidden = n === 0;
  $('reset').hidden = !state.dir;
  markChangedRows();
}

// --- recordings ------------------------------------------------------------

// A web page cannot open a Finder or Explorer window; there is no browser API
// for it at any permission level. Listing what is on the card gives the same
// information the folder would, and a copy button gives the same access.
async function refreshMedia() {
  const panel = $('media');
  if (!state.dir) {
    panel.replaceChildren();
    return;
  }

  let listing;
  try {
    listing = await media.listMedia(state.dir);
  } catch (err) {
    panel.replaceChildren(el('p', { className: 'note bad', textContent: `Could not read recordings: ${err.message}` }));
    return;
  }

  const card = el('section', { className: 'media' });
  const summary = listing.videos
    ? `${listing.videos} recording${listing.videos === 1 ? '' : 's'}` +
      (listing.extras ? ` and ${listing.extras} related file${listing.extras === 1 ? '' : 's'}` : '') +
      ` · ${media.formatBytes(listing.bytes)}`
    : listing.present
      ? 'No recordings on the card'
      : 'No DCIM folder on this card';

  card.append(
    el('div', { className: 'media-head' }, [
      el('h2', { textContent: 'Recordings' }),
      el('span', { className: 'media-sum', textContent: summary }),
    ])
  );

  if (listing.folders.length) {
    const rows = el('div', { className: 'rows' });
    for (const folder of listing.folders) {
      rows.append(el('div', { className: 'folder-label', textContent: `DCIM/${folder.name}` }));
      for (const file of folder.files) {
        const meta = [media.formatBytes(file.size)];
        if (file.modified) meta.push(new Date(file.modified).toLocaleDateString());
        const row = el('div', { className: `file ${file.kind}` }, [
          el('span', { className: 'file-name', textContent: file.name }),
          el('span', { className: 'file-meta', textContent: meta.join(' · ') }),
        ]);
        if (file.kind === 'video' || file.kind === 'sidecar') {
          const save = el('button', { type: 'button', textContent: 'Copy out', style: 'font-size:13px;padding:5px 10px' });
          save.onclick = () =>
            guard(async () => camera.downloadBlob(await file.handle.getFile(), file.name));
          row.append(save);
        }
        rows.append(row);
      }
    }
    card.append(rows);
  }

  const actions = el('div', { className: 'media-actions' });
  const refresh = el('button', { type: 'button', textContent: 'Refresh' });
  refresh.onclick = () => guard(refreshMedia);
  actions.append(refresh);

  const deletable = listing.folders.reduce((n, f) => n + f.files.length, 0);
  if (deletable) {
    if (state.confirmingWipe) {
      const confirm = el('button', { type: 'button', className: 'danger', textContent: `Delete ${deletable} file${deletable === 1 ? '' : 's'} permanently` });
      confirm.onclick = () => guard(wipeMedia);
      const cancel = el('button', { type: 'button', textContent: 'Cancel' });
      cancel.onclick = () => {
        state.confirmingWipe = false;
        refreshMedia();
      };
      actions.append(confirm, cancel);
      card.append(
        actions,
        el('p', { className: 'note bad', style: 'margin-top:12px' }, [
          el('strong', { textContent: 'This cannot be undone. ' }),
          document.createTextNode(
            `${media.formatBytes(listing.bytes)} will be erased from the card. Copy anything you want to keep first — the Copy out buttons above save a file to your computer.`
          ),
        ])
      );
    } else {
      const wipe = el('button', { type: 'button', className: 'danger', textContent: 'Delete all recordings' });
      wipe.onclick = () => {
        state.confirmingWipe = true;
        refreshMedia();
      };
      actions.append(wipe);
      card.append(actions);
    }
  } else {
    card.append(actions);
  }

  panel.replaceChildren(card);
}

async function wipeMedia() {
  state.confirmingWipe = false;
  const result = await media.deleteAllMedia(state.dir);
  await refreshMedia();

  if (result.failed.length) {
    status('warn', el('div', {}, [
      el('strong', { textContent: `Deleted ${result.attempted - result.failed.length} of ${result.attempted} files. ` }),
      document.createTextNode(`Could not remove: ${result.failed.map((f) => f.name).join(', ')}.`),
    ]));
  } else {
    status('good', el('span', {}, [
      el('strong', { textContent: 'Card cleared. ' }),
      document.createTextNode(`${result.attempted} file${result.attempted === 1 ? '' : 's'} deleted, ${media.formatBytes(result.freed)} freed.`),
    ]));
  }
}

// --- actions ---------------------------------------------------------------

async function connectDirectory() {
  const { dir, file } = await camera.pickDirectory();
  await fromHandle(file, `FW_RTC.txt on ${dir.name}`, dir);
  await camera.remember(dir);
}

async function connectFile() {
  const handle = await camera.pickFile();
  await fromHandle(handle, handle.name);
  await camera.remember(handle);
}

async function connectUpload(file) {
  await load(camera.decodeBytes(await file.arrayBuffer()), { origin: `${file.name} (copy)` });
}

async function disconnect() {
  state.file = state.handle = state.dir = null;
  $('media').replaceChildren();
  await camera.forget();
  clearStatus();
  show('connect');
  await refreshResume();
}

// Throws rather than silently writing a wrong date.
function clockValue(file) {
  const mode = clockMode();
  if (mode === 'off') return file.original('DT');
  if (mode === 'now') return formatDT(new Date());
  const picked = fromInputValue(clockCustom());
  if (!picked) throw new Error('Pick a valid date for the clock, or set the clock to "Set to now".');
  return picked;
}

async function save() {
  const file = state.file;
  // The clock is app-managed in every mode, including 'off': without putting
  // the original back, a stamp from an earlier save in this session would
  // survive being switched off.
  if (file.has('DT')) file.set('DT', clockValue(file));
  // The camera ignores an edited file unless this flag is set. Storyteller did
  // the same thing; it is the whole reason a settings change takes effect.
  if (file.has('UPDATE')) file.set('UPDATE', 'Y');
  const text = file.toText();

  if (state.handle) {
    await camera.writeHandle(state.handle, text);
    await load(text, { handle: state.handle, dir: state.dir, origin: state.origin });
    status('good', el('div', {}, [
      el('strong', { textContent: 'Settings saved. ' }),
      document.createTextNode('To apply them:'),
      el('ol', {}, [
        el('li', { textContent: 'Eject the drive, then unplug the reader or cable.' }),
        el('li', { textContent: 'Put the card back in the camera if you used a reader.' }),
        el('li', { textContent: 'Turn the camera on. It reads the file at startup and the new settings are live.' }),
      ]),
    ]));
  } else {
    camera.download(text);
    // Two different reasons land here: the browser has no write access at all,
    // or the file was opened as a copy so there is no handle to write back to.
    const why = camera.canWriteInPlace
      ? 'This is a copy rather than the file on the card, so finish by hand:'
      : 'This browser cannot write to the card directly, so finish by hand:';
    status('good', el('div', {}, [
      el('strong', { textContent: 'Downloaded FW_RTC.txt. ' }),
      document.createTextNode(why),
      el('ol', {}, [
        el('li', { textContent: 'Copy the downloaded FW_RTC.txt onto the drive, replacing the one there.' }),
        el('li', { textContent: 'Eject the drive, then unplug the reader or cable.' }),
        el('li', { textContent: 'Put the card back in the camera if you used a reader, then turn the camera on.' }),
      ]),
    ]));
  }
}

async function resetToDefaults() {
  const buf = await media.readDefaults(state.dir);
  const defaults = parse(camera.decodeBytes(buf));
  const applied = applyDefaults(state.file, defaults);

  clearStatus();
  render();

  if (!applied.length) {
    status('good', el('span', { textContent: 'Everything already matches the factory defaults.' }));
  } else {
    status('good', el('span', {}, [
      el('strong', { textContent: `Reset ${applied.length} setting${applied.length === 1 ? '' : 's'}. ` }),
      document.createTextNode('Nothing is written to the card until you press Save settings.'),
    ]));
  }
}

function revert() {
  const { file } = state;
  for (const change of file.changes()) file.set(change.key, change.from);
  clearStatus();
  render();
}

// --- startup ---------------------------------------------------------------

async function refreshResume() {
  const handle = await camera.recall();
  const button = $('resume');
  button.hidden = !handle;
  if (handle) {
    button.textContent = `Reconnect ${handle.name}`;
    button.onclick = () =>
      guard(async () => {
        const isDir = handle.kind === 'directory';
        const file = isDir ? await camera.findFile(handle) : handle;
        await fromHandle(file, isDir ? `FW_RTC.txt on ${handle.name}` : handle.name, isDir ? handle : null);
      });
  }
}

export function start() {
  $('year').textContent = String(new Date().getFullYear());

  if (!camera.canWriteInPlace) {
    $('fsa-only').hidden = true;
    $('fallback-note').hidden = false;
  }
  $('pick-dir').hidden = !camera.canPickDirectory;

  $('pick-dir').onclick = () => guard(connectDirectory);
  $('pick-file').onclick = () => guard(connectFile);
  $('upload').onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) guard(() => connectUpload(file));
    e.target.value = '';
  };
  $('save').onclick = () => guard(save);
  $('revert').onclick = revert;
  $('reset').onclick = () => guard(resetToDefaults);

  refreshResume();
  show('connect');
}
