import { getTitles } from "../lib/db";
import ContinueWatching from "../components/ContinueWatching";

export default async function HomePage() {
  const titles = getTitles();

  // Minimal shape the client island needs. Defensive field fallbacks in
  // case getTitles()'s exact field names differ slightly (title/name,
  // posterUrl/poster, durationSeconds/duration) -- no assumption is made
  // about lib/db.ts's exact return type beyond "has an id".
  const continueWatchingTitles = titles.map((t: any) => ({
    id: String(t.id),
    title: t.title ?? t.name ?? "",
    posterUrl: t.posterUrl ?? t.poster ?? undefined,
    durationSeconds: t.durationSeconds ?? t.duration ?? undefined,
  }));

  return (
    <main>
      <h1>Home</h1>
      <ContinueWatching allTitles={continueWatchingTitles} />
      <div className="title-grid">
        {titles.map((t: any) => (
          <a key={t.id} href={`/watch/${t.id}`}>
            {t.title ?? t.name}
          </a>
        ))}
      </div>
    </main>
  );
}
