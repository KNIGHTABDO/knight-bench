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
