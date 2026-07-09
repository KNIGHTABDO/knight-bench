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
