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
