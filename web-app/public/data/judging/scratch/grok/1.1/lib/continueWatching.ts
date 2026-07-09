/**
 * Per-profile Continue Watching storage via IndexedDB.
 * No external dependencies. Browser-only.
 */

const DB_NAME = "stream-app";
const DB_VERSION = 1;
const STORE = "watchProgress";

/** Hide / treat as completed above this fraction (95%). */
export const COMPLETE_THRESHOLD = 0.95;

/** Minimum interval between durable writes for the same profile+title. */
export const WRITE_THROTTLE_MS = 5000;

export type WatchProgressRecord = {
  /** Composite primary key: `${profileId}:${titleId}` */
  id: string;
  profileId: string;
  titleId: string;
  positionSeconds: number;
  durationSeconds: number;
  /** 0–1; 0 when duration unknown */
  percent: number;
  /** epoch ms */
  updatedAt: number;
};

export type WatchProgressInput = {
  profileId: string;
  titleId: string;
  positionSeconds: number;
  durationSeconds: number;
};

function compositeId(profileId: string, titleId: string): string {
  return `${profileId}:${titleId}`;
}

function computePercent(positionSeconds: number, durationSeconds: number): number {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  const raw = positionSeconds / durationSeconds;
  if (Number.isNaN(raw) || !Number.isFinite(raw)) return 0;
  return Math.min(1, Math.max(0, raw));
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!isBrowser()) {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Failed to open IndexedDB"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by_profile", "profileId", { unique: false });
        store.createIndex("by_profile_updated", ["profileId", "updatedAt"], {
          unique: false,
        });
      }
    };
  });

  return dbPromise;
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IDB request failed"));
  });
}

/**
 * Read a single progress row for a profile + title.
 */
export async function getProgress(
  profileId: string,
  titleId: string
): Promise<WatchProgressRecord | null> {
  if (!isBrowser() || !profileId || !titleId) return null;
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const row = await reqToPromise(
    store.get(compositeId(profileId, titleId)) as IDBRequest<WatchProgressRecord | undefined>
  );
  return row ?? null;
}

/**
 * List continue-watching entries for a profile:
 * - sorted by updatedAt descending (most recently watched first)
 * - excludes percent > 0.95
 */
export async function listContinueWatching(
  profileId: string
): Promise<WatchProgressRecord[]> {
  if (!isBrowser() || !profileId) return [];
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const index = store.index("by_profile");
  const rows = await reqToPromise(
    index.getAll(IDBKeyRange.only(profileId)) as IDBRequest<WatchProgressRecord[]>
  );

  return (rows ?? [])
    .filter((r) => (r.percent ?? 0) <= COMPLETE_THRESHOLD)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Unthrottled durable write / delete-if-complete.
 * Prefer saveProgressThrottled from playback paths.
 */
export async function putProgress(
  input: WatchProgressInput
): Promise<WatchProgressRecord | null> {
  if (!isBrowser()) return null;
  const { profileId, titleId } = input;
  if (!profileId || !titleId) return null;

  let positionSeconds = Math.max(0, Number(input.positionSeconds) || 0);
  let durationSeconds = Math.max(0, Number(input.durationSeconds) || 0);
  if (durationSeconds > 0) {
    positionSeconds = Math.min(positionSeconds, durationSeconds);
  }

  const percent = computePercent(positionSeconds, durationSeconds);
  const id = compositeId(profileId, titleId);
  const db = await openDb();

  // Completed: remove so it no longer appears in Continue Watching.
  if (percent > COMPLETE_THRESHOLD) {
    const tx = db.transaction(STORE, "readwrite");
    await reqToPromise(tx.objectStore(STORE).delete(id));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("delete failed"));
      tx.onabort = () => reject(tx.error ?? new Error("delete aborted"));
    });
    return null;
  }

  // Skip zero-position noise unless we already had a row (allow scrub-to-start clear).
  if (positionSeconds <= 0) {
    const existing = await getProgress(profileId, titleId);
    if (!existing) return null;
  }

  const record: WatchProgressRecord = {
    id,
    profileId,
    titleId,
    positionSeconds,
    durationSeconds,
    percent,
    updatedAt: Date.now(),
  };

  const tx = db.transaction(STORE, "readwrite");
  await reqToPromise(tx.objectStore(STORE).put(record));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("put failed"));
    tx.onabort = () => reject(tx.error ?? new Error("put aborted"));
  });

  return record;
}

export async function deleteProgress(
  profileId: string,
  titleId: string
): Promise<void> {
  if (!isBrowser() || !profileId || !titleId) return;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await reqToPromise(tx.objectStore(STORE).delete(compositeId(profileId, titleId)));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("delete failed"));
  });
}

type ThrottleState = {
  lastWriteAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  pending: WatchProgressInput | null;
};

const throttleMap = new Map<string, ThrottleState>();

function throttleKey(profileId: string, titleId: string): string {
  return compositeId(profileId, titleId);
}

/**
 * Throttled writer: at most one durable write per profile+title every 5s,
 * with trailing flush of the latest snapshot.
 */
export function saveProgressThrottled(input: WatchProgressInput): void {
  if (!isBrowser()) return;
  const key = throttleKey(input.profileId, input.titleId);
  let state = throttleMap.get(key);
  if (!state) {
    state = { lastWriteAt: 0, timer: null, pending: null };
    throttleMap.set(key, state);
  }

  state.pending = { ...input };
  const elapsed = Date.now() - state.lastWriteAt;
  const wait = Math.max(0, WRITE_THROTTLE_MS - elapsed);

  if (state.timer != null) return;

  state.timer = setTimeout(async () => {
    const current = throttleMap.get(key);
    if (!current) return;
    current.timer = null;
    const payload = current.pending;
    current.pending = null;
    if (!payload) return;
    try {
      await putProgress(payload);
      current.lastWriteAt = Date.now();
    } catch {
      // Swallow IDB errors to avoid breaking playback UI.
    }
  }, wait);
}

/**
 * Force-flush any pending throttled write for a key (or all keys).
 * Call on pause, unmount, and page hide.
 */
export async function flushProgress(
  profileId?: string,
  titleId?: string
): Promise<void> {
  if (!isBrowser()) return;

  const keys =
    profileId && titleId
      ? [throttleKey(profileId, titleId)]
      : Array.from(throttleMap.keys());

  await Promise.all(
    keys.map(async (key) => {
      const state = throttleMap.get(key);
      if (!state) return;
      if (state.timer != null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      const payload = state.pending;
      state.pending = null;
      if (!payload) return;
      try {
        await putProgress(payload);
        state.lastWriteAt = Date.now();
      } catch {
        // ignore
      }
    })
  );
}

/** Notify UI islands that continue-watching data changed (optional convenience). */
export const CONTINUE_WATCHING_CHANGE_EVENT = "continue-watching-change";

export function notifyContinueWatchingChanged(profileId?: string): void {
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent(CONTINUE_WATCHING_CHANGE_EVENT, {
      detail: { profileId },
    })
  );
}

/** putProgress + notify (used after flush paths that should refresh home row). */
export async function putProgressAndNotify(
  input: WatchProgressInput
): Promise<WatchProgressRecord | null> {
  const row = await putProgress(input);
  notifyContinueWatchingChanged(input.profileId);
  return row;
}

export async function flushProgressAndNotify(
  profileId?: string,
  titleId?: string
): Promise<void> {
  await flushProgress(profileId, titleId);
  notifyContinueWatchingChanged(profileId);
}
