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
