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
