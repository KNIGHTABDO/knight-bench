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
