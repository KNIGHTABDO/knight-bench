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
