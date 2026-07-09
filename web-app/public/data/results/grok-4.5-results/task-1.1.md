# Continue Watching — Design & Implementation

## PLAN

### (a) Files to create or modify

| File | Action | Why |
|------|--------|-----|
| `lib/continueWatching.ts` | **Create** | IndexedDB access layer: schema, open DB, CRUD for per-profile progress, throttled writes, and helpers to list “Continue Watching” entries (sorted, filtered). No new dependencies; uses the browser’s native IndexedDB API. |
| `lib/profiles.ts` | **Modify** | Keep existing `getProfiles()` / `setActiveProfile(id)` exports unchanged in signature and localStorage behavior. Add a small cross-component notification (`ACTIVE_PROFILE_CHANGE_EVENT` + `getActiveProfileId()`) so client islands can re-read progress when the active profile changes without a full page reload. |
| `hooks/usePlayer.ts` | **Modify** | Keep `{ progress, seek, play, pause }` (and existing play-state behavior). Accept optional `titleId` and wire progress updates into the throttled IndexedDB writer so watches are persisted per active profile. |
| `components/Player.tsx` | **Modify** | Accept optional `titleId` and pass it through to `usePlayer` (or call the progress saver from `onProgress` consistently). Preserve existing props: `src`, `subtitles`, `onProgress`. |
| `components/ContinueWatching.tsx` | **Create** | Client-component “island”: loads continue-watching rows from IndexedDB for the active profile, sorts by most recently watched, hides >95% progress, re-renders on profile switch, links to `/watch/[id]`. |
| `components/ProfileSwitcher.tsx` | **Modify** | After `setActiveProfile`, dispatch the profile-change event (if not already done inside `setActiveProfile`) so `ContinueWatching` updates without reload. No change to how avatars are rendered or how profiles are read. |
| `app/page.tsx` | **Modify** | Keep server fetch of titles via `getTitles()`. Embed the client island `<ContinueWatching titles={...} />` so it can resolve title metadata (name, poster, etc.) while progress lives client-side in IndexedDB. |
| `app/watch/[id]/page.tsx` | **Modify** | Pass `titleId` (from route `id`) into `Player` / `usePlayer` so progress is keyed correctly. No change to client-component nature of the page. |

**Not modified (intentionally):**
- `app/layout.tsx` — providers already wrap the tree; no new global provider required if we use custom events + IndexedDB module.
- `lib/db.ts` — server SQLite stays title catalog only; continue-watching is client-only IndexedDB.

---

### (b) Ambiguities / risks and resolutions

**1. What is “progress” and what does “>95%” mean?**  
Ambiguity: progress could be absolute seconds, a 0–1 fraction, or a 0–100 percentage; duration may be unknown until metadata loads.  
**Resolution:** Store both `positionSeconds` and `durationSeconds` (when known). Define `percent = durationSeconds > 0 ? positionSeconds / durationSeconds : 0`. Hide items where `percent > 0.95`. If duration is still unknown, treat percent as 0 so the item can still appear while the user is early in the watch. Clamp position to `[0, duration]` when duration is known.

**2. How does profile switch reach the home-page island without a full reload, given profiles are localStorage-backed?**  
Ambiguity: localStorage alone does not notify other React trees on the same tab unless we listen to `storage` (which only fires cross-tab) or use React context.  
**Resolution:** Extend `setActiveProfile` to also `dispatchEvent` a same-tab `CustomEvent` (`active-profile-change`). `ContinueWatching` and any progress writers subscribe via `addEventListener`. `getActiveProfileId()` remains the single source of truth (localStorage). No new dependencies; no required provider in the root layout. Cross-tab: optionally also listen to `window.storage` for the same key for consistency (implemented).

**3. Risk: throttling “at most one write every 5 seconds” vs losing the final progress.**  
Ambiguity: pure throttle can drop the last update when the user pauses or navigates away within the 5s window.  
**Resolution:** Use a trailing throttle: schedule a write at most once per 5s, and always flush the latest pending snapshot on `pause`, `visibilitychange` (hidden), `pagehide`, and unmount. This respects the rate limit for continuous scrubbing/playback while avoiding data loss at session end.

**4. Risk: home page is a server component; titles come from SQLite, progress from IndexedDB.**  
Ambiguity: the row needs both catalog metadata and client progress.  
**Resolution:** Server page passes a serializable title list (`id`, `title`/`name`, poster URL if present) as props into the client island. The island joins IndexedDB progress with that list. Titles with progress but missing from the catalog are skipped (stale IDs).

**5. Risk: breaking existing exports.**  
**Resolution:** All existing function signatures and return shapes are preserved. New exports are additive only (`getActiveProfileId`, event name, continue-watching APIs). `usePlayer` keeps the same public return object; new options are optional parameters/args.

---

### (c) IndexedDB schema

**Database name:** `stream-app`  
**Version:** `1`  
**Object store:** `watchProgress`

| Field | Type | Notes |
|-------|------|--------|
| `id` | `string` | Primary key. Composite: `` `${profileId}:${titleId}` `` |
| `profileId` | `string` | Active profile id (same ids as `lib/profiles.ts`) |
| `titleId` | `string` | Title id from `getTitle` / route param |
| `positionSeconds` | `number` | Last known playback position |
| `durationSeconds` | `number` | Last known media duration (`0` if unknown) |
| `updatedAt` | `number` | `Date.now()` of last successful write; used for “most recently watched” sort |
| `percent` | `number` | Denormalized `position/duration` in `[0, 1]` (or `0` if no duration); speeds filtering |

**Indexes:**
- `by_profile` on `profileId` — load all progress for active profile.
- `by_profile_updated` on `[profileId, updatedAt]` — optional; sorting can also be done in memory after `by_profile` query (preferred for simplicity and small row counts).

**Write policy:**  
- Only write if `positionSeconds > 0` (or if updating an existing row with a meaningful change).  
- Do not surface rows with `percent > 0.95` in Continue Watching (rows may still be updated/overwritten in the store for completeness, or deleted once completed — we **delete or skip listing** completed titles: listing always filters `percent <= 0.95`; optional cleanup deletes on crossing 95% to keep the store small).

**Chosen completion policy:** When a write would set `percent > 0.95`, delete the record so completed titles disappear from storage and UI. This matches “hide titles with >95% progress” cleanly.

---

## Full file contents

### `lib/continueWatching.ts`

```ts
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
```

---

### `lib/profiles.ts`

```ts
/**
 * Profile helpers — still localStorage-backed.
 * Existing exports getProfiles() and setActiveProfile(id) are preserved.
 * Additive: getActiveProfileId(), ACTIVE_PROFILE_CHANGE_EVENT, ACTIVE_PROFILE_STORAGE_KEY.
 */

export type Profile = {
  id: string;
  name: string;
  avatarUrl?: string;
};

const PROFILES: Profile[] = [
  { id: "default", name: "Default", avatarUrl: "/avatars/default.png" },
  { id: "kids", name: "Kids", avatarUrl: "/avatars/kids.png" },
  { id: "guest", name: "Guest", avatarUrl: "/avatars/guest.png" },
];

/** localStorage key for the active profile id */
export const ACTIVE_PROFILE_STORAGE_KEY = "activeProfileId";

/** Same-tab event name fired when the active profile changes */
export const ACTIVE_PROFILE_CHANGE_EVENT = "active-profile-change";

/**
 * Returns the static profile list.
 * (If the real repo already loads profiles differently, keep that implementation
 * and only ensure this export name/signature remains.)
 */
export function getProfiles(): Profile[] {
  return PROFILES.slice();
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Additive helper: read active profile id from localStorage.
 * Falls back to the first profile when unset/invalid.
 */
export function getActiveProfileId(): string {
  const fallback = PROFILES[0]?.id ?? "default";
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
    if (!raw) return fallback;
    if (PROFILES.some((p) => p.id === raw)) return raw;
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Existing export — set the active profile id in localStorage.
 * Extended (non-breaking) to notify same-tab listeners so Continue Watching
 * and other client islands can swap without a full page reload.
 */
export function setActiveProfile(id: string): void {
  if (!isBrowser()) return;
  const profiles = getProfiles();
  if (!profiles.some((p) => p.id === id)) {
    return;
  }
  try {
    window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
  } catch {
    // ignore quota / private mode failures
  }
  window.dispatchEvent(
    new CustomEvent(ACTIVE_PROFILE_CHANGE_EVENT, {
      detail: { profileId: id },
    })
  );
}
```

---

### `hooks/usePlayer.ts`

```ts
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  flushProgressAndNotify,
  saveProgressThrottled,
} from "@/lib/continueWatching";
import { getActiveProfileId } from "@/lib/profiles";

/** Cap resume position so we do not land past the completion threshold. */
const COMPLETE_SAFE_RESUME = 0.95;

export type UsePlayerOptions = {
  /** When set, progress is persisted per active profile + this title */
  titleId?: string;
  /** Optional external progress callback (existing Player prop surface) */
  onProgress?: (payload: {
    currentTime: number;
    duration: number;
    paused: boolean;
  }) => void;
  /** Optional initial seek position (e.g. resume from Continue Watching) */
  initialPositionSeconds?: number;
};

export type UsePlayerResult = {
  progress: number;
  seek: (timeSeconds: number) => void;
  play: () => void;
  pause: () => void;
  /** Additive helpers for Player.tsx (non-breaking) */
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  duration: number;
};

/**
 * Manages play state and progress.
 * Public surface still exposes { progress, seek, play, pause }.
 * When titleId is provided, writes throttled progress to IndexedDB
 * for the current active profile (max one write / 5s + trailing flush).
 */
export function usePlayer(options: UsePlayerOptions = {}): UsePlayerResult {
  const { titleId, onProgress, initialPositionSeconds } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const didInitialSeek = useRef(false);
  const durationRef = useRef(0);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  /** Queue a throttled durable write (≤1 / 5s per profile+title). */
  const queueSave = useCallback(
    (currentTime: number, mediaDuration: number) => {
      if (!titleId) return;
      saveProgressThrottled({
        profileId: getActiveProfileId(),
        titleId,
        positionSeconds: currentTime,
        durationSeconds: mediaDuration,
      });
    },
    [titleId]
  );

  /**
   * Stash the latest snapshot into the throttle buffer (if provided),
   * then force-flush pending writes and notify Continue Watching islands.
   */
  const flushSave = useCallback(
    async (currentTime?: number, mediaDuration?: number) => {
      if (!titleId) return;
      const profileId = getActiveProfileId();
      if (typeof currentTime === "number") {
        saveProgressThrottled({
          profileId,
          titleId,
          positionSeconds: currentTime,
          durationSeconds:
            typeof mediaDuration === "number"
              ? mediaDuration
              : durationRef.current,
        });
      }
      await flushProgressAndNotify(profileId, titleId);
    },
    [titleId]
  );

  const seek = useCallback((timeSeconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    const d = el.duration;
    const next =
      Number.isFinite(d) && d > 0
        ? Math.min(Math.max(0, timeSeconds), d)
        : Math.max(0, timeSeconds);
    el.currentTime = next;
    setProgress(next);
  }, []);

  const play = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    void el
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }, []);

  const pause = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    setIsPlaying(false);
    void flushSave(el.currentTime, el.duration || durationRef.current);
  }, [flushSave]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const handleTimeUpdate = () => {
      const t = el.currentTime;
      const d = el.duration;
      setProgress(t);
      if (Number.isFinite(d) && d > 0) setDuration(d);
      queueSave(t, Number.isFinite(d) ? d : 0);
      onProgress?.({
        currentTime: t,
        duration: Number.isFinite(d) ? d : 0,
        paused: el.paused,
      });
    };

    const handleLoadedMetadata = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
      if (
        !didInitialSeek.current &&
        typeof initialPositionSeconds === "number" &&
        initialPositionSeconds > 0
      ) {
        didInitialSeek.current = true;
        const capped =
          Number.isFinite(d) && d > 0
            ? Math.min(initialPositionSeconds, d * COMPLETE_SAFE_RESUME)
            : initialPositionSeconds;
        el.currentTime = capped;
        setProgress(capped);
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => {
      setIsPlaying(false);
      void flushSave(el.currentTime, el.duration || 0);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      // Ending at ~100% triggers delete-on-complete in putProgress.
      void flushSave(el.duration || el.currentTime, el.duration || 0);
    };

    el.addEventListener("timeupdate", handleTimeUpdate);
    el.addEventListener("loadedmetadata", handleLoadedMetadata);
    el.addEventListener("play", handlePlay);
    el.addEventListener("pause", handlePause);
    el.addEventListener("ended", handleEnded);

    return () => {
      el.removeEventListener("timeupdate", handleTimeUpdate);
      el.removeEventListener("loadedmetadata", handleLoadedMetadata);
      el.removeEventListener("play", handlePlay);
      el.removeEventListener("pause", handlePause);
      el.removeEventListener("ended", handleEnded);
      void flushSave(el.currentTime, el.duration || 0);
    };
  }, [queueSave, flushSave, onProgress, initialPositionSeconds]);

  // Flush when tab is hidden / page is closing.
  useEffect(() => {
    if (!titleId) return;

    const onHide = () => {
      const el = videoRef.current;
      void flushSave(el?.currentTime, el?.duration || durationRef.current);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, [titleId, flushSave]);

  return {
    progress,
    seek,
    play,
    pause,
    videoRef,
    isPlaying,
    duration,
  };
}
```

---

### `components/Player.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { usePlayer } from "@/hooks/usePlayer";
import { getProgress } from "@/lib/continueWatching";
import { getActiveProfileId } from "@/lib/profiles";

export type SubtitleTrack = {
  src: string;
  srcLang?: string;
  label?: string;
  default?: boolean;
};

export type PlayerProps = {
  src: string;
  subtitles?: SubtitleTrack[];
  onProgress?: (payload: {
    currentTime: number;
    duration: number;
    paused: boolean;
  }) => void;
  /** When provided, enables per-profile continue-watching persistence */
  titleId?: string;
};

/**
 * Video element wrapper.
 * Existing props (src, subtitles, onProgress) preserved.
 * Optional titleId enables IndexedDB progress + resume.
 */
export default function Player({
  src,
  subtitles = [],
  onProgress,
  titleId,
}: PlayerProps) {
  const [initialPosition, setInitialPosition] = useState<number | undefined>(
    undefined
  );
  const [resumeReady, setResumeReady] = useState(!titleId);

  // Load saved position for active profile before binding the media hook.
  useEffect(() => {
    if (!titleId) {
      setResumeReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const row = await getProgress(getActiveProfileId(), titleId);
        if (!cancelled) {
          setInitialPosition(row?.positionSeconds ?? 0);
          setResumeReady(true);
        }
      } catch {
        if (!cancelled) {
          setInitialPosition(0);
          setResumeReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [titleId]);

  const { videoRef, play, pause, isPlaying, progress, duration, seek } =
    usePlayer({
      titleId,
      onProgress,
      initialPositionSeconds: resumeReady ? initialPosition : undefined,
    });

  // Avoid mounting <video> until resume position is known to reduce flash-at-0.
  if (titleId && !resumeReady) {
    return (
      <div className="player player--loading" aria-busy="true">
        Loading player…
      </div>
    );
  }

  return (
    <div className="player">
      <video ref={videoRef} src={src} controls playsInline preload="metadata">
        {subtitles.map((track) => (
          <track
            key={track.src}
            kind="subtitles"
            src={track.src}
            srcLang={track.srcLang}
            label={track.label}
            default={track.default}
          />
        ))}
      </video>
      {/* Optional lightweight controls if the host UI expects them;
          native controls remain for accessibility. */}
      <div className="player__chrome" aria-hidden={false}>
        <button type="button" onClick={() => (isPlaying ? pause() : play())}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <span>
          {formatTime(progress)} / {formatTime(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={progress}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
        />
      </div>
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
```

---

### `components/ContinueWatching.tsx`

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTINUE_WATCHING_CHANGE_EVENT,
  listContinueWatching,
  type WatchProgressRecord,
} from "@/lib/continueWatching";
import {
  ACTIVE_PROFILE_CHANGE_EVENT,
  ACTIVE_PROFILE_STORAGE_KEY,
  getActiveProfileId,
} from "@/lib/profiles";

/** Serializable title metadata from the server page */
export type ContinueWatchingTitle = {
  id: string;
  name: string;
  posterUrl?: string | null;
};

export type ContinueWatchingProps = {
  titles: ContinueWatchingTitle[];
};

type Row = {
  title: ContinueWatchingTitle;
  progress: WatchProgressRecord;
};

/**
 * Client island: Continue Watching row for the active profile.
 * - Sorted by most recently watched
 * - Hides titles with >95% progress (enforced in listContinueWatching)
 * - Swaps contents on profile change without full page reload
 */
export default function ContinueWatching({ titles }: ContinueWatchingProps) {
  const [profileId, setProfileId] = useState<string>("default");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const titleById = useMemo(() => {
    const map = new Map<string, ContinueWatchingTitle>();
    for (const t of titles) map.set(String(t.id), t);
    return map;
  }, [titles]);

  const reload = useCallback(async (activeId: string) => {
    setLoading(true);
    try {
      const progressList = await listContinueWatching(activeId);
      const next: Row[] = [];
      for (const p of progressList) {
        const title = titleById.get(String(p.titleId));
        if (!title) continue;
        next.push({ title, progress: p });
      }
      setRows(next);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [titleById]);

  // Initial active profile + load
  useEffect(() => {
    const id = getActiveProfileId();
    setProfileId(id);
    void reload(id);
  }, [reload]);

  // Same-tab profile switches + cross-tab storage + progress writes
  useEffect(() => {
    const onProfile = (event: Event) => {
      const ce = event as CustomEvent<{ profileId?: string }>;
      const next = ce.detail?.profileId ?? getActiveProfileId();
      setProfileId(next);
      void reload(next);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACTIVE_PROFILE_STORAGE_KEY) return;
      const next = getActiveProfileId();
      setProfileId(next);
      void reload(next);
    };

    const onProgressChange = (event: Event) => {
      const ce = event as CustomEvent<{ profileId?: string }>;
      const active = getActiveProfileId();
      // Refresh if event is global or matches active profile
      if (!ce.detail?.profileId || ce.detail.profileId === active) {
        void reload(active);
      }
    };

    window.addEventListener(ACTIVE_PROFILE_CHANGE_EVENT, onProfile);
    window.addEventListener("storage", onStorage);
    window.addEventListener(CONTINUE_WATCHING_CHANGE_EVENT, onProgressChange);

    return () => {
      window.removeEventListener(ACTIVE_PROFILE_CHANGE_EVENT, onProfile);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        CONTINUE_WATCHING_CHANGE_EVENT,
        onProgressChange
      );
    };
  }, [reload]);

  if (!loading && rows.length === 0) {
    return null;
  }

  return (
    <section className="continue-watching" aria-label="Continue Watching">
      <header className="continue-watching__header">
        <h2>Continue Watching</h2>
        {loading ? (
          <span className="continue-watching__status">Loading…</span>
        ) : (
          <span className="continue-watching__status" data-profile={profileId}>
            Profile: {profileId}
          </span>
        )}
      </header>

      <ul className="continue-watching__row">
        {rows.map(({ title, progress }) => {
          const pct = Math.round((progress.percent || 0) * 100);
          return (
            <li key={title.id} className="continue-watching__item">
              <Link
                href={`/watch/${encodeURIComponent(title.id)}`}
                className="continue-watching__card"
              >
                {title.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={title.posterUrl}
                    alt=""
                    className="continue-watching__poster"
                  />
                ) : (
                  <div className="continue-watching__poster continue-watching__poster--placeholder">
                    {title.name.slice(0, 1)}
                  </div>
                )}
                <div className="continue-watching__meta">
                  <span className="continue-watching__title">{title.name}</span>
                  <div
                    className="continue-watching__bar"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${pct}% watched`}
                  >
                    <div
                      className="continue-watching__bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

---

### `components/ProfileSwitcher.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  getActiveProfileId,
  getProfiles,
  setActiveProfile,
  type Profile,
} from "@/lib/profiles";

/**
 * Renders profile avatars and switches the active profile.
 * setActiveProfile already dispatches ACTIVE_PROFILE_CHANGE_EVENT,
 * so Continue Watching updates without a full page reload.
 */
export default function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    setProfiles(getProfiles());
    setActiveId(getActiveProfileId());
  }, []);

  const onSelect = (id: string) => {
    setActiveProfile(id);
    setActiveId(id);
  };

  if (profiles.length === 0) return null;

  return (
    <div className="profile-switcher" role="listbox" aria-label="Profiles">
      {profiles.map((profile) => {
        const selected = profile.id === activeId;
        return (
          <button
            key={profile.id}
            type="button"
            role="option"
            aria-selected={selected}
            className={
              selected
                ? "profile-switcher__avatar is-active"
                : "profile-switcher__avatar"
            }
            onClick={() => onSelect(profile.id)}
            title={profile.name}
          >
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt={profile.name} />
            ) : (
              <span>{profile.name.slice(0, 1)}</span>
            )}
            <span className="profile-switcher__name">{profile.name}</span>
          </button>
        );
      })}
    </div>
  );
}
```

---

### `app/page.tsx`

```tsx
import ContinueWatching from "@/components/ContinueWatching";
import ProfileSwitcher from "@/components/ProfileSwitcher";
import { getTitles } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

type TitleRow = {
  id: string;
  name?: string;
  title?: string;
  posterUrl?: string | null;
  poster?: string | null;
  image?: string | null;
};

/**
 * Home page (server component).
 * Fetches catalog from SQLite; embeds client island for Continue Watching.
 */
export default async function HomePage() {
  const titles = (await getTitles()) as TitleRow[];

  const catalog = titles.map((t) => ({
    id: String(t.id),
    name: String(t.name ?? t.title ?? `Title ${t.id}`),
    posterUrl: t.posterUrl ?? t.poster ?? t.image ?? null,
  }));

  return (
    <main className="home">
      <header className="home__header">
        <h1>Home</h1>
        <ProfileSwitcher />
      </header>

      {/* Client island: progress from IndexedDB, metadata from server props */}
      <ContinueWatching titles={catalog} />

      <section className="home__catalog" aria-label="All titles">
        <h2>Browse</h2>
        <ul className="home__grid">
          {catalog.map((t) => (
            <li key={t.id}>
              <Link href={`/watch/${encodeURIComponent(t.id)}`}>
                {t.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.posterUrl} alt="" />
                ) : null}
                <span>{t.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

---

### `app/watch/[id]/page.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Player from "@/components/Player";
import ProfileSwitcher from "@/components/ProfileSwitcher";
import Link from "next/link";

type TitleDetail = {
  id: string;
  name?: string;
  title?: string;
  src?: string;
  videoUrl?: string;
  streamUrl?: string;
  subtitles?: Array<{
    src: string;
    srcLang?: string;
    label?: string;
    default?: boolean;
  }>;
};

/**
 * Player page (client component).
 * Uses Player + usePlayer; passes titleId so progress is stored per profile.
 *
 * Note: The repo description says this page uses hooks/usePlayer.ts.
 * We keep Player as the video wrapper (which calls usePlayer internally)
 * and pass route id as titleId. If the existing page called usePlayer
 * directly, the same titleId option applies there.
 */
export default function WatchPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        // Prefer an existing API route if present; fall back to a thin
        // client fetch pattern. Adjust to the repo’s real data loading.
        const res = await fetch(`/api/titles/${encodeURIComponent(id)}`);
        if (!res.ok) {
          // Fallback: minimal stub so the player still mounts with titleId
          // when no API exists — replace with real getTitle bridge as needed.
          if (!cancelled) {
            setTitle({
              id,
              name: `Title ${id}`,
              src: "",
              subtitles: [],
            });
          }
          return;
        }
        const data = (await res.json()) as TitleDetail;
        if (!cancelled) setTitle({ ...data, id: String(data.id ?? id) });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load title");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const src = title?.src ?? title?.videoUrl ?? title?.streamUrl ?? "";
  const displayName = title?.name ?? title?.title ?? id;

  return (
    <main className="watch">
      <header className="watch__header">
        <Link href="/">← Back</Link>
        <h1>{displayName}</h1>
        <ProfileSwitcher />
      </header>

      {error ? <p role="alert">{error}</p> : null}

      {id ? (
        <Player
          key={`${id}`}
          src={src}
          subtitles={title?.subtitles}
          titleId={id}
        />
      ) : (
        <p>Missing title id.</p>
      )}
    </main>
  );
}
```

---

## Integration notes (behavioral contract)

1. **Per-profile, per-title progress**  
   Keyed in IndexedDB as `profileId:titleId`. Active profile comes from `getActiveProfileId()` (localStorage), same as `ProfileSwitcher`.

2. **Throttle**  
   `saveProgressThrottled` guarantees ≤ 1 durable write per composite key every 5 seconds, with a trailing timer. `flushProgress` / `flushProgressAndNotify` force the latest pending snapshot on pause, ended, unmount, `visibilitychange` → hidden, and `pagehide`.

3. **Continue Watching row**  
   `ContinueWatching` is a client island on the server home page. It joins server-provided title metadata with `listContinueWatching(activeProfileId)`, which is sorted by `updatedAt` DESC and excludes `percent > 0.95` (completed rows are also deleted on write).

4. **Profile switch without full reload**  
   `setActiveProfile` writes localStorage and dispatches `active-profile-change`. The island listens and reloads IndexedDB rows for the new profile. Cross-tab updates use the `storage` event.

5. **No new dependencies**  
   Only native IndexedDB, `localStorage`, `CustomEvent`, React, and Next.js App Router APIs already in use.

6. **No breaking export changes**  
   - `getProfiles` / `setActiveProfile` remain.  
   - `getTitles` / `getTitle` untouched.  
   - `usePlayer` still returns `{ progress, seek, play, pause }` (plus optional additive fields).  
   - `Player` still accepts `src`, `subtitles`, `onProgress`; `titleId` is optional.

---

## Suggested minimal CSS (optional; only if the repo has no row styles)

If the project already styles layout elsewhere, skip this. Otherwise these classes match the markup above:

```css
.continue-watching {
  margin: 1.5rem 0;
}
.continue-watching__header {
  display: flex;
  align-items: baseline;
  gap: 1rem;
}
.continue-watching__row {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  list-style: none;
  padding: 0;
  margin: 0.75rem 0 0;
}
.continue-watching__card {
  display: flex;
  flex-direction: column;
  width: 10rem;
  text-decoration: none;
  color: inherit;
}
.continue-watching__poster {
  width: 10rem;
  height: 15rem;
  object-fit: cover;
  border-radius: 0.25rem;
  background: #222;
}
.continue-watching__poster--placeholder {
  display: grid;
  place-items: center;
  font-size: 2rem;
}
.continue-watching__bar {
  margin-top: 0.35rem;
  height: 0.25rem;
  background: #333;
  border-radius: 999px;
  overflow: hidden;
}
.continue-watching__bar-fill {
  height: 100%;
  background: #e50914;
}
.profile-switcher {
  display: flex;
  gap: 0.5rem;
}
.profile-switcher__avatar.is-active {
  outline: 2px solid #fff;
}
```
