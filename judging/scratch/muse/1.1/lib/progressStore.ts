type ProgressRecord = {
  id: string;
  profileId: string;
  titleId: string;
  progressSeconds: number;
  durationSeconds: number | null;
  percent: number;
  updatedAt: number;
};

const DB_NAME = "knight-progress-db";
const DB_VERSION = 1;
const STORE = "progress";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function makeId(profileId: string, titleId: string): string {
  return `${profileId}::${titleId}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byUpdatedAt", "updatedAt", { unique: false });
        store.createIndex("byProfileUpdated", ["profileId", "updatedAt"], { unique: false });
      } else {
        const tx = req.transaction;
        const store = tx?.objectStore(STORE);
        if (store && !store.indexNames.contains("byProfile")) {
          store.createIndex("byProfile", "profileId", { unique: false });
        }
        if (store && !store.indexNames.contains("byUpdatedAt")) {
          store.createIndex("byUpdatedAt", "updatedAt", { unique: false });
        }
        if (store && !store.indexNames.contains("byProfileUpdated")) {
          store.createIndex("byProfileUpdated", ["profileId", "updatedAt"], { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result: any;
        try {
          const reqOrPromise = fn(store) as any;
          if (reqOrPromise && typeof reqOrPromise.then === "function") {
            (reqOrPromise as Promise<T>).then(resolve).catch(reject);
            return;
          }
          result = reqOrPromise as IDBRequest<T>;
          result.onsuccess = () => resolve(result.result);
          result.onerror = () => reject(result.error);
        } catch (e) {
          reject(e);
        }
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

export async function saveProgress(input: {
  profileId: string;
  titleId: string;
  progressSeconds: number;
  durationSeconds?: number | null;
}): Promise<ProgressRecord> {
  if (!isBrowser()) throw new Error("no browser");
  const now = Date.now();
  const dur = input.durationSeconds ?? null;
  let percent = 0;
  if (dur && dur > 0) {
    percent = Math.min(1, Math.max(0, input.progressSeconds / dur));
  } else {
    percent = input.progressSeconds > 1 ? 0 : Math.min(1, Math.max(0, input.progressSeconds));
  }
  const rec: ProgressRecord = {
    id: makeId(input.profileId, input.titleId),
    profileId: input.profileId,
    titleId: input.titleId,
    progressSeconds: input.progressSeconds,
    durationSeconds: dur,
    percent,
    updatedAt: now,
  };
  await withStore("readwrite", (store) => store.put(rec));
  return rec;
}

export async function getProgress(profileId: string, titleId: string): Promise<ProgressRecord | undefined> {
  if (!isBrowser()) return undefined;
  const id = makeId(profileId, titleId);
  try {
    const res = await withStore<ProgressRecord | undefined>("readonly", (store) => store.get(id));
    return res;
  } catch {
    return undefined;
  }
}

export async function getProgressForProfile(profileId: string): Promise<ProgressRecord[]> {
  if (!isBrowser()) return [];
  try {
    const db = await openDB();
    return await new Promise<ProgressRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const idx = store.index("byProfile");
      const req = idx.getAll(profileId);
      req.onsuccess = () => {
        const arr = (req.result as ProgressRecord[]) || [];
        arr.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    return [];
  }
}

export async function getContinueWatchingList(
  profileId: string,
  opts?: { hideThreshold?: number }
): Promise<ProgressRecord[]> {
  const threshold = opts?.hideThreshold ?? 0.95;
  const all = await getProgressForProfile(profileId);
  return all.filter((r) => r.percent <= threshold && r.progressSeconds > 1).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProgress(profileId: string, titleId: string): Promise<void> {
  if (!isBrowser()) return;
  const id = makeId(profileId, titleId);
  await withStore("readwrite", (store) => store.delete(id));
}

export async function clearProfile(profileId: string): Promise<void> {
  if (!isBrowser()) return;
  const items = await getProgressForProfile(profileId);
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const it of items) store.delete(it.id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export type { ProgressRecord };
