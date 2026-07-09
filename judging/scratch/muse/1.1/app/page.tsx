import { getTitles } from "@/lib/db";
import ContinueWatching from "@/components/ContinueWatching";
import ProfileSwitcher from "@/components/ProfileSwitcher";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Title = {
  id: string;
  title?: string;
  name?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  image?: string;
};

export default async function HomePage() {
  let titles: Title[] = [];
  try {
    const res = getTitles();
    titles = (res as any) instanceof Promise ? await res : res;
  } catch {
    titles = [];
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="flex items-center justify-between px-4 md:px-8 py-4 border-b border-zinc-800">
        <h1 className="text-2xl font-bold">Knight</h1>
        <ProfileSwitcher />
      </header>

      <ContinueWatching titles={titles} />

      <section className="px-4 md:px-8 py-6">
        <h2 className="text-xl font-semibold mb-4">All Titles</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {titles.map((t) => {
            const thumb = (t as any).thumbnail ?? (t as any).thumbnailUrl ?? (t as any).image ?? "";
            const name = t.title ?? t.name ?? t.id;
            return (
              <Link
                key={t.id}
                href={`/watch/${encodeURIComponent(t.id)}`}
                className="group rounded-md overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-600"
              >
                <div className="aspect-[16/9] bg-zinc-800">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt={name} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-zinc-500">{name}</div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-sm truncate">{name}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
