PLAN

(a) Files to create/modify and why:

NEW lib/progressStore.ts - Core IndexedDB abstraction for per-profile per-title progress. Encapsulates DB open, schema, and CRUD. Required because storage must be IndexedDB and no existing file does it.

MODIFY lib/profiles.ts - Existing exports getProfiles(), setActiveProfile(id) are localStorage-backed. We keep them non-breaking but add reactive layer: getActiveProfileId(), getActiveProfile(), subscribeToActiveProfile(cb). setActiveProfile now dispatches a CustomEvent 'knight:active-profile-change' + storage event handling so subscribers (ContinueWatching row) can swap without full reload. Preserves original exports.

MODIFY hooks/usePlayer.ts - Existing hook manages play state and progress. Must now persist progress per profile per title throttled to 5s. Will import progressStore and profiles, load saved progress on mount for active profile+titleId, seek to it, and implement throttled save with leading+trailing logic, flush on pause/unmount/visibilitychange. Keep return shape {progress, seek, play, pause, handleProgress, ready} but backward compat if called with no args.

NEW hooks/useContinueWatching.ts - Client hook that encapsulates reading Continue Watching for active profile: subscribes to profile changes, calls progressStore.getProgressForProfile, filters >95%, sorts by updatedAt desc. Separates logic from UI.

NEW components/ContinueWatching.tsx - Client component island required for home page. Uses useContinueWatching and titles prop from server page. Renders horizontal row sorted by most recently watched, hiding >95%. Listens to profile changes via subscription, so profile switch swaps contents without reload. 'use client'.

MODIFY components/ProfileSwitcher.tsx - Original rendered avatars and called setActiveProfile. If it called location.reload() we remove reload and rely on new event system. Add local activeId state synced via subscribeToActiveProfile to highlight active and trigger re-render.

MODIFY components/Player.tsx - Video element wrapper props: src, subtitles, onProgress. Ensure onTimeUpdate calls onProgress with both currentTime and duration (old callers receiving first arg still work). No breaking prop changes.

MODIFY app/page.tsx - Home page is server component fetching from lib/db.ts. We keep that but inject ContinueWatching client island passing titles from server as prop, solving the server SQLite vs client IDB mismatch. Allows ContinueWatching to resolve metadata without client DB access.

MODIFY app/watch/[id]/page.tsx - Player page is client component using hooks/usePlayer.ts. Wire titleId from params into usePlayer({titleId, duration}) and pass handleProgress to Player. Implement initial resume seek.

(b) Ambiguities / Risks and Resolution:

1. Progress representation and 95% threshold: Spec says hide titles with >95% progress but doesn't define progress metric (seconds vs percent) nor where duration comes from. Player prop described as onProgress but not specified if seconds or fraction. Risk: mismatched calculation would never hide or hide too early. Resolution: Store both progressSeconds, durationSeconds, and computed percent = progressSeconds/durationSeconds. If duration unavailable, store percent assuming progress arg is fraction if <2. Filtering uses percent >0.95 OR if duration known, progress/duration >0.95. Home row hides those. Duration sourced from video metadata (onLoadedMetadata) and passed to store.

2. Throttle semantics and data loss: "At most one write every 5 seconds" could be interpreted as drop intermediate updates vs trailing edge. Risk: Last seconds before navigation lost, or flush on unmount violates throttle. Resolution: Implement leading write immediate, then throttled with trailing timeout (5s). Keep ref lastWrite timestamp. If update occurs within 5s, schedule timeout to write latest value. On pause, page hide, beforeunload, and component unmount, attempt final flush if pending and more than 0.5s of progress difference, bypassing throttle narrowly (still respects at most one per 5s during playback, final flush is user-intent to save). Use in-memory refs for pending.

3. Home page server component cannot access IndexedDB or better-sqlite3 client-side dual access: getTitles() uses better-sqlite3 (server only). ContinueWatching must be client component, but needs title metadata (thumbnail, title) for rendering. If it tried to call getTitles client-side it would crash. Resolution: Server page fetches all titles and passes them as serialized prop to client island. Client island does lookup by titleId in O(1) map. No need for additional API route, keeps no new dependencies and no breaking changes.

4. Profile switch without reload: Existing setActiveProfile localStorage-only would not trigger React re-render across components. Risk: Continue Watching row stale until reload, violating requirement. Resolution: Make setActiveProfile dispatch CustomEvent and subscribe mechanism uses both CustomEvent and window storage event for cross-tab. ContinueWatching and ProfileSwitcher subscribe, triggering setState. Works without full reload.

(c) IndexedDB Schema:

Database Name: knight-progress-db
Version: 1
Object Store: progress
  keyPath: "id" (string composite `${profileId}::${titleId}`)
  Fields:
    id: string primary key, e.g. "profile-1::movie-123"
    profileId: string indexed
    titleId: string
    progressSeconds: number >=0
    durationSeconds: number | null
    percent: number 0-1 computed
    updatedAt: number (epoch ms, Date.now())
Indexes:
  byProfile: keyPath "profileId", non-unique
  byUpdatedAt: keyPath "updatedAt", non-unique
  byProfileUpdated: keyPath ["profileId","updatedAt"], non-unique (allows efficient get by profile and sort by recency, though we sort in memory for simplicity)
Operations: save (put) upserts, get by [profile,title], getAll by profile via byProfile index, delete by id.
Retention: No auto-expiration, but UI filters >0.95. Optional cleanup function.
All access guarded by typeof window !== 'undefined'.

---

```ts
// file: lib/progressStore.ts
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
```

```ts
// file: lib/profiles.ts
export type Profile = {
  id: string;
  name: string;
  avatarUrl?: string;
  color?: string;
};

const FALLBACK_PROFILES: Profile[] = [
  { id: "profile-1", name: "Alex", color: "#4F46E5" },
  { id: "profile-2", name: "Sam", color: "#10B981" },
  { id: "profile-3", name: "Kids", color: "#F59E0B" },
];

const STORAGE_KEY = "knight:activeProfileId";
const EVENT_NAME = "knight:active-profile-change";
const LEGACY_KEY = "activeProfileId";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readFromStorage(): string | null {
  if (!isBrowser()) return null;
  try {
    return localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
}

export function getProfiles(): Profile[] {
  if (!isBrowser()) return FALLBACK_PROFILES;
  try {
    const raw = localStorage.getItem("knight:profiles");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as Profile[];
    }
  } catch {}
  return FALLBACK_PROFILES;
}

export function getActiveProfileId(): string | null {
  const id = readFromStorage();
  if (id) return id;
  const profiles = getProfiles();
  return profiles[0]?.id ?? null;
}

export function getActiveProfile(): Profile | null {
  const id = getActiveProfileId();
  if (!id) return null;
  return getProfiles().find((p) => p.id === id) ?? null;
}

export function setActiveProfile(id: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
    localStorage.setItem(LEGACY_KEY, id);
  } catch {}
  try {
    const ev = new CustomEvent(EVENT_NAME, { detail: { id } });
    window.dispatchEvent(ev);
  } catch {
    try {
      window.dispatchEvent(new Event(EVENT_NAME));
    } catch {}
  }
}

export type ActiveProfileListener = (newId: string | null) => void;

export function subscribeToActiveProfile(listener: ActiveProfileListener): () => void {
  if (!isBrowser()) return () => {};
  const handler = (e: Event) => {
    const custom = e as CustomEvent;
    if (custom.detail && typeof custom.detail.id === "string") {
      listener(custom.detail.id);
    } else {
      listener(readFromStorage());
    }
  };
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === LEGACY_KEY) {
      listener(e.newValue ?? readFromStorage());
    }
  };
  window.addEventListener(EVENT_NAME, handler as EventListener);
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler as EventListener);
    window.removeEventListener("storage", storageHandler);
  };
}
```

```tsx
// file: hooks/usePlayer.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveProfileId } from "@/lib/profiles";
import { saveProgress, getProgress } from "@/lib/progressStore";

type Options = {
  titleId?: string;
  duration?: number | null;
  autoResume?: boolean;
};

type LegacyOptions = string;

export type UsePlayerOptions = Options | LegacyOptions | undefined;

type PlayerState = {
  progress: number;
  duration: number | null;
  isPlaying: boolean;
  isReady: boolean;
};

function normalizeOptions(input: UsePlayerOptions): Options {
  if (!input) return {};
  if (typeof input === "string") return { titleId: input };
  return input;
}

export function usePlayer(input?: UsePlayerOptions) {
  const opts = normalizeOptions(input);
  const titleId = opts.titleId;
  const autoResume = opts.autoResume ?? true;

  const [state, setState] = useState<PlayerState>({
    progress: 0,
    duration: opts.duration ?? null,
    isPlaying: false,
    isReady: false,
  });

  const lastWriteRef = useRef<number>(0);
  const pendingRef = useRef<{ progress: number; duration: number | null } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const titleIdRef = useRef<string | undefined>(titleId);
  const durationRef = useRef<number | null>(opts.duration ?? null);

  useEffect(() => {
    titleIdRef.current = titleId;
  }, [titleId]);

  useEffect(() => {
    if (opts.duration !== undefined) durationRef.current = opts.duration ?? null;
  }, [opts.duration]);

  const scheduleSave = useCallback((progressSeconds: number, durationSeconds: number | null) => {
    const profileId = getActiveProfileId();
    const tid = titleIdRef.current;
    if (!profileId || !tid) return;
    if (progressSeconds < 1) return;
    const now = Date.now();
    const elapsed = now - lastWriteRef.current;
    pendingRef.current = { progress: progressSeconds, duration: durationSeconds };

    const doSave = async () => {
      const p = pendingRef.current;
      if (!p) return;
      const pid = getActiveProfileId();
      const t = titleIdRef.current;
      if (!pid || !t) return;
      try {
        await saveProgress({
          profileId: pid,
          titleId: t,
          progressSeconds: p.progress,
          durationSeconds: p.duration,
        });
        lastWriteRef.current = Date.now();
        pendingRef.current = null;
      } catch {}
    };

    if (elapsed >= 5000) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      void doSave();
    } else if (!timeoutRef.current) {
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        void doSave();
      }, 5000 - elapsed);
    }
  }, []);

  const flushPending = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const p = pendingRef.current;
    if (!p) return;
    const pid = getActiveProfileId();
    const tid = titleIdRef.current;
    if (!pid || !tid) return;
    try {
      await saveProgress({
        profileId: pid,
        titleId: tid,
        progressSeconds: p.progress,
        durationSeconds: p.duration,
      });
      lastWriteRef.current = Date.now();
      pendingRef.current = null;
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!titleId) return;
      const pid = getActiveProfileId();
      if (!pid) return;
      try {
        const rec = await getProgress(pid, titleId);
        if (cancelled) return;
        if (rec && rec.progressSeconds > 1 && rec.percent <= 0.95) {
          setState((s) => ({
            ...s,
            progress: rec.progressSeconds,
            duration: rec.durationSeconds ?? s.duration,
            isReady: true,
          }));
        } else {
          setState((s) => ({ ...s, isReady: true }));
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, isReady: true }));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [titleId]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") void flushPending();
    };
    const onBeforeUnload = () => {
      void flushPending();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onBeforeUnload);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onBeforeUnload);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flushPending();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [flushPending]);

  const handleProgress = useCallback(
    (progressSeconds: number, durationSeconds?: number) => {
      const dur = typeof durationSeconds === "number" && !Number.isNaN(durationSeconds) ? durationSeconds : durationRef.current;
      if (dur !== null && dur !== undefined) durationRef.current = dur;
      setState((s) => ({
        ...s,
        progress: progressSeconds,
        duration: dur ?? s.duration,
      }));
      scheduleSave(progressSeconds, dur ?? null);
    },
    [scheduleSave]
  );

  const seek = useCallback((seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
    }
    setState((s) => ({ ...s, progress: seconds }));
  }, []);

  const play = useCallback(() => {
    videoRef.current?.play().catch(() => {});
    setState((s) => ({ ...s, isPlaying: true }));
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setState((s) => ({ ...s, isPlaying: false }));
    void flushPending();
  }, [flushPending]);

  const attach = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && state.progress > 1 && autoResume) {
      const t = state.progress;
      const onMeta = () => {
        if (el.duration && t < el.duration * 0.95) {
          try {
            el.currentTime = t;
          } catch {}
        }
        el.removeEventListener("loadedmetadata", onMeta);
      };
      el.addEventListener("loadedmetadata", onMeta);
      if (el.readyState >= 1) {
        try {
          if (!el.duration || t < el.duration * 0.95) el.currentTime = t;
        } catch {}
      }
    }
  }, [state.progress, autoResume]);

  return {
    progress: state.progress,
    duration: state.duration,
    isPlaying: state.isPlaying,
    isReady: state.isReady,
    seek,
    play,
    pause,
    handleProgress,
    attach,
  };
}
```

```ts
// file: hooks/useContinueWatching.ts
"use client";
import { useEffect, useState, useCallback } from "react";
import { getActiveProfileId, subscribeToActiveProfile } from "@/lib/profiles";
import { getContinueWatchingList, type ProgressRecord } from "@/lib/progressStore";

export function useContinueWatching(hideThreshold = 0.95) {
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [items, setItems] = useState<ProgressRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (profileId: string | null) => {
    if (!profileId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await getContinueWatchingList(profileId, { hideThreshold });
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [hideThreshold]);

  useEffect(() => {
    setActiveProfileId(getActiveProfileId());
    const unsub = subscribeToActiveProfile((newId) => {
      setActiveProfileId(newId);
    });
    return unsub;
  }, []);

  useEffect(() => {
    void load(activeProfileId);
  }, [activeProfileId, load]);

  const refresh = useCallback(() => {
    void load(activeProfileId);
  }, [activeProfileId, load]);

  useEffect(() => {
    const onFocus = () => refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  return { items, loading, activeProfileId, refresh };
}
```

```tsx
// file: components/ContinueWatching.tsx
"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import type { ProgressRecord } from "@/lib/progressStore";

type TitleMeta = {
  id: string;
  title?: string;
  name?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  image?: string;
  duration?: number | null;
};

type Props = {
  titles?: TitleMeta[];
  hideThreshold?: number;
};

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "0m";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  if (m <= 0) return `${sec}s`;
  return `${m}m ${sec}s`;
}

export default function ContinueWatching({ titles = [], hideThreshold = 0.95 }: Props) {
  const { items, loading, activeProfileId } = useContinueWatching(hideThreshold);

  const titleMap = useMemo(() => {
    const map = new Map<string, TitleMeta>();
    for (const t of titles) map.set(String(t.id), t);
    return map;
  }, [titles]);

  if (!activeProfileId) {
    return null;
  }

  if (loading && items.length === 0) {
    return (
      <section aria-label="Continue Watching" className="w-full py-4">
        <h2 className="text-xl font-semibold px-4 md:px-6 mb-3">Continue Watching</h2>
        <div className="flex gap-3 px-4 md:px-6 overflow-hidden">
          {[0, 1, 2].map((k) => (
            <div key={k} className="w-64 h-36 bg-zinc-800 animate-pulse rounded-md flex-shrink-0" />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section aria-label="Continue Watching" className="w-full py-4">
        <h2 className="text-xl font-semibold px-4 md:px-6 mb-3">Continue Watching</h2>
        <p className="px-4 md:px-6 text-sm text-zinc-400">No titles in progress for this profile.</p>
      </section>
    );
  }

  return (
    <section aria-label="Continue Watching" className="w-full py-4">
      <h2 className="text-xl font-semibold px-4 md:px-6 mb-3">Continue Watching</h2>
      <div className="flex gap-4 overflow-x-auto px-4 md:px-6 pb-2 scrollbar-thin">
        {items.map((rec: ProgressRecord) => {
          const meta = titleMap.get(rec.titleId);
          const displayTitle = meta?.title ?? meta?.name ?? rec.titleId;
          const thumb = meta?.thumbnail ?? meta?.thumbnailUrl ?? meta?.image ?? "";
          const pct = Math.round((rec.percent || 0) * 100);
          return (
            <Link
              key={rec.id}
              href={`/watch/${encodeURIComponent(rec.titleId)}?t=${Math.floor(rec.progressSeconds)}`}
              className="group relative w-64 flex-shrink-0 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors"
            >
              <div className="relative w-full h-36 bg-zinc-800 overflow-hidden">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt={displayTitle} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-500 text-sm">No thumbnail</div>
                )}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                  <div className="h-full bg-red-600 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="absolute bottom-2 right-2 text-[11px] px-1.5 py-0.5 rounded bg-black/70 text-white">
                  {pct}% • {formatTime(rec.progressSeconds)}
                </span>
              </div>
              <div className="p-2.5">
                <p className="text-sm font-medium truncate" title={displayTitle}>
                  {displayTitle}
                </p>
                <p className="text-[11px] text-zinc-400 mt-0.5">Watched {new Date(rec.updatedAt).toLocaleDateString()}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
```

```tsx
// file: components/Player.tsx
"use client";
import { useEffect, useRef } from "react";

type Props = {
  src: string;
  subtitles?: { src: string; lang: string; label: string }[];
  onProgress?: (progressSeconds: number, durationSeconds?: number) => void;
  poster?: string;
  autoPlay?: boolean;
  className?: string;
  onReady?: (el: HTMLVideoElement) => void;
  attachRef?: (el: HTMLVideoElement | null) => void;
};

export default function Player({ src, subtitles, onProgress, poster, autoPlay, className, onReady, attachRef }: Props) {
  const innerRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    attachRef?.(el);
    onReady?.(el);
    return () => {
      attachRef?.(null);
    };
  }, [attachRef, onReady]);

  return (
    <video
      ref={innerRef}
      src={src}
      poster={poster}
      controls
      autoPlay={autoPlay}
      className={className ?? "w-full h-auto max-h-[80vh] bg-black"}
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        onProgress?.(v.currentTime, v.duration);
      }}
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        onProgress?.(v.currentTime, v.duration);
      }}
      crossOrigin="anonymous"
    >
      {subtitles?.map((s) => (
        <track key={`${s.lang}-${s.src}`} src={s.src} kind="subtitles" srcLang={s.lang} label={s.label} />
      ))}
    </video>
  );
}
```

```tsx
// file: components/ProfileSwitcher.tsx
"use client";
import { useEffect, useState } from "react";
import { getProfiles, getActiveProfileId, setActiveProfile, subscribeToActiveProfile, type Profile } from "@/lib/profiles";

export default function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setProfiles(getProfiles());
    setActiveId(getActiveProfileId());
    const unsub = subscribeToActiveProfile((id) => setActiveId(id));
    return unsub;
  }, []);

  const onSelect = (id: string) => {
    if (id === activeId) return;
    setActiveProfile(id);
    setActiveId(id);
  };

  return (
    <div className="flex items-center gap-3">
      {profiles.map((p) => {
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            aria-label={`Switch to ${p.name}`}
            aria-current={active ? "true" : undefined}
            className={`relative flex flex-col items-center gap-1.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${active ? "opacity-100" : "opacity-70 hover:opacity-100"}`}
          >
            <span
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white border-2 transition-colors ${active ? "border-white" : "border-transparent"}`}
              style={{ backgroundColor: p.color ?? "#333" }}
            >
              {p.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatarUrl} alt={p.name} className="w-full h-full rounded-full object-cover" />
              ) : (
                p.name.slice(0, 2).toUpperCase()
              )}
            </span>
            <span className={`text-[11px] ${active ? "text-white" : "text-zinc-400"}`}>{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}
```

```tsx
// file: app/page.tsx
import { getTitles } from "@/lib/db";
import ContinueWatching from "@/components/ContinueWatching";
import ProfileSwitcher from "@/components/ProfileSwitcher";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Title = {
  id: string;
  title?: string;
  name?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  image?: string;
};

export default async function HomePage() {
  let titles: Title[] = [];
  try {
    const res = getTitles();
    titles = (res as any) instanceof Promise ? await res : res;
  } catch {
    titles = [];
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="flex items-center justify-between px-4 md:px-8 py-4 border-b border-zinc-800">
        <h1 className="text-2xl font-bold">Knight</h1>
        <ProfileSwitcher />
      </header>

      <ContinueWatching titles={titles} />

      <section className="px-4 md:px-8 py-6">
        <h2 className="text-xl font-semibold mb-4">All Titles</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {titles.map((t) => {
            const thumb = (t as any).thumbnail ?? (t as any).thumbnailUrl ?? (t as any).image ?? "";
            const name = t.title ?? t.name ?? t.id;
            return (
              <Link
                key={t.id}
                href={`/watch/${encodeURIComponent(t.id)}`}
                className="group rounded-md overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-600"
              >
                <div className="aspect-[16/9] bg-zinc-800">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt={name} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-zinc-500">{name}</div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-sm truncate">{name}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
```

```tsx
// file: app/watch/[id]/page.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Player from "@/components/Player";
import { usePlayer } from "@/hooks/usePlayer";
import { getActiveProfileId } from "@/lib/profiles";
import { getProgress } from "@/lib/progressStore";
import Link from "next/link";

type TitleMeta = {
  id: string;
  src?: string;
  url?: string;
  videoUrl?: string;
  title?: string;
  name?: string;
  duration?: number;
};

export default function WatchPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const rawId = params?.id;
  const id = useMemo(() => (Array.isArray(rawId) ? rawId[0] : rawId) as string, [rawId]);
  const initialT = searchParams?.get("t");

  const [meta, setMeta] = useState<TitleMeta | null>(null);

  const player = usePlayer({ titleId: id, autoResume: true });

  useEffect(() => {
    let cancelled = false;
    async function tryFetchMeta() {
      try {
        const res = await fetch(`/api/titles/${encodeURIComponent(id)}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setMeta(data);
          return;
        }
      } catch {}
      if (!cancelled) {
        setMeta({ id, src: `/api/video/${encodeURIComponent(id)}`, title: id });
      }
    }
    if (id) void tryFetchMeta();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    async function applyQueryStart() {
      if (!initialT || !id) return;
      const sec = Number(initialT);
      if (Number.isNaN(sec) || sec <= 0) return;
      const pid = getActiveProfileId();
      if (!pid) {
        player.handleProgress(sec, player.duration ?? undefined);
        return;
      }
      try {
        const rec = await getProgress(pid, id);
        if (rec && Math.abs(rec.progressSeconds - sec) < 2) return;
      } catch {}
    }
    void applyQueryStart();
  }, [id, initialT, player]);

  const src = meta?.src ?? meta?.url ?? meta?.videoUrl ?? `/api/video/${encodeURIComponent(id ?? "")}`;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-zinc-800">
        <Link href="/" className="text-sm text-zinc-300 hover:text-white">
          ← Back
        </Link>
        <h1 className="text-sm font-medium truncate">{meta?.title ?? meta?.name ?? id}</h1>
      </div>

      <div className="flex-1 flex items-center justify-center bg-black">
        <Player
          src={src}
          poster={(meta as any)?.thumbnail}
          attachRef={player.attach}
          onProgress={player.handleProgress}
          className="w-full max-w-5xl aspect-video bg-black"
          autoPlay={false}
        />
      </div>

      <div className="px-4 py-3 text-xs text-zinc-500">
        Continue Watching auto-saves per profile every 5s. Progress: {Math.floor(player.progress)}s {player.duration ? `/ ${Math.floor(player.duration)}s` : ""}
      </div>
    </main>
  );
}
```
