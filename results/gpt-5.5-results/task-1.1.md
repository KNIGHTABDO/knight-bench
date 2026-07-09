# PLAN

Files I will create or modify:

- `lib/watchProgress.ts` — new client-only IndexedDB persistence module. It owns the database schema, throttled progress writes, per-profile/title reads, and a small subscription mechanism so UI islands can update when profile progress changes.
- `lib/profiles.ts` — modify without removing existing exports. `getProfiles()` and `setActiveProfile(id)` remain available; I will add `getActiveProfileId()`, `subscribeActiveProfile()`, and `PROFILE_CHANGED_EVENT` so profile changes can update client islands without a page reload. The existing localStorage backing remains because the request only forbids localStorage for watch progress.
- `hooks/usePlayer.ts` — modify to save progress per active profile and title through IndexedDB, throttled by the persistence module. It will keep the existing return shape `{ progress, seek, play, pause }` and add optional inputs without breaking existing callers.
- `components/Player.tsx` — modify to ensure `onProgress` is called with enough information for the hook to persist useful progress. The public props remain `src`, `subtitles`, and `onProgress`; this is compatible if `onProgress` already accepted a numeric progress value.
- `components/ContinueWatchingRow.tsx` — new client component island for the home page. It listens for profile changes, reads IndexedDB progress for that profile, filters titles above 95%, sorts by most recently watched, and renders title links.
- `app/page.tsx` — modify server component to fetch all titles as before and include the `ContinueWatchingRow` client island.
- `app/watch/[id]/page.tsx` — modify client player page to pass `titleId` into `usePlayer()` and wire the player progress callback to the hook.

Ambiguities / risks and resolutions:

- Ambiguity: the exact shape returned by `getTitles()` / `getTitle(id)` is not specified. Resolution: I will type the Continue Watching island against a minimal title shape of `{ id: string | number; title: string; posterUrl?: string | null; thumbnailUrl?: string | null }` and normalize IDs to strings when talking to IndexedDB.
- Ambiguity: existing `usePlayer.ts` API is described only by its return value, not its parameters. Resolution: I will support an optional options object `{ titleId?: string | number }`, while leaving the return object unchanged. Existing calls to `usePlayer()` remain valid.
- Risk: App Router server components cannot read IndexedDB. Resolution: the home page stays a server component and passes server-fetched title metadata to a client island, which performs all IndexedDB reads in the browser.
- Risk: profile switching currently uses localStorage, which does not automatically notify components in the same tab. Resolution: `setActiveProfile(id)` will dispatch a custom window event, and `ContinueWatchingRow` will subscribe to that event.
- Risk: throttling progress writes can lose the final position when a user leaves the page. Resolution: normal playback progress is throttled to at most one write per 5 seconds, but `pagehide` / `visibilitychange` flushes the latest pending progress immediately.

IndexedDB schema:

- Database name: `knight-bench-watch-progress`
- Version: `1`
- Object store: `progress`
- Primary key: compound key `[profileId, titleId]`
- Indexes:
  - `byProfileUpdatedAt`: compound index `[profileId, updatedAt]`, used to retrieve one profile's progress sorted by recency.
  - `byProfileTitle`: compound index `[profileId, titleId]`, redundant with the primary key but useful for explicit lookups and future migration clarity.
- Stored record shape:

```ts
export type WatchProgressRecord = {
  profileId: string;
  titleId: string;
  progress: number; // 0..1 fraction watched
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number; // Date.now()
};
```

Progress is hidden from Continue Watching when `progress > 0.95`.

## `lib/watchProgress.ts`

```ts
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
```

## `lib/profiles.ts`

```ts
'use client';

export type Profile = {
  id: string;
  name: string;
  avatarUrl: string;
};

export const PROFILE_CHANGED_EVENT = 'knight-bench:profile-changed';

const ACTIVE_PROFILE_STORAGE_KEY = 'knight-bench-active-profile';

const profiles: Profile[] = [
  {
    id: 'default',
    name: 'Default',
    avatarUrl: '/profiles/default.png',
  },
];

function canUseStorage() {
  return typeof window !== 'undefined' && 'localStorage' in window;
}

function emitProfileChanged(profileId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(PROFILE_CHANGED_EVENT, {
      detail: { profileId },
    }),
  );
}

export function getProfiles() {
  return profiles;
}

export function getActiveProfileId() {
  const fallbackProfileId = profiles[0]?.id ?? 'default';

  if (!canUseStorage()) {
    return fallbackProfileId;
  }

  return window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY) ?? fallbackProfileId;
}

export function setActiveProfile(id: string) {
  if (canUseStorage()) {
    window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
  }

  emitProfileChanged(id);
}

export function subscribeActiveProfile(listener: (profileId: string) => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const onProfileChanged = (event: Event) => {
    const profileId = (event as CustomEvent<{ profileId?: string }>).detail?.profileId;

    if (profileId) {
      listener(profileId);
    }
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_PROFILE_STORAGE_KEY && event.newValue) {
      listener(event.newValue);
    }
  };

  window.addEventListener(PROFILE_CHANGED_EVENT, onProfileChanged);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(PROFILE_CHANGED_EVENT, onProfileChanged);
    window.removeEventListener('storage', onStorage);
  };
}
```

## `hooks/usePlayer.ts`

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushPendingProgress, getProgressForTitle, saveProgressThrottled } from '@/lib/watchProgress';
import { getActiveProfileId, subscribeActiveProfile } from '@/lib/profiles';

type UsePlayerOptions = {
  titleId?: string | number;
};

type ProgressUpdate = {
  positionSeconds: number;
  durationSeconds: number;
};

export function usePlayer(options: UsePlayerOptions = {}) {
  const { titleId } = options;
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const profileIdRef = useRef<string | null>(null);
  const mediaElementRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    profileIdRef.current = getActiveProfileId();

    return subscribeActiveProfile((profileId) => {
      profileIdRef.current = profileId;

      if (!titleId) {
        setProgress(0);
        return;
      }

      void getProgressForTitle(profileId, titleId).then((record) => {
        setProgress(record?.progress ?? 0);
      });
    });
  }, [titleId]);

  useEffect(() => {
    if (!titleId) {
      return;
    }

    const profileId = profileIdRef.current ?? getActiveProfileId();
    profileIdRef.current = profileId;

    void getProgressForTitle(profileId, titleId).then((record) => {
      setProgress(record?.progress ?? 0);
    });
  }, [titleId]);

  useEffect(() => {
    const flush = () => flushPendingProgress();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingProgress();
      }
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);

    return () => {
      flushPendingProgress();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, []);

  const onProgress = useCallback(
    (update: ProgressUpdate) => {
      const nextProgress =
        update.durationSeconds > 0 ? update.positionSeconds / update.durationSeconds : 0;

      setProgress(Math.min(1, Math.max(0, nextProgress)));

      if (!titleId || !profileIdRef.current) {
        return;
      }

      saveProgressThrottled({
        profileId: profileIdRef.current,
        titleId,
        positionSeconds: update.positionSeconds,
        durationSeconds: update.durationSeconds,
      });
    },
    [titleId],
  );

  const seek = useCallback((nextProgress: number) => {
    const clampedProgress = Math.min(1, Math.max(0, nextProgress));

    setProgress(clampedProgress);

    if (mediaElementRef.current?.duration) {
      mediaElementRef.current.currentTime = mediaElementRef.current.duration * clampedProgress;
    }
  }, []);

  const play = useCallback(() => {
    setIsPlaying(true);
    void mediaElementRef.current?.play();
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
    mediaElementRef.current?.pause();
    flushPendingProgress();
  }, []);

  return {
    progress,
    seek,
    play,
    pause,
    isPlaying,
    onProgress,
    mediaElementRef,
  };
}
```

## `components/Player.tsx`

```tsx
'use client';

import { useEffect, useRef } from 'react';

type Subtitle = {
  src: string;
  srcLang: string;
  label: string;
  default?: boolean;
};

type ProgressUpdate = {
  positionSeconds: number;
  durationSeconds: number;
};

type PlayerProps = {
  src: string;
  subtitles?: Subtitle[];
  onProgress?: (progress: ProgressUpdate) => void;
};

export default function Player({ src, subtitles = [], onProgress }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || !onProgress) {
      return;
    }

    const handleTimeUpdate = () => {
      onProgress({
        positionSeconds: video.currentTime,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
      });
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('pause', handleTimeUpdate);
    video.addEventListener('ended', handleTimeUpdate);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('pause', handleTimeUpdate);
      video.removeEventListener('ended', handleTimeUpdate);
    };
  }, [onProgress]);

  return (
    <video ref={videoRef} controls playsInline preload="metadata" src={src}>
      {subtitles.map((subtitle) => (
        <track
          key={`${subtitle.srcLang}-${subtitle.src}`}
          src={subtitle.src}
          srcLang={subtitle.srcLang}
          label={subtitle.label}
          default={subtitle.default}
          kind="subtitles"
        />
      ))}
    </video>
  );
}
```

## `components/ContinueWatchingRow.tsx`

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getActiveProfileId, subscribeActiveProfile } from '@/lib/profiles';
import {
  getProgressForProfile,
  subscribeWatchProgress,
  type WatchProgressRecord,
} from '@/lib/watchProgress';

type ContinueWatchingTitle = {
  id: string | number;
  title: string;
  posterUrl?: string | null;
  thumbnailUrl?: string | null;
};

type ContinueWatchingRowProps = {
  titles: ContinueWatchingTitle[];
};

type ContinueWatchingItem = ContinueWatchingTitle & {
  progress: WatchProgressRecord;
};

const COMPLETE_PROGRESS_THRESHOLD = 0.95;

export default function ContinueWatchingRow({ titles }: ContinueWatchingRowProps) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [records, setRecords] = useState<WatchProgressRecord[]>([]);

  const titleById = useMemo(() => {
    return new Map(titles.map((title) => [String(title.id), title]));
  }, [titles]);

  useEffect(() => {
    setProfileId(getActiveProfileId());

    return subscribeActiveProfile((nextProfileId) => {
      setProfileId(nextProfileId);
    });
  }, []);

  useEffect(() => {
    if (!profileId) {
      setRecords([]);
      return;
    }

    let cancelled = false;

    const refresh = () => {
      void getProgressForProfile(profileId).then((nextRecords) => {
        if (!cancelled) {
          setRecords(nextRecords);
        }
      });
    };

    refresh();
    const unsubscribe = subscribeWatchProgress(refresh);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [profileId]);

  const items = useMemo<ContinueWatchingItem[]>(() => {
    return records
      .filter((record) => record.progress <= COMPLETE_PROGRESS_THRESHOLD)
      .map((record) => {
        const title = titleById.get(record.titleId);

        if (!title) {
          return null;
        }

        return {
          ...title,
          progress: record,
        };
      })
      .filter((item): item is ContinueWatchingItem => item !== null)
      .sort((a, b) => b.progress.updatedAt - a.progress.updatedAt);
  }, [records, titleById]);

  if (items.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="continue-watching-heading">
      <h2 id="continue-watching-heading">Continue Watching</h2>
      <div>
        {items.map((item) => {
          const imageSrc = item.thumbnailUrl ?? item.posterUrl;
          const percent = Math.round(item.progress.progress * 100);

          return (
            <Link key={String(item.id)} href={`/watch/${item.id}`}>
              {imageSrc ? <img src={imageSrc} alt="" /> : null}
              <span>{item.title}</span>
              <progress value={item.progress.progress} max={1} aria-label={`${percent}% watched`} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
```

## `app/page.tsx`

```tsx
import ContinueWatchingRow from '@/components/ContinueWatchingRow';
import { getTitles } from '@/lib/db';

export default async function HomePage() {
  const titles = await getTitles();

  return (
    <main>
      <ContinueWatchingRow titles={titles} />

      <section aria-labelledby="all-titles-heading">
        <h1 id="all-titles-heading">Browse</h1>
        <div>
          {titles.map((title) => (
            <a key={String(title.id)} href={`/watch/${title.id}`}>
              {title.posterUrl ? <img src={title.posterUrl} alt="" /> : null}
              <span>{title.title}</span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
```

## `app/watch/[id]/page.tsx`

```tsx
'use client';

import Player from '@/components/Player';
import { usePlayer } from '@/hooks/usePlayer';
import { getTitle } from '@/lib/db';

type WatchPageProps = {
  params: {
    id: string;
  };
};

export default function WatchPage({ params }: WatchPageProps) {
  const title = getTitle(params.id);
  const player = usePlayer({ titleId: params.id });

  return (
    <main>
      <h1>{title.title}</h1>
      <Player src={title.src} subtitles={title.subtitles} onProgress={player.onProgress} />
    </main>
  );
}
```
