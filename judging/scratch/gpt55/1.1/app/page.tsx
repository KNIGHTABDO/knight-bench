import ContinueWatchingRow from '@/components/ContinueWatchingRow';
import { getTitles } from '@/lib/db';

export default async function HomePage() {
  const titles = await getTitles();

  return (
    <main>
      <ContinueWatchingRow titles={titles} />

      <section aria-labelledby="all-titles-heading">
        <h1 id="all-titles-heading">Browse</h1>
        <div>
          {titles.map((title) => (
            <a key={String(title.id)} href={`/watch/${title.id}`}>
              {title.posterUrl ? <img src={title.posterUrl} alt="" /> : null}
              <span>{title.title}</span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
