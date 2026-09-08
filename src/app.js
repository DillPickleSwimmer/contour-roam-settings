import { parse } from './format.js';
import {
  PROFILE_FIELDS, GLOBAL_FIELDS, GROUPS, detectProfiles, describeCamera, formatDT,
} from './schema.js';
import { fieldRow, el } from './ui.js';
import * as camera from './camera.js';

const $ = (id) => document.getElementById(id);

const state = {
  file: null,      // SettingsFile
  handle: null,    // FileSystemFileHandle, when we can write in place
  origin: '',      // where it came from, shown to the user
  profile: '1',
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

async function load(text, { handle = null, origin }) {
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
  state.origin = origin;
  state.profile = profiles[0];
  clearStatus();
  render();
  show('editor');
}

async function fromHandle(handle, origin) {
  if (!(await camera.verifyPermission(handle, true))) {
    throw new Error('Permission to edit that file was declined.');
  }
  await load(await camera.readHandle(handle), { handle, origin });
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
  now: () => formatDT(new Date()),
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

function renderSaveBar() {
  const changes = state.file.changes().filter((c) => c.norm !== 'UPDATE');
  const n = changes.length;
  $('save').disabled = n === 0;
  $('count').replaceChildren(
    n === 0
      ? document.createTextNode('No changes yet')
      : el('span', {}, [
          el('b', { textContent: `${n} change${n === 1 ? '' : 's'}` }),
          document.createTextNode(' · will set '),
          el('code', { textContent: 'UPDATE:Y' }),
        ])
  );
  $('revert').hidden = n === 0;
}

// --- actions ---------------------------------------------------------------

async function connectDirectory() {
  const handle = await camera.pickDirectory();
  await fromHandle(handle, `${handle.name} on the camera drive`);
  await camera.remember(handle);
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
  state.file = state.handle = null;
  await camera.forget();
  clearStatus();
  show('connect');
  await refreshResume();
}

async function save() {
  const file = state.file;
  // The camera ignores an edited file unless this flag is set. Storyteller did
  // the same thing; it is the whole reason a settings change takes effect.
  if (file.has('UPDATE')) file.set('UPDATE', 'Y');
  const text = file.toText();

  if (state.handle) {
    await camera.writeHandle(state.handle, text);
    await load(text, { handle: state.handle, origin: state.origin });
    status('good', el('div', {}, [
      el('strong', { textContent: 'Saved to the camera. ' }),
      document.createTextNode('To apply the settings:'),
      el('ol', {}, [
        el('li', { textContent: 'Eject the camera drive, then unplug the USB cable.' }),
        el('li', { textContent: 'Press and release the status button. The camera beeps and turns off.' }),
        el('li', { textContent: 'Turn it on again — the new settings are live.' }),
      ]),
    ]));
  } else {
    camera.download(text);
    // Two different reasons land here: the browser has no write access at all,
    // or the file was opened as a copy so there is no handle to write back to.
    const why = camera.canWriteInPlace
      ? 'This is a copy rather than the file on the camera, so finish by hand:'
      : 'This browser cannot write to the camera directly, so finish by hand:';
    status('good', el('div', {}, [
      el('strong', { textContent: 'Downloaded FW_RTC.txt. ' }),
      document.createTextNode(why),
      el('ol', {}, [
        el('li', { textContent: 'Copy the downloaded FW_RTC.txt onto the camera drive, replacing the one there.' }),
        el('li', { textContent: 'Eject the camera drive, then unplug the USB cable.' }),
        el('li', { textContent: 'Press and release the status button, then turn the camera on again.' }),
      ]),
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
        const kind = handle.kind === 'directory' ? await handle.getFileHandle(camera.FILENAME) : handle;
        await fromHandle(kind, handle.name);
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

  refreshResume();
  show('connect');
}
