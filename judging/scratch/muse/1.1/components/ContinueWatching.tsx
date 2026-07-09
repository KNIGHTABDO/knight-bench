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
