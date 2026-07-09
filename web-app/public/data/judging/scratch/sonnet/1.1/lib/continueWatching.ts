// lib/continueWatching.ts
// IndexedDB-backed storage for per-profile "Continue Watching" progress.
// No external dependencies -- uses the browser's native IndexedDB API only.

const DB_NAME = "app-continue-watching";
const DB_VERSION = 1;
const STORE_NAME = "progress";
const THROTTLE_MS = 5000;

export interface ContinueWatchingEntry {
  id: string; // `${profileId}::${titleId}`
  profileId: string;
  titleId: string;
  progressSeconds: number;
  durationSeconds: number;
  progressRatio: number; // 0..1
  updatedAt: number; // epoch ms
}

// ---- low-level IndexedDB plumbing --------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!isBrowser()) {
    return Promise.reject(new Error("IndexedDB is not available in this environment"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("byProfile", "profileId", { unique: false });
        store.createIndex("byProfileUpdatedAt", ["profileId", "updatedAt"], { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function makeKey(profileId: string, titleId: string): string {
  return `${profileId}::${titleId}`;
}

// ---- public read/write API ---------------------------------------------

/**
 * Immediately writes a progress record, bypassing the throttle.
 * Use for the final save on pause/unmount/navigation.
 */
export async function writeProgressNow(
  profileId: string,
  titleId: string,
  progressSeconds: number,
  durationSeconds: number
): Promise<void> {
  if (!isBrowser()) return;
  if (!profileId || !titleId) return;
  if (
    !Number.isFinite(progressSeconds) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return;
  }

  const entry: ContinueWatchingEntry = {
    id: makeKey(profileId, titleId),
    profileId,
    titleId,
    progressSeconds,
    durationSeconds,
    progressRatio: Math.min(1, Math.max(0, progressSeconds / durationSeconds)),
    updatedAt: Date.now(),
  };

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Let any mounted "Continue Watching" UI know it should re-read.
  window.dispatchEvent(
    new CustomEvent("continue-watching-updated", { detail: { profileId, titleId } })
  );
}

// Per-(profile,title) throttle state (leading + trailing).
const lastFlushAt = new Map<string, number>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingArgs = new Map<
  string,
  { profileId: string; titleId: string; progressSeconds: number; durationSeconds: number }
>();

/**
 * Throttled progress save: writes at most once every 5 seconds per
 * (profileId, titleId). Trailing calls within the window are coalesced
 * and flushed when the window elapses.
 */
export function saveProgressThrottled(
  profileId: string,
  titleId: string,
  progressSeconds: number,
  durationSeconds: number
): void {
  if (!isBrowser()) return;
  if (!profileId || !titleId) return;

  const key = makeKey(profileId, titleId);
  pendingArgs.set(key, { profileId, titleId, progressSeconds, durationSeconds });

  const now = Date.now();
  const last = lastFlushAt.get(key) ?? 0;
  const elapsed = now - last;

  if (elapsed >= THROTTLE_MS) {
    lastFlushAt.set(key, now);
    const args = pendingArgs.get(key)!;
    pendingArgs.delete(key);
    void writeProgressNow(args.profileId, args.titleId, args.progressSeconds, args.durationSeconds);
    return;
  }

  if (pendingTimers.has(key)) return; // a trailing flush is already scheduled

  const wait = THROTTLE_MS - elapsed;
  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    const args = pendingArgs.get(key);
    pendingArgs.delete(key);
    lastFlushAt.set(key, Date.now());
    if (args) {
      void writeProgressNow(args.profileId, args.titleId, args.progressSeconds, args.durationSeconds);
    }
  }, wait);
  pendingTimers.set(key, timer);
}

/**
 * Cancels any pending throttled write for (profileId, titleId) and
 * immediately persists the given progress. Call this on pause/unmount
 * so the last few seconds of playback are never lost.
 */
export async function flushProgress(
  profileId: string,
  titleId: string,
  progressSeconds: number,
  durationSeconds: number
): Promise<void> {
  const key = makeKey(profileId, titleId);
  const timer = pendingTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(key);
  }
  pendingArgs.delete(key);
  lastFlushAt.set(key, Date.now());
  await writeProgressNow(profileId, titleId, progressSeconds, durationSeconds);
}

export async function getContinueWatching(profileId: string): Promise<ContinueWatchingEntry[]> {
  if (!isBrowser() || !profileId) return [];

  const db = await openDatabase();
  const entries = await new Promise<ContinueWatchingEntry[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("byProfile");
    const range = IDBKeyRange.only(profileId);
    const results: ContinueWatchingEntry[] = [];

    const request = index.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        results.push(cursor.value as ContinueWatchingEntry);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });

  return entries
    .filter((e) => e.progressRatio <= 0.95)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function removeProgress(profileId: string, titleId: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(makeKey(profileId, titleId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  window.dispatchEvent(
    new CustomEvent("continue-watching-updated", { detail: { profileId, titleId } })
  );
}
