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
