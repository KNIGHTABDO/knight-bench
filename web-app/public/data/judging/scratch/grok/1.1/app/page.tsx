import ContinueWatching from "@/components/ContinueWatching";
import ProfileSwitcher from "@/components/ProfileSwitcher";
import { getTitles } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

type TitleRow = {
  id: string;
  name?: string;
  title?: string;
  posterUrl?: string | null;
  poster?: string | null;
  image?: string | null;
};

/**
 * Home page (server component).
 * Fetches catalog from SQLite; embeds client island for Continue Watching.
 */
export default async function HomePage() {
  const titles = (await getTitles()) as TitleRow[];

  const catalog = titles.map((t) => ({
    id: String(t.id),
    name: String(t.name ?? t.title ?? `Title ${t.id}`),
    posterUrl: t.posterUrl ?? t.poster ?? t.image ?? null,
  }));

  return (
    <main className="home">
      <header className="home__header">
        <h1>Home</h1>
        <ProfileSwitcher />
      </header>

      {/* Client island: progress from IndexedDB, metadata from server props */}
      <ContinueWatching titles={catalog} />

      <section className="home__catalog" aria-label="All titles">
        <h2>Browse</h2>
        <ul className="home__grid">
          {catalog.map((t) => (
            <li key={t.id}>
              <Link href={`/watch/${encodeURIComponent(t.id)}`}>
                {t.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.posterUrl} alt="" />
                ) : null}
                <span>{t.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
