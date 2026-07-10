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
