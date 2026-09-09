import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { listMedia, deleteAllMedia, readDefaults, classify, formatBytes } from '../src/media.js';

// Minimal stand-in for FileSystemDirectoryHandle over a real directory, so the
// deletion path is exercised against actual files rather than a mock that
// cannot fail the way a filesystem does.
function fileHandle(path) {
  return {
    kind: 'file',
    name: basename(path),
    async getFile() {
      const [buf, st] = await Promise.all([readFile(path), stat(path)]);
      return {
        size: st.size,
        lastModified: st.mtimeMs,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    },
  };
}

function dirHandle(path) {
  return {
    kind: 'directory',
    name: basename(path),
    async *entries() {
      for (const e of await readdir(path, { withFileTypes: true })) {
        const child = join(path, e.name);
        yield [e.name, e.isDirectory() ? dirHandle(child) : fileHandle(child)];
      }
    },
    async getDirectoryHandle(name) {
      const child = join(path, name);
      if (!(await stat(child)).isDirectory()) throw new Error('not a directory');
      return dirHandle(child);
    },
    async getFileHandle(name) {
      const child = join(path, name);
      await stat(child);
      return fileHandle(child);
    },
    async removeEntry(name) {
      await rm(join(path, name));
    },
  };
}

async function makeCard() {
  const root = await mkdtemp(join(tmpdir(), 'cntr-'));
  await mkdir(join(root, 'DCIM', '100MEDIA'), { recursive: true });
  await writeFile(join(root, 'DCIM', '100MEDIA', 'FILE0104.MP4'), Buffer.alloc(4096));
  await writeFile(join(root, 'DCIM', '100MEDIA', 'FILE0104.THM'), Buffer.alloc(512));
  await writeFile(join(root, 'DCIM', '100MEDIA', '._FILE0104.MP4'), Buffer.alloc(64));
  await writeFile(join(root, 'FW_RTC.txt'), 'FW name:ContourROAM2\r\n');
  await writeFile(join(root, 'FW_RTC_DEFAULTS.txt'), 'FW version: ContourROAM2 V2.16\r\n1RES:D\r\n');
  return { root, handle: dirHandle(root) };
}

test('lists recordings and their sidecars', async () => {
  const { handle } = await makeCard();
  const listing = await listMedia(handle);
  assert.equal(listing.present, true);
  assert.equal(listing.videos, 1);
  assert.equal(listing.extras, 2); // the .THM and the AppleDouble
  assert.equal(listing.bytes, 4096 + 512 + 64);
  assert.deepEqual(listing.folders.map((f) => f.name), ['100MEDIA']);
});

test('never lists the settings files as media', async () => {
  const { root, handle } = await makeCard();
  // Even if they somehow end up inside DCIM.
  await writeFile(join(root, 'DCIM', '100MEDIA', 'FW_RTC.txt'), 'x');
  const listing = await listMedia(handle);
  const names = listing.folders.flatMap((f) => f.files.map((x) => x.name));
  assert.ok(!names.includes('FW_RTC.txt'), 'settings file must not be listed');
});

test('deleting recordings leaves the settings files and the folders alone', async () => {
  const { root, handle } = await makeCard();
  const result = await deleteAllMedia(handle);

  assert.equal(result.attempted, 3);
  assert.deepEqual(result.failed, []);
  assert.equal(result.freed, 4096 + 512 + 64);

  assert.deepEqual((await readdir(join(root, 'DCIM', '100MEDIA'))).sort(), []);
  // The camera expects DCIM to exist, and the settings must survive.
  assert.ok((await stat(join(root, 'DCIM', '100MEDIA'))).isDirectory());
  assert.ok((await stat(join(root, 'FW_RTC.txt'))).isFile());
  assert.ok((await stat(join(root, 'FW_RTC_DEFAULTS.txt'))).isFile());
});

test('reports files it could not delete instead of stopping', async () => {
  const { handle } = await makeCard();
  const media = await handle.getDirectoryHandle('DCIM');
  const folder = await media.getDirectoryHandle('100MEDIA');
  const realRemove = folder.removeEntry;
  // One stubborn file must not strand the others.
  const patched = {
    ...folder,
    removeEntry: async (name) =>
      name === 'FILE0104.THM' ? Promise.reject(new Error('locked')) : realRemove.call(folder, name),
  };
  const wrapper = {
    ...handle,
    async getDirectoryHandle() {
      return { ...media, async *entries() { yield ['100MEDIA', patched]; } };
    },
  };

  const result = await deleteAllMedia(wrapper);
  assert.equal(result.attempted, 3);
  assert.deepEqual(result.failed.map((f) => f.name), ['FILE0104.THM']);
});

test('handles a card with no DCIM folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cntr-'));
  await writeFile(join(root, 'FW_RTC.txt'), 'FW name:ContourROAM2\r\n');
  const listing = await listMedia(dirHandle(root));
  assert.equal(listing.present, false);
  assert.equal(listing.videos, 0);
  assert.deepEqual(listing.folders, []);
});

test('reads the defaults file the camera writes', async () => {
  const { handle } = await makeCard();
  const buf = await readDefaults(handle);
  assert.match(Buffer.from(buf).toString('latin1'), /1RES:D/);
});

test('classifies card contents', () => {
  assert.equal(classify('FILE0104.MP4'), 'video');
  assert.equal(classify('file0104.mov'), 'video');
  assert.equal(classify('FILE0104.THM'), 'sidecar');
  assert.equal(classify('._FILE0104.MP4'), 'junk');
  assert.equal(classify('FW_RTC.txt'), 'protected');
  assert.equal(classify('FW_RTC_DEFAULTS.txt'), 'protected');
  assert.equal(classify('ContourROAM2.bin'), 'protected');
});

test('formats sizes the way a person reads them', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(91245666), '87 MB');
});
