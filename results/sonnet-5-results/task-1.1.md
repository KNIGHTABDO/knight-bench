PLAN

(a) Files created or modified, and why

- `lib/continueWatching.ts` (NEW) — The IndexedDB layer. Owns the database schema, the throttled/immediate write functions, the read/query function (filtered to <=95% progress and sorted by recency), and a `window` `CustomEvent` ("continue-watching-updated") so any mounted UI can react to a write without polling or a page reload. Kept separate from `lib/profiles.ts` and `lib/db.ts` because it is a distinct persistence concern (per-profile playback progress) and must never touch `better-sqlite3` (server-only) or `localStorage` (used only for profile identity).
- `lib/profiles.ts` (MODIFY) — Existing exports `getProfiles()` and `setActiveProfile(id)` are preserved unchanged in signature and behavior. I only *add* new exports: `getActiveProfileId()` (a getter that was implied but not present) and `onProfileChange(callback)` (a subscribe/unsubscribe helper). `setActiveProfile` now additionally dispatches a `window` `CustomEvent` ("profile-changed") after writing to `localStorage`, so other mounted components (the Continue Watching island, the watch page) can react instantly without a full reload. This is additive only — nothing that already calls `setActiveProfile` needs to change.
- `hooks/usePlayer.ts` (MODIFY) — Adds an optional second argument `options: { profileId?, titleId?, initialProgressSeconds? }`. When both `profileId` and `titleId` are present, every `timeupdate` tick calls the throttled save, and `pause()`/unmount/route-change force an immediate untrottled flush so the last few seconds of playback are never lost to the throttle window. The existing return shape `{ progress, seek, play, pause }` and the existing first argument (`videoRef`) are unchanged, so any caller not passing `options` behaves exactly as before.
- `hooks/useContinueWatching.ts` (NEW) — Client hook used only by the new island. Reads the active profile id, queries IndexedDB for that profile's progress, and re-queries whenever a `profile-changed` or `continue-watching-updated` event fires. This is what makes profile switching swap the row's contents without a full page reload.
- `components/ContinueWatching.tsx` (NEW) — The client-component island. Receives the full title catalog as a prop from the server page (see ambiguity #1 below), joins it in the browser against the IndexedDB progress entries returned by `useContinueWatching`, and renders the row. Returns `null` (renders nothing) when there is no active profile or no in-progress titles, so it never leaves an empty heading on the page.
- `app/page.tsx` (MODIFY) — Still a server component; still calls `getTitles()` exactly as before. The only change is mapping the fetched titles into the minimal shape `ContinueWatching` needs and rendering `<ContinueWatching allTitles={...} />` above the existing grid. No existing behavior or export is removed.
- `app/watch/[id]/page.tsx` (MODIFY) — Reads the active profile id client-side via the new `getActiveProfileId()`/`onProfileChange()` exports and passes `{ profileId, titleId }` into `usePlayer`. This is the wiring that makes progress actually get saved while a title plays.

Files intentionally **not** modified, with the assumption stated:
- `lib/db.ts` — No changes needed; it stays server-only. IndexedDB and `better-sqlite3` never touch each other; the join between "what's in progress" (IndexedDB, browser) and "title metadata" (SQLite, server) happens in the client component using data the server already fetched.
- `components/Player.tsx` — Assumed to already forward a ref to its internal `<video>` element (a standard pattern for a "video element wrapper"), since `usePlayer` takes a `videoRef` and attaches native `loadedmetadata`/`timeupdate` listeners to it. If in reality `Player.tsx` does not forward a ref, that file would need a one-line `forwardRef` addition — flagged here as an assumption rather than silently guessed away.
- `components/ProfileSwitcher.tsx` — Not modified. It already calls `setActiveProfile(id)` on selection (per the task description); because that function now also dispatches the `profile-changed` event, `ProfileSwitcher` gets the new reactive behavior for free with zero code changes.

(b) Ambiguities / risks and resolutions

1. **Where can the IndexedDB progress records be joined with title metadata (poster, name), given IndexedDB only exists in the browser and title metadata comes from `better-sqlite3`, which only exists on the server?** Resolution: keep IndexedDB storing only `{profileId, titleId, progressSeconds, durationSeconds, updatedAt}` — no denormalized title metadata (avoids staleness if a title's poster/name changes). The server page (`app/page.tsx`) already fetches the full catalog via `getTitles()`; it passes that catalog as a prop into the `ContinueWatching` client island, which does the join client-side by `titleId`. This avoids adding a new API route (keeping the "no new dependencies" and minimal-surface-area constraints) while keeping `lib/db.ts` server-only.

2. **How can profile switching update the row "without a full page reload" when `lib/profiles.ts` is `localStorage`-backed and has no existing pub-sub mechanism, and we're told not to add new dependencies?** Resolution: use the browser-native `EventTarget`/`CustomEvent` API on `window` (no library needed). `setActiveProfile` dispatches `"profile-changed"`; a new `onProfileChange(cb)` export wraps `addEventListener`/`removeEventListener` so consumers don't need to know the event name. This also naturally covers same-tab reactivity, which the native `storage` event does *not* provide (that only fires in other tabs), so relying on `storage` alone would have silently broken the same-tab-switch requirement.

3. **What does "throttled to at most one write every 5 seconds" mean precisely — is it acceptable to lose the last few seconds of progress if the user pauses or navigates away mid-window?** Resolution: implemented as a leading+trailing throttle (write immediately if >=5s have elapsed since the last write for that profile+title, otherwise schedule exactly one trailing write for the remainder of the window, coalescing intermediate ticks). Additionally, `pause()`, hook unmount, and route change always force an *immediate, untrottled* flush via `flushProgress`, so "5s throttle" governs steady-state writes during playback but never causes user-visible data loss at natural stopping points.

4. **What exactly counts as ">95% progress" for hiding a title from the row — wall-clock seconds remaining, or a ratio?** Resolution: used `progressSeconds / durationSeconds` as a ratio (`progressRatio`), hiding entries where `progressRatio > 0.95` (strictly greater, so a title paused at exactly 95% still shows as "continue watching"). This is computed and filtered inside `getContinueWatching()` in `lib/continueWatching.ts` so all consumers get consistent filtering for free.

(c) IndexedDB schema

- Database: `app-continue-watching`, version `1`.
- Object store: `progress`, `keyPath: "id"`.
- Record shape:
  - `id: string` — composite primary key, `` `${profileId}::${titleId}` ``, guarantees at most one row per profile+title.
  - `profileId: string`
  - `titleId: string`
  - `progressSeconds: number`
  - `durationSeconds: number`
  - `progressRatio: number` — derived, `0..1`, stored redundantly to avoid recomputing on every read.
  - `updatedAt: number` — epoch ms, used for "most recently watched" sort.
- Indexes:
  - `byProfile` on `profileId` (non-unique) — used to fetch all in-progress titles for the active profile.
  - `byProfileUpdatedAt` on `["profileId", "updatedAt"]` (compound, non-unique) — available for future range/cursor queries scoped to a profile ordered by recency; the current implementation reads via `byProfile` and sorts the (small, per-profile) result set in memory, which is simpler and avoids IDB's ascending-only cursor direction constraints for a "descending" read.

FILES

```lib/continueWatching.ts
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
```

```lib/profiles.ts
// lib/profiles.ts
// Profile identity storage. Existing exports (getProfiles, setActiveProfile)
// are unchanged in signature and behavior. New exports (getActiveProfileId,
// onProfileChange) are additive only.

export interface Profile {
  id: string;
  name: string;
  avatarUrl: string;
}

const PROFILES_KEY = "app:profiles";
const ACTIVE_PROFILE_KEY = "app:activeProfileId";
const PROFILE_CHANGED_EVENT = "profile-changed";

const DEFAULT_PROFILES: Profile[] = [
  { id: "p1", name: "Alex", avatarUrl: "/avatars/1.png" },
  { id: "p2", name: "Sam", avatarUrl: "/avatars/2.png" },
];

export function getProfiles(): Profile[] {
  if (typeof window === "undefined") return DEFAULT_PROFILES;
  const raw = window.localStorage.getItem(PROFILES_KEY);
  if (!raw) return DEFAULT_PROFILES;
  try {
    return JSON.parse(raw) as Profile[];
  } catch {
    return DEFAULT_PROFILES;
  }
}

export function setActiveProfile(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  // NEW: notify same-tab listeners (e.g. the Continue Watching island)
  // so they can update without a full page reload. This is additive --
  // existing callers of setActiveProfile do not need to change.
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT, { detail: { id } }));
}

/**
 * NEW: returns the currently active profile id, or null if none is set
 * (or if called on the server, where there is no localStorage).
 */
export function getActiveProfileId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_PROFILE_KEY);
}

/**
 * NEW: subscribe to active-profile changes. Fires on same-tab switches
 * (via setActiveProfile) and on cross-tab switches (via the native
 * `storage` event). Returns an unsubscribe function.
 */
export function onProfileChange(callback: (id: string | null) => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ id: string }>).detail;
    callback(detail?.id ?? getActiveProfileId());
  };

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key === ACTIVE_PROFILE_KEY) {
      callback(event.newValue);
    }
  };

  window.addEventListener(PROFILE_CHANGED_EVENT, handleCustomEvent);
  window.addEventListener("storage", handleStorageEvent);

  return () => {
    window.removeEventListener(PROFILE_CHANGED_EVENT, handleCustomEvent);
    window.removeEventListener("storage", handleStorageEvent);
  };
}
```

```hooks/usePlayer.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushProgress, saveProgressThrottled } from "../lib/continueWatching";

export interface UsePlayerOptions {
  profileId?: string | null;
  titleId?: string;
  initialProgressSeconds?: number;
}

export interface UsePlayerResult {
  progress: number;
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
}

// NOTE: `options` is new and optional. Existing callers that only pass
// `videoRef` keep their exact previous behavior (no profile/title -> no
// Continue Watching writes are attempted).
export function usePlayer(
  videoRef: React.RefObject<HTMLVideoElement>,
  options: UsePlayerOptions = {}
): UsePlayerResult {
  const { profileId, titleId, initialProgressSeconds } = options;
  const [progress, setProgress] = useState(initialProgressSeconds ?? 0);
  const progressRef = useRef(progress);
  const durationRef = useRef(0);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const play = useCallback(() => {
    videoRef.current?.play();
  }, [videoRef]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    if (profileId && titleId && durationRef.current > 0) {
      // Force an immediate, untrottled save so pausing never loses progress
      // to the 5-second throttle window.
      void flushProgress(profileId, titleId, progressRef.current, durationRef.current);
    }
  }, [videoRef, profileId, titleId]);

  const seek = useCallback(
    (seconds: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = seconds;
        setProgress(seconds);
      }
    },
    [videoRef]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      durationRef.current = video.duration || 0;
      if (initialProgressSeconds && initialProgressSeconds > 0) {
        video.currentTime = initialProgressSeconds;
      }
    };

    const handleTimeUpdate = () => {
      const next = video.currentTime;
      setProgress(next);
      if (profileId && titleId && durationRef.current > 0) {
        saveProgressThrottled(profileId, titleId, next, durationRef.current);
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      // Flush on unmount / navigation away from the watch page.
      if (profileId && titleId && durationRef.current > 0) {
        void flushProgress(profileId, titleId, progressRef.current, durationRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, profileId, titleId]);

  return { progress, seek, play, pause };
}
```

```hooks/useContinueWatching.ts
"use client";
import { useCallback, useEffect, useState } from "react";
import { getActiveProfileId, onProfileChange } from "../lib/profiles";
import { ContinueWatchingEntry, getContinueWatching } from "../lib/continueWatching";

export interface UseContinueWatchingResult {
  entries: ContinueWatchingEntry[];
  activeProfileId: string | null;
  loading: boolean;
}

export function useContinueWatching(): UseContinueWatchingResult {
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ContinueWatchingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (profileId: string | null) => {
    if (!profileId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await getContinueWatching(profileId);
      setEntries(result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const current = getActiveProfileId();
    setActiveProfileId(current);
    void refresh(current);

    // Re-query whenever the active profile changes (same tab or cross tab).
    const unsubscribeProfile = onProfileChange((id) => {
      setActiveProfileId(id);
      void refresh(id);
    });

    // Re-query whenever a throttled/immediate progress write happens
    // (e.g. the user is actively watching something on another page/tab).
    let latestProfileId: string | null = current;
    const handleUpdate = () => {
      void refresh(latestProfileId);
    };
    window.addEventListener("continue-watching-updated", handleUpdate);

    const unsubscribeProfileTracking = onProfileChange((id) => {
      latestProfileId = id;
    });

    return () => {
      unsubscribeProfile();
      unsubscribeProfileTracking();
      window.removeEventListener("continue-watching-updated", handleUpdate);
    };
  }, [refresh]);

  return { entries, activeProfileId, loading };
}
```

```components/ContinueWatching.tsx
"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useContinueWatching } from "../hooks/useContinueWatching";
import type { ContinueWatchingEntry } from "../lib/continueWatching";

export interface ContinueWatchingTitle {
  id: string;
  title: string;
  posterUrl?: string;
  durationSeconds?: number;
}

interface ContinueWatchingProps {
  allTitles: ContinueWatchingTitle[];
}

interface ContinueWatchingItem {
  entry: ContinueWatchingEntry;
  title: ContinueWatchingTitle;
}

export default function ContinueWatching({ allTitles }: ContinueWatchingProps) {
  const { entries, activeProfileId, loading } = useContinueWatching();

  const titleById = useMemo(() => {
    const map = new Map<string, ContinueWatchingTitle>();
    for (const t of allTitles) map.set(t.id, t);
    return map;
  }, [allTitles]);

  // Nothing to show yet (no profile selected, or still loading from IndexedDB).
  if (!activeProfileId || loading) return null;

  const items: ContinueWatchingItem[] = entries
    .map((entry) => {
      const title = titleById.get(entry.titleId);
      return title ? { entry, title } : null;
    })
    .filter((x): x is ContinueWatchingItem => x !== null);

  if (items.length === 0) return null;

  return (
    <section aria-label="Continue Watching" className="continue-watching-row">
      <h2>Continue Watching</h2>
      <div className="continue-watching-scroller">
        {items.map(({ entry, title }) => (
          <Link key={entry.id} href={`/watch/${title.id}`} className="continue-watching-card">
            {title.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={title.posterUrl} alt={title.title} />
            ) : (
              <div className="continue-watching-card-placeholder">{title.title}</div>
            )}
            <div className="continue-watching-progress-track">
              <div
                className="continue-watching-progress-fill"
                style={{ width: `${Math.round(entry.progressRatio * 100)}%` }}
              />
            </div>
            <span className="continue-watching-title">{title.title}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

```app/page.tsx
import { getTitles } from "../lib/db";
import ContinueWatching from "../components/ContinueWatching";

export default async function HomePage() {
  const titles = getTitles();

  // Minimal shape the client island needs. Defensive field fallbacks in
  // case getTitles()'s exact field names differ slightly (title/name,
  // posterUrl/poster, durationSeconds/duration) -- no assumption is made
  // about lib/db.ts's exact return type beyond "has an id".
  const continueWatchingTitles = titles.map((t: any) => ({
    id: String(t.id),
    title: t.title ?? t.name ?? "",
    posterUrl: t.posterUrl ?? t.poster ?? undefined,
    durationSeconds: t.durationSeconds ?? t.duration ?? undefined,
  }));

  return (
    <main>
      <h1>Home</h1>
      <ContinueWatching allTitles={continueWatchingTitles} />
      <div className="title-grid">
        {titles.map((t: any) => (
          <a key={t.id} href={`/watch/${t.id}`}>
            {t.title ?? t.name}
          </a>
        ))}
      </div>
    </main>
  );
}
```

```app/watch/[id]/page.tsx
"use client";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Player from "../../../components/Player";
import { usePlayer } from "../../../hooks/usePlayer";
import { getActiveProfileId, onProfileChange } from "../../../lib/profiles";

export default function WatchPage() {
  const params = useParams<{ id: string }>();
  const titleId = Array.isArray(params.id) ? params.id[0] : params.id;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    setProfileId(getActiveProfileId());
    return onProfileChange(setProfileId);
  }, []);

  const { progress, seek, play, pause } = usePlayer(videoRef, {
    profileId,
    titleId,
  });

  return (
    <div>
      {/* Assumption: Player.tsx forwards `ref` to its internal <video>
          element -- see PLAN ambiguity notes. */}
      <Player
        ref={videoRef}
        src={`/api/stream/${titleId}`}
        subtitles={[]}
        onProgress={() => {
          /* usePlayer already listens to the underlying video's
             timeupdate event directly via videoRef; this callback is
             left as a no-op passthrough to preserve Player's existing
             prop contract. */
        }}
      />
    </div>
  );
}
```
