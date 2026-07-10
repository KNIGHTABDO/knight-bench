'use client';

const DB_NAME = 'knight-bench-watch-progress';
const DB_VERSION = 1;
const STORE_PROGRESS = 'progress';
const INDEX_BY_PROFILE_UPDATED_AT = 'byProfileUpdatedAt';
const INDEX_BY_PROFILE_TITLE = 'byProfileTitle';
const WRITE_THROTTLE_MS = 5_000;

export type WatchProgressRecord = {
  profileId: string;
  titleId: string;
  progress: number;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number;
};

type ProgressInput = {
  profileId: string | number;
  titleId: string | number;
  positionSeconds: number;
  durationSeconds: number;
};

type PendingWrite = {
  record: WatchProgressRecord;
  timerId: number | null;
};

type ProgressListener = () => void;

const pendingWrites = new Map<string, PendingWrite>();
const listeners = new Set<ProgressListener>();

let dbPromise: Promise<IDBDatabase> | null = null;

function canUseIndexedDB() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function normalizeId(id: string | number) {
  return String(id);
}

function recordKey(profileId: string, titleId: string) {
  return `${profileId}::${titleId}`;
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function openDatabase() {
  if (!canUseIndexedDB()) {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        const store = db.createObjectStore(STORE_PROGRESS, {
          keyPath: ['profileId', 'titleId'],
        });

        store.createIndex(INDEX_BY_PROFILE_UPDATED_AT, ['profileId', 'updatedAt'], {
          unique: false,
        });
        store.createIndex(INDEX_BY_PROFILE_TITLE, ['profileId', 'titleId'], {
          unique: true,
        });
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };

      resolve(db);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open watch progress database.'));
    };

    request.onblocked = () => {
      reject(new Error('Opening watch progress database was blocked by another tab.'));
    };
  });

  return dbPromise;
}

function runStoreRequest<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_PROGRESS, mode);
        const store = transaction.objectStore(STORE_PROGRESS);
        const request = callback(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
      }),
  );
}

function emitProgressChanged() {
  listeners.forEach((listener) => listener());
}

async function putProgressRecord(record: WatchProgressRecord) {
  await runStoreRequest('readwrite', (store) => store.put(record));
  emitProgressChanged();
}

export function subscribeWatchProgress(listener: ProgressListener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export async function getProgressForTitle(profileId: string | number, titleId: string | number) {
  return runStoreRequest<WatchProgressRecord | undefined>('readonly', (store) =>
    store.get([normalizeId(profileId), normalizeId(titleId)]),
  );
}

export async function getProgressForProfile(profileId: string | number) {
  const normalizedProfileId = normalizeId(profileId);
  const db = await openDatabase();

  return new Promise<WatchProgressRecord[]>((resolve, reject) => {
    const records: WatchProgressRecord[] = [];
    const transaction = db.transaction(STORE_PROGRESS, 'readonly');
    const store = transaction.objectStore(STORE_PROGRESS);
    const index = store.index(INDEX_BY_PROFILE_UPDATED_AT);
    const range = IDBKeyRange.bound(
      [normalizedProfileId, 0],
      [normalizedProfileId, Number.MAX_SAFE_INTEGER],
    );
    const request = index.openCursor(range, 'prev');

    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor) {
        resolve(records);
        return;
      }

      records.push(cursor.value as WatchProgressRecord);
      cursor.continue();
    };

    request.onerror = () => reject(request.error ?? new Error('Failed to read profile progress.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to read profile progress.'));
  });
}

export async function saveProgressNow(input: ProgressInput) {
  const profileId = normalizeId(input.profileId);
  const titleId = normalizeId(input.titleId);
  const durationSeconds = Number.isFinite(input.durationSeconds) ? input.durationSeconds : 0;
  const positionSeconds = Number.isFinite(input.positionSeconds) ? input.positionSeconds : 0;
  const progress = durationSeconds > 0 ? positionSeconds / durationSeconds : 0;

  const record: WatchProgressRecord = {
    profileId,
    titleId,
    progress: clampProgress(progress),
    positionSeconds: Math.max(0, positionSeconds),
    durationSeconds: Math.max(0, durationSeconds),
    updatedAt: Date.now(),
  };

  await putProgressRecord(record);
}

export function saveProgressThrottled(input: ProgressInput) {
  if (!canUseIndexedDB()) {
    return;
  }

  const profileId = normalizeId(input.profileId);
  const titleId = normalizeId(input.titleId);
  const key = recordKey(profileId, titleId);
  const durationSeconds = Number.isFinite(input.durationSeconds) ? input.durationSeconds : 0;
  const positionSeconds = Number.isFinite(input.positionSeconds) ? input.positionSeconds : 0;
  const progress = durationSeconds > 0 ? positionSeconds / durationSeconds : 0;
  const existing = pendingWrites.get(key);

  const pendingWrite: PendingWrite = {
    record: {
      profileId,
      titleId,
      progress: clampProgress(progress),
      positionSeconds: Math.max(0, positionSeconds),
      durationSeconds: Math.max(0, durationSeconds),
      updatedAt: Date.now(),
    },
    timerId: existing?.timerId ?? null,
  };

  pendingWrites.set(key, pendingWrite);

  if (pendingWrite.timerId !== null) {
    return;
  }

  pendingWrite.timerId = window.setTimeout(() => {
    const latest = pendingWrites.get(key);

    if (!latest) {
      return;
    }

    pendingWrites.delete(key);
    void putProgressRecord(latest.record);
  }, WRITE_THROTTLE_MS);
}

export function flushPendingProgress() {
  if (!canUseIndexedDB() || pendingWrites.size === 0) {
    return;
  }

  const writes = Array.from(pendingWrites.values());
  pendingWrites.clear();

  writes.forEach((write) => {
    if (write.timerId !== null) {
      window.clearTimeout(write.timerId);
    }

    void putProgressRecord(write.record);
  });
}
