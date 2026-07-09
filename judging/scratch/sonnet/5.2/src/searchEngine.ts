import Database from "better-sqlite3";
import { normalizeFrenchMedical } from "./normalize";
import { buildExpandedQuery, buildSearchSql } from "./queryBuilder";

export interface DocInput {
  docId: string;
  title: string;
  section: string;
  body: string;
}

export interface SearchResult {
  docId: string;
  title: string;
  section: string;
  body: string;
  bm25Cost: number;
  phraseBonus: number;
  finalScore: number;
}

export const PHRASE_BOOST = 5.0;

export class MedicalSearchEngine {
  private db: Database.Database;

  constructor(dbPath = ":memory:") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
        title,
        section,
        body,
        doc_id UNINDEXED,
        tokenize = "unicode61 remove_diacritics 2 tokenchars '-'"
      );
    `);
  }

  /** Index-time normalization mirrors query-time normalization exactly. */
  addDocument(doc: DocInput): void {
    const stmt = this.db.prepare(
      `INSERT INTO docs_fts (title, section, body, doc_id) VALUES (?, ?, ?, ?)`
    );
    stmt.run(
      normalizeFrenchMedical(doc.title),
      normalizeFrenchMedical(doc.section),
      normalizeFrenchMedical(doc.body),
      doc.docId
    );
  }

  clear(): void {
    this.db.exec(`DELETE FROM docs_fts;`);
  }

  search(rawQuery: string, phraseBoost = PHRASE_BOOST) {
    const expansion = buildExpandedQuery(rawQuery);

    // Build an optional exact-phrase MATCH query from the raw query, used
    // only to compute the phrase bonus, not for the primary WHERE clause.
    const normalizedPhrase = normalizeFrenchMedical(rawQuery).trim();
    const phraseQuery =
      normalizedPhrase.split(" ").length > 1
        ? `"${normalizedPhrase.replace(/"/g, '""')}"`
        : null;

    const sql = buildSearchSql();
    const stmt = this.db.prepare(sql);
    const rows = stmt.all({
      ftsQuery: expansion.ftsQuery,
      phraseQuery,
      phraseBoost,
    }) as any[];

    const results: SearchResult[] = rows.map((r) => ({
      docId: r.doc_id,
      title: r.title,
      section: r.section,
      body: r.body,
      bm25Cost: r.bm25_cost,
      phraseBonus: r.phrase_bonus,
      finalScore: r.final_score,
    }));

    return { expansion, results };
  }

  close(): void {
    this.db.close();
  }
}
