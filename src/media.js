// Reading and clearing the camera's recordings.
//
// Everything here needs a directory handle, so it is only available when the
// camera was connected by picking its drive rather than the settings file.

export const MEDIA_ROOT = 'DCIM';

const VIDEO = /\.(mp4|mov|avi|m4v)$/i;
const SIDECAR = /\.(thm|lrv|wav|jpg|jpeg|png)$/i;
// Resource forks macOS leaves on FAT volumes. Junk, but they take up space.
const APPLE_DOUBLE = /^\._/;

// Never delete or list these as media, whatever folder they turn up in.
const PROTECTED = /^(FW_RTC\.txt|FW_RTC_DEFAULTS\.txt|.*\.bin)$/i;

export function classify(name) {
  if (PROTECTED.test(name)) return 'protected';
  if (APPLE_DOUBLE.test(name)) return 'junk';
  if (VIDEO.test(name)) return 'video';
  if (SIDECAR.test(name)) return 'sidecar';
  return 'other';
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

async function getMediaRoot(dir) {
  try {
    return await dir.getDirectoryHandle(MEDIA_ROOT);
  } catch {
    return null;
  }
}

// Walks DCIM/<folder>/ and reports what is in there. Files that are not
// recordings are counted separately so the user knows what a delete would take.
export async function listMedia(dir) {
  const root = await getMediaRoot(dir);
  const result = { present: Boolean(root), folders: [], videos: 0, extras: 0, bytes: 0 };
  if (!root) return result;

  for await (const [folderName, folder] of root.entries()) {
    if (folder.kind !== 'directory') continue;
    const entry = { name: folderName, handle: folder, files: [] };

    for await (const [name, handle] of folder.entries()) {
      if (handle.kind !== 'file') continue;
      const kind = classify(name);
      if (kind === 'protected') continue;

      let size = 0;
      let modified = null;
      try {
        const file = await handle.getFile();
        size = file.size;
        modified = file.lastModified;
      } catch {
        // Unreadable entry; still list it so a delete can try to remove it.
      }

      entry.files.push({ name, handle, kind, size, modified });
      result.bytes += size;
      if (kind === 'video') result.videos++;
      else result.extras++;
    }

    entry.files.sort((a, b) => a.name.localeCompare(b.name));
    if (entry.files.length) result.folders.push(entry);
  }

  result.folders.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// Deletes every recording and its sidecars, leaving the DCIM folders in place
// because the camera expects them to exist. Returns what it could not remove
// rather than throwing on the first failure, so one locked file does not strand
// the rest.
export async function deleteAllMedia(dir, onProgress) {
  const listing = await listMedia(dir);
  const total = listing.folders.reduce((n, f) => n + f.files.length, 0);
  const failed = [];
  let done = 0;

  for (const folder of listing.folders) {
    for (const file of folder.files) {
      try {
        await folder.handle.removeEntry(file.name);
      } catch (err) {
        failed.push({ name: file.name, reason: err?.message || String(err) });
      }
      done++;
      onProgress?.(done, total);
    }
  }

  return { attempted: total, failed, freed: listing.bytes };
}

// Picks a name that is free in the destination, so copying twice, or copying
// two DCIM folders that reuse filenames, never silently overwrites anything.
async function freeName(dest, name, taken) {
  const exists = async (candidate) => {
    if (taken.has(candidate)) return true;
    try {
      await dest.getFileHandle(candidate);
      return true;
    } catch {
      return false;
    }
  };

  if (!(await exists(name))) return name;

  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Too many copies of ${name} already in that folder`);
}

// Copies every recording and sidecar into a folder the user picked. Streams
// rather than buffering, because a single clip off this camera can be most of a
// gigabyte. Junk resource forks are skipped; a failure on one file is recorded
// and the rest continue.
export async function copyAllTo(dest, listing, onProgress) {
  const queue = listing.folders.flatMap((folder) =>
    folder.files.filter((f) => f.kind === 'video' || f.kind === 'sidecar')
  );

  const taken = new Set();
  const failed = [];
  let copied = 0;
  let bytes = 0;

  for (const [index, file] of queue.entries()) {
    onProgress?.({ index, done: copied, total: queue.length, name: file.name });
    try {
      const source = await file.handle.getFile();
      const name = await freeName(dest, file.name, taken);
      taken.add(name);

      const target = await dest.getFileHandle(name, { create: true });
      const writable = await target.createWritable();
      try {
        if (typeof source.stream === 'function') {
          // pipeTo closes the writable for us.
          await source.stream().pipeTo(writable);
        } else {
          await writable.write(await source.arrayBuffer());
          await writable.close();
        }
      } catch (err) {
        await writable.abort?.();
        throw err;
      }

      copied++;
      bytes += file.size;
    } catch (err) {
      failed.push({ name: file.name, reason: err?.message || String(err) });
    }
  }

  onProgress?.({ index: queue.length, done: copied, total: queue.length, name: null });
  return { total: queue.length, copied, failed, bytes };
}

export async function readDefaults(dir, filename = 'FW_RTC_DEFAULTS.txt') {
  const handle = await dir.getFileHandle(filename);
  const buf = await (await handle.getFile()).arrayBuffer();
  return buf;
}
