import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'streaming.db');
const db = new Database(dbPath);

// Initialize standard schema
db.exec(`
  CREATE TABLE IF NOT EXISTS titles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    thumbnail TEXT
  )
`);

// Populate DB seed values if empty
const countResult = db.prepare('SELECT count(*) as count FROM titles').get() as { count: number };
if (countResult.count === 0) {
  const insert = db.prepare('INSERT INTO titles (id, title, thumbnail) VALUES (?, ?, ?)');
  const dummyTitles = [
    { id: '1', title: 'Big Buck Bunny', thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/c/c5/Big_Buck_Bunny_Narrated_Charcoal_Design.jpg' },
    { id: '2', title: 'Sintel', thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/8/8f/Sintel_poster.jpg' },
    { id: '3', title: 'Tears of Steel', thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/6/69/Tears_of_Steel_poster.jpg' },
    { id: '4', title: 'Cosmos Laundromat', thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/3/36/Cosmos_Laundromat_-_First_Cycle_poster.jpg' },
    { id: '5', title: 'Caminandes 1: Llama Drama', thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/e/ec/Caminandes_Llama_Drama_poster.jpg' }
  ];

  const runSeedTx = db.transaction((list) => {
    for (const item of list) {
      insert.run(item.id, item.title, item.thumbnail);
    }
  });
  runSeedTx(dummyTitles);
}

export interface Title {
  id: string;
  title: string;
  thumbnail?: string;
}

export function getTitles(): Title[] {
  return db.prepare('SELECT * FROM titles').all() as Title[];
}

export function getTitle(id: string): Title | undefined {
  return db.prepare('SELECT * FROM titles WHERE id = ?').get(id) as Title | undefined;
}
