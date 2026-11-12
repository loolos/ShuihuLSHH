// 极简 IndexedDB 键值存储：缓存玩家原版文件的原始字节，下次启动不必重新选择目录。
const DB = 'shuihu-lshh';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function idbPutAll(entries: Map<string, ArrayBuffer>): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const st = tx.objectStore(STORE);
  st.clear();
  for (const [k, v] of entries) st.put(v, k);
  await done(tx);
  db.close();
}

/** 追加或覆盖一项（不清空） */
export async function idbPut(k: string, v: ArrayBuffer): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(v, k);
  await done(tx);
  db.close();
}

export async function idbGetAll(): Promise<Map<string, ArrayBuffer>> {
  const db = await open();
  const tx = db.transaction(STORE, 'readonly');
  const st = tx.objectStore(STORE);
  const out = new Map<string, ArrayBuffer>();
  await new Promise<void>((resolve, reject) => {
    const req = st.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      out.set(String(c.key), c.value as ArrayBuffer);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
}

export async function idbClear(): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await done(tx);
  db.close();
}
