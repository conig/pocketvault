let opening;
function database() {
  return opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('pocket-vault', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('data'); req.result.createObjectStore('assets'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('Local storage is unavailable. Enable browser storage to save notes offline.'));
  });
}
async function run(store, mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode), request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error || new Error('Could not save locally. Check available device storage.'));
    tx.onabort = () => reject(tx.error || new Error('Saving was interrupted. Your previous library is unchanged.'));
  });
}
export const read = key => run('data', 'readonly', s => s.get(key));
export const hasKey = key => run('data', 'readonly', s => s.getKey(key)).then(value => value !== undefined);
export const write = (key, value) => run('data', 'readwrite', s => s.put(value, key));
export const remove = key => run('data', 'readwrite', s => s.delete(key));
export const readAsset = key => run('assets', 'readonly', s => s.get(key));
export const writeAsset = (key, value) => run('assets', 'readwrite', s => s.put(value, key));
// Separate records avoid rewriting the snapshot on every read, and prevent
// simultaneous tabs opening different notes from overwriting one another.
const accessRange = (prefix = []) => IDBKeyRange.bound(['access', ...prefix], ['access', ...prefix, []]);
export const readAccesses = (repo, branch = '') => run('data', 'readonly', s => s.getAll(accessRange([repo, branch])))
  .then(rows => new Map(rows.map(({path, at}) => [path, at])));
export const writeAccess = (repo, branch, path, at) => write(['access', repo, branch || '', path], {path, at});
export async function clearAll() {
  await run('data', 'readwrite', s => s.clear());
  await run('assets', 'readwrite', s => s.clear());
}
export async function saveConnection(snapshot, config, credential) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['data', 'assets'], 'readwrite'), store = tx.objectStore('data');
    store.put(snapshot, 'snapshot'); store.put(config, 'config');
    const notePaths = new Set(snapshot.notes.map(n => n.path));
    const accesses = store.openCursor(accessRange());
    accesses.onsuccess = () => {
      const item = accesses.result;
      if (!item) return;
      const [, repo, branch, path] = item.key;
      if (repo !== snapshot.repo || branch !== (snapshot.branch || '') || !notePaths.has(path)) item.delete();
      item.continue();
    };
    // Purge attachments no longer referenced by the selected vaults in the
    // same transaction: a failed save cannot leave half-applied settings.
    const retained = new Set(snapshot.files.map(f => `${snapshot.repo}:${f.sha}`));
    const cursor = tx.objectStore('assets').openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      if (!retained.has(item.key)) item.delete();
      item.continue();
    };
    if (credential) store.put(credential, 'credential'); else store.delete('credential');
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not save your library. Your previous snapshot is unchanged.'));
  });
}
