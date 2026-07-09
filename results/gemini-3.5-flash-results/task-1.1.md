# PLAN

### (a) Files to Create or Modify
1. **`lib/db-client.ts` (New)**: Manages IndexedDB schema creation, records insertions, reads, and queries. Implements throttled progress updating (saving at most once every 5 seconds) as well as immediate/forced progress writes.
2. **`hooks/useActiveProfile.ts` (New)**: Custom React hook to retrieve and dynamically react to the active profile ID changes using browser custom events, avoiding full page reloads.
3. **`components/ContinueWatchingRow.tsx` (New)**: Client component ("island") rendered on the home page. It loads watch history from IndexedDB, merges it with title metadata, filters out completed titles (>95%), sorts by most recently watched, and renders the visual progress row.
4. **`app/providers.tsx` (New)**: Defines the client-side `<Providers>` wrapper to wrap root layout children.
5. **`lib/profiles.ts` (Modified)**: Adds custom event dispatching to `setActiveProfile(id)` so client components are notified immediately, and exports a server-safe `getActiveProfileId()` helper.
6. **`lib/db.ts` (Modified)**: Simulates the database connection using `better-sqlite3` on the server, seeding dummy titles if the DB is empty, and exports retrieval methods.
7. **`hooks/usePlayer.ts` (Modified)**: Tracks playback progress, restores initial playback position from IndexedDB when a title is loaded, and handles throttled/forced IndexedDB writes.
8. **`components/Player.tsx` (Modified)**: Renders the HTML5 `<video>` element, forwards the video ref, and triggers progress reporting.
9. **`components/ProfileSwitcher.tsx` (Modified)**: Renders the active profile toggle buttons and invokes `setActiveProfile(id)` to dynamically switch profiles.
10. **`app/page.tsx` (Modified)**: Serves as the server-side Home Page, fetching all titles from SQLite and embedding the `ContinueWatchingRow` client island.
11. **`app/watch/[id]/page.tsx` (Modified)**: Client page that uses the player hook and custom player component to watch a specific title.
12. **`app/layout.tsx` (Modified)**: Establishes the root layout, loading global styles, rendering the header/switcher, and wrapping children in `<Providers>`.

### (b) Ambiguities & Risks Resolution
* **Ambiguity 1 (Client/Server Joining)**: How does the client-side row display title metadata (names, thumbnails) when IndexedDB only contains `titleId` progress?
  * **Resolution**: The server-rendered page fetches the full list of titles via `getTitles()` and passes it to the client component `<ContinueWatchingRow>` as a prop. The client component joins this list with IndexedDB records in-memory, avoiding redundant API calls.
* **Ambiguity 2 (Data Loss on Quick Exit)**: The 5-second throttling could cause the last few seconds of watch history to be lost if a user closes their browser or navigates away.
  * **Resolution**: We export a `forceSaveProgress` function alongside `saveProgressThrottled`. The hook invokes `forceSaveProgress` immediately on the video player's `pause` event, `beforeunload` page navigation, and React component cleanup/unmount.
* **Risk 3 (SSR/Hydration Safety)**: Accessing `localStorage` or `indexedDB` during Next.js server-side rendering (SSR) throws reference errors.
  * **Resolution**: We check `typeof window !== 'undefined'` in helper files and perform all IndexedDB and event listener operations within React `useEffect` hooks so they execute only on the client.

### (c) IndexedDB Schema
* **Database Name**: `ContinueWatchingDB`
* **Version**: `1`
* **Object Store**: `progress`
* **Key Path**: `['profileId', 'titleId']` (compound primary key enforcing uniqueness per-profile, per-title).
* **Index**: `profileId` (keyPath: `'profileId'`, unique: `false`) for querying all progress records for the active profile.
* **Properties per Record**:
  * `profileId` (string): Current active profile ID.
  * `titleId` (string): Watched title identifier.
  * `progress` (number): A float between `0` and `1` (representing percentage watched).
  * `updatedAt` (number): Timestamp of the last progress update (used for descending sorting).

---

# FILE CONTENTS

### `lib/db-client.ts`
```typescript
export interface WatchProgress {
  profileId: string;
  titleId: string;
  progress: number; // float from 0 to 1
  updatedAt: number; // Unix timestamp
}

const DB_NAME = 'ContinueWatchingDB';
const DB_VERSION = 1;
const STORE_NAME = 'progress';

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('IndexedDB is only available in the browser'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: ['profileId', 'titleId'] });
        store.createIndex('profileId', 'profileId', { unique: false });
      }
    };
  });
}

export function getProgress(profileId: string, titleId: string): Promise<WatchProgress | null> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get([profileId, titleId]);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  });
}

export function getAllProgressForProfile(profileId: string): Promise<WatchProgress[]> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('profileId');
      const request = index.getAll(profileId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  });
}

export function saveProgress(profileId: string, titleId: string, progress: number): Promise<void> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const record: WatchProgress = {
        profileId,
        titleId,
        progress,
        updatedAt: Date.now(),
      };
      const request = store.put(record);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  });
}

let lastSaveTime = 0;
let throttleTimeout: NodeJS.Timeout | null = null;
let pendingProgress: number | null = null;

export function saveProgressThrottled(profileId: string, titleId: string, progress: number) {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  pendingProgress = progress;

  const executeSave = () => {
    if (pendingProgress !== null) {
      saveProgress(profileId, titleId, pendingProgress).catch((err) =>
        console.error('Error saving progress:', err)
      );
      pendingProgress = null;
      lastSaveTime = Date.now();
    }
    if (throttleTimeout) {
      clearTimeout(throttleTimeout);
      throttleTimeout = null;
    }
  };

  if (now - lastSaveTime >= 5000) {
    executeSave();
  } else if (!throttleTimeout) {
    throttleTimeout = setTimeout(executeSave, 5000 - (now - lastSaveTime));
  }
}

export function forceSaveProgress(profileId: string, titleId: string, progress: number) {
  if (typeof window === 'undefined') return;

  if (throttleTimeout) {
    clearTimeout(throttleTimeout);
    throttleTimeout = null;
  }
  pendingProgress = null;
  saveProgress(profileId, titleId, progress).catch((err) =>
    console.error('Error forcing progress save:', err)
  );
  lastSaveTime = Date.now();
}
```

### `hooks/useActiveProfile.ts`
```typescript
'use client';

import { useState, useEffect } from 'react';
import { getActiveProfileId } from '@/lib/profiles';

export function useActiveProfile() {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setActiveId(getActiveProfileId());

    const handleProfileChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      setActiveId(customEvent.detail);
    };

    window.addEventListener('active-profile-change', handleProfileChange);
    return () => {
      window.removeEventListener('active-profile-change', handleProfileChange);
    };
  }, []);

  return activeId;
}
```

### `components/ContinueWatchingRow.tsx`
```tsx
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { getAllProgressForProfile } from '@/lib/db-client';

interface Title {
  id: string;
  title: string;
  thumbnail?: string;
}

interface ContinueWatchingRowProps {
  titles: Title[];
}

export default function ContinueWatchingRow({ titles }: ContinueWatchingRowProps) {
  const activeProfileId = useActiveProfile();
  const [items, setItems] = useState<{ title: Title; progress: number }[]>([]);

  useEffect(() => {
    if (!activeProfileId) {
      setItems([]);
      return;
    }

    let isMounted = true;

    getAllProgressForProfile(activeProfileId)
      .then((progresses) => {
        if (!isMounted) return;

        // Filter and keep progresses <= 95%
        const filteredProgresses = progresses.filter((p) => p.progress <= 0.95);

        // Sort by updatedAt descending (most recently watched first)
        filteredProgresses.sort((a, b) => b.updatedAt - a.updatedAt);

        // Map database records to corresponding Title objects
        const mapped = filteredProgresses
          .map((p) => {
            const title = titles.find((t) => String(t.id) === String(p.titleId));
            return title ? { title, progress: p.progress } : null;
          })
          .filter((item): item is { title: Title; progress: number } => item !== null);

        setItems(mapped);
      })
      .catch((err) => {
        console.error('Failed to load continue watching row:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [activeProfileId, titles]);

  if (!activeProfileId || items.length === 0) {
    return null;
  }

  return (
    <div className="my-8">
      <h2 className="text-xl font-bold mb-4 text-white">Continue Watching</h2>
      <div className="flex space-x-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-gray-800">
        {items.map(({ title, progress }) => (
          <div key={title.id} className="relative flex-shrink-0 w-48 group">
            <Link href={`/watch/${title.id}`} className="block">
              <div className="aspect-video bg-gray-800 rounded-md overflow-hidden relative shadow-md hover:ring-2 hover:ring-red-600 transition-all duration-150">
                {title.thumbnail ? (
                  <img
                    src={title.thumbnail}
                    alt={title.title}
                    className="object-cover w-full h-full"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-500 font-medium p-2 text-center text-xs">
                    {title.title}
                  </div>
                )}
                {/* Progress bar visual indicators */}
                <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gray-700">
                  <div
                    className="h-full bg-red-600 transition-all duration-300"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
              <span className="block mt-2 text-xs font-semibold truncate text-gray-300 group-hover:text-white">
                {title.title}
              </span>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### `app/providers.tsx`
```tsx
'use client';

import React from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

### `lib/profiles.ts`
```typescript
export interface Profile {
  id: string;
  name: string;
  avatarUrl?: string;
}

const DEFAULT_PROFILES: Profile[] = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
  { id: '3', name: 'Charlie' },
];

export function getProfiles(): Profile[] {
  return DEFAULT_PROFILES;
}

export function setActiveProfile(id: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('activeProfileId', id);
    // Dispatch event to allow client-side sync without page reload
    window.dispatchEvent(new CustomEvent('active-profile-change', { detail: id }));
  }
}

export function getActiveProfileId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('activeProfileId') || DEFAULT_PROFILES[0].id;
}
```

### `lib/db.ts`
```typescript
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'streaming.db');
const db = new Database(dbPath);

// Initialize standard schema
db.exec(`
  CREATE TABLE IF NOT EXISTS titles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    thumbnail TEXT
  )
`);

// Populate DB seed values if empty
const countResult = db.prepare('SELECT count(*) as count FROM titles').get() as { count: number };
if (countResult.count === 0) {
  const insert = db.prepare('INSERT INTO titles (id, title, thumbnail) VALUES (?, ?, ?)');
  const dummyTitles = [
    { id: '1', title: 'Big Buck Bunny', thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/c/c5/Big_Buck_Bunny_Narrated_Charcoal_Design.jpg' },
    { id: '2', title: 'Sintel', thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/8/8f/Sintel_poster.jpg' },
    { id: '3', title: 'Tears of Steel', thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/6/69/Tears_of_Steel_poster.jpg' },
    { id: '4', title: 'Cosmos Laundromat', thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/3/36/Cosmos_Laundromat_-_First_Cycle_poster.jpg' },
    { id: '5', title: 'Caminandes 1: Llama Drama', thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/e/ec/Caminandes_Llama_Drama_poster.jpg' }
  ];

  const runSeedTx = db.transaction((list) => {
    for (const item of list) {
      insert.run(item.id, item.title, item.thumbnail);
    }
  });
  runSeedTx(dummyTitles);
}

export interface Title {
  id: string;
  title: string;
  thumbnail?: string;
}

export function getTitles(): Title[] {
  return db.prepare('SELECT * FROM titles').all() as Title[];
}

export function getTitle(id: string): Title | undefined {
  return db.prepare('SELECT * FROM titles WHERE id = ?').get(id) as Title | undefined;
}
```

### `hooks/usePlayer.ts`
```typescript
'use client';

import { useState, useEffect, useRef } from 'react';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { getProgress, saveProgressThrottled, forceSaveProgress } from '@/lib/db-client';

export function usePlayer(titleId: string) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [progress, setProgress] = useState(0);
  const activeProfileId = useActiveProfile();

  const activeProfileRef = useRef<string | null>(null);
  useEffect(() => {
    activeProfileRef.current = activeProfileId;
  }, [activeProfileId]);

  // Load progress when active profile and ref are set
  useEffect(() => {
    if (!activeProfileId || !titleId) return;

    let isMounted = true;
    getProgress(activeProfileId, titleId).then((saved) => {
      if (!isMounted || !saved) return;

      const video = videoRef.current;
      if (video) {
        const applySavedTime = () => {
          if (video.duration) {
            video.currentTime = saved.progress * video.duration;
            setProgress(saved.progress);
            video.removeEventListener('loadedmetadata', applySavedTime);
          }
        };

        if (video.readyState >= 1) {
          applySavedTime();
        } else {
          video.addEventListener('loadedmetadata', applySavedTime);
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [activeProfileId, titleId]);

  // Hook into video updates and page teardown triggers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (video.duration) {
        const currentProgress = video.currentTime / video.duration;
        setProgress(currentProgress);

        const profileId = activeProfileRef.current;
        if (profileId) {
          saveProgressThrottled(profileId, titleId, currentProgress);
        }
      }
    };

    const handlePause = () => {
      if (video.duration) {
        const currentProgress = video.currentTime / video.duration;
        const profileId = activeProfileRef.current;
        if (profileId) {
          forceSaveProgress(profileId, titleId, currentProgress);
        }
      }
    };

    const handleUnload = () => {
      if (video.duration) {
        const currentProgress = video.currentTime / video.duration;
        const profileId = activeProfileRef.current;
        if (profileId) {
          forceSaveProgress(profileId, titleId, currentProgress);
        }
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('pause', handlePause);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      if (video.duration) {
        const currentProgress = video.currentTime / video.duration;
        const profileId = activeProfileRef.current;
        if (profileId) {
          forceSaveProgress(profileId, titleId, currentProgress);
        }
      }
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('pause', handlePause);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [titleId]);

  const play = () => {
    videoRef.current?.play().catch((err) => console.error('Play aborted:', err));
  };

  const pause = () => {
    videoRef.current?.pause();
  };

  const seek = (time: number) => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = time;
      if (video.duration) {
        setProgress(time / video.duration);
      }
    }
  };

  return {
    progress,
    seek,
    play,
    pause,
    videoRef,
  };
}
```

### `components/Player.tsx`
```tsx
import React, { forwardRef } from 'react';

interface PlayerProps {
  src: string;
  subtitles?: string;
  onProgress?: (progress: number) => void;
}

const Player = forwardRef<HTMLVideoElement, PlayerProps>(
  ({ src, subtitles, onProgress }, ref) => {
    return (
      <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-lg border border-gray-800">
        <video
          ref={ref}
          src={src}
          controls
          className="w-full h-full"
          onTimeUpdate={(e) => {
            const video = e.currentTarget;
            if (video.duration) {
              const progress = video.currentTime / video.duration;
              onProgress?.(progress);
            }
          }}
        >
          {subtitles && (
            <track
              src={subtitles}
              kind="subtitles"
              srcLang="en"
              label="English"
              default
            />
          )}
        </video>
      </div>
    );
  }
);

Player.displayName = 'Player';
export default Player;
```

### `components/ProfileSwitcher.tsx`
```tsx
'use client';

import React from 'react';
import { getProfiles, setActiveProfile } from '@/lib/profiles';
import { useActiveProfile } from '@/hooks/useActiveProfile';

export default function ProfileSwitcher() {
  const profiles = getProfiles();
  const activeProfileId = useActiveProfile();

  const handleSelect = (id: string) => {
    setActiveProfile(id);
  };

  return (
    <div className="flex items-center space-x-2 bg-gray-900/50 p-1.5 rounded-full border border-gray-800">
      {profiles.map((profile) => {
        const isActive = profile.id === activeProfileId;
        return (
          <button
            key={profile.id}
            onClick={() => handleSelect(profile.id)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 ${
              isActive
                ? 'bg-red-600 text-white shadow-md scale-105'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {profile.name}
          </button>
        );
      })}
    </div>
  );
}
```

### `app/page.tsx`
```tsx
import React from 'react';
import { getTitles } from '@/lib/db';
import ContinueWatchingRow from '@/components/ContinueWatchingRow';
import Link from 'next/link';

export default async function HomePage() {
  const titles = await getTitles();

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        {/* Continue Watching Client component island */}
        <ContinueWatchingRow titles={titles} />

        {/* All Titles Showcase */}
        <section className="my-8">
          <h2 className="text-xl font-bold mb-4">All Titles</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {titles.map((title) => (
              <div
                key={title.id}
                className="bg-gray-900 rounded-md overflow-hidden group hover:scale-105 transition-transform duration-200 shadow-md border border-gray-800"
              >
                <Link href={`/watch/${title.id}`} className="block">
                  <div className="aspect-video bg-gray-800 flex items-center justify-center text-gray-400 font-semibold p-4 text-center text-sm">
                    {title.thumbnail ? (
                      <img src={title.thumbnail} alt={title.title} className="object-cover w-full h-full" />
                    ) : (
                      title.title
                    )}
                  </div>
                  <div className="p-3">
                    <h3 className="font-semibold text-sm truncate">{title.title}</h3>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
```

### `app/watch/[id]/page.tsx`
```tsx
'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Player from '@/components/Player';
import { usePlayer } from '@/hooks/usePlayer';

export default function WatchPage() {
  const params = useParams();
  const id = params?.id as string;

  const { progress, play, pause, videoRef } = usePlayer(id);
  const sampleVideoSrc = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

  return (
    <div className="min-h-screen bg-black text-white p-6 flex flex-col justify-center items-center">
      <div className="w-full max-w-4xl mb-4 flex items-center justify-between">
        <Link href="/" className="text-gray-400 hover:text-white flex items-center gap-2 transition-colors text-sm">
          <span>&larr;</span> Back to Home
        </Link>
        <div className="text-xs text-gray-400 bg-gray-900 px-3 py-1 rounded-full">
          Progress: {Math.round(progress * 100)}%
        </div>
      </div>

      <div className="w-full max-w-4xl">
        <Player ref={videoRef} src={sampleVideoSrc} />
      </div>

      <div className="w-full max-w-4xl mt-6 flex justify-center gap-4">
        <button
          onClick={play}
          className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-semibold transition-colors shadow"
        >
          Play
        </button>
        <button
          onClick={pause}
          className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm font-semibold transition-colors shadow border border-gray-700"
        >
          Pause
        </button>
      </div>
    </div>
  );
}
```

### `app/layout.tsx`
```tsx
import './globals.css';
import React from 'react';
import Providers from './providers';
import ProfileSwitcher from '@/components/ProfileSwitcher';
import Link from 'next/link';

export const metadata = {
  title: 'Video Streaming App',
  description: 'Netflix-style continue watching feature',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen">
        <Providers>
          <header className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur-sm border-b border-gray-800 px-8 py-4 flex justify-between items-center">
            <Link href="/" className="font-bold text-lg tracking-wider text-red-600 hover:opacity-90">
              STREAMING
            </Link>
            <ProfileSwitcher />
          </header>
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
```
