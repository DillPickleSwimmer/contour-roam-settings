// Getting at FW_RTC.txt on the mounted camera.
//
// Three tiers, best first:
//   1. showDirectoryPicker - pick the camera volume, we locate the file. Also
//      sidesteps the file being flagged hidden, which hides it in open dialogs.
//   2. showOpenFilePicker - pick FW_RTC.txt directly, if a directory is refused.
//   3. <input type=file> plus a download, for browsers with no write access.

export const FILENAME = 'FW_RTC.txt';

export const canWriteInPlace =
  typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
export const canPickDirectory =
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

const DB = 'contour-roam-settings';
const STORE = 'handles';
const KEY = 'last-file';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Private windows and blocked storage are fine; we just lose the shortcut.
    return null;
  }
}

export const remember = (handle) => withStore('readwrite', (s) => s.put(handle, KEY));
export const forget = () => withStore('readwrite', (s) => s.delete(KEY));
export const recall = () => withStore('readonly', (s) => s.get(KEY));

// Chrome only grants persisted handles after a user gesture, so this is called
// from a click rather than on page load.
export async function verifyPermission(handle, write) {
  const opts = { mode: write ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

export function findFile(dir) {
  return dir.getFileHandle(FILENAME).catch(async () => {
    // Some cards report a different case than the firmware documents.
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && name.toLowerCase() === FILENAME.toLowerCase()) return handle;
    }
    throw new Error(
      `No ${FILENAME} in that folder. Pick the camera's drive itself, not a folder inside it.`
    );
  });
}

export async function pickDirectory() {
  const dir = await window.showDirectoryPicker({ id: 'contour-camera', mode: 'readwrite' });
  return { dir, file: await findFile(dir) };
}

export async function pickFile() {
  const [handle] = await window.showOpenFilePicker({
    id: 'contour-file',
    types: [{ description: 'Contour settings', accept: { 'text/plain': ['.txt'] } }],
    excludeAcceptAllOption: false,
    multiple: false,
  });
  return handle;
}

// The file is plain ASCII, but decode byte-for-byte so that anything unexpected
// round trips instead of turning into U+FFFD. TextDecoder cannot do this: the
// Encoding Standard maps the "latin1" and "iso-8859-1" labels to windows-1252,
// which rewrites 0x80-0x9F. A direct byte to code point map is a true inverse
// of encodeText below.
export async function readHandle(handle) {
  const file = await handle.getFile();
  const buf = await file.arrayBuffer();
  return decodeBytes(buf);
}

export function decodeBytes(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

export function encodeText(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new Error('Settings must use plain ASCII characters');
    out[i] = code;
  }
  return out;
}

export async function writeHandle(handle, text) {
  const writable = await handle.createWritable();
  try {
    await writable.write(encodeText(text));
  } catch (err) {
    await writable.abort();
    throw err;
  }
  await writable.close();
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function download(text, name = FILENAME) {
  const url = URL.createObjectURL(new Blob([encodeText(text)], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
