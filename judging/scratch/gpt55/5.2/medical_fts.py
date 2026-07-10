from __future__ import annotations

import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from typing import Iterable, Sequence


ABBREVIATION_EXPANSIONS: dict[str, tuple[str, ...]] = {
    "IDM": ("infarctus du myocarde",),
    "BPCO": (
        "bronchopneumopathie chronique obstructive",
        "broncho pneumopathie chronique obstructive",
    ),
    "AVC": ("accident vasculaire cérébral",),
    "HTA": ("hypertension artérielle",),
    "IRC": (
        "insuffisance rénale chronique",
        "insuffisance respiratoire chronique",
    ),
    "FA": (
        "fibrillation auriculaire",
        "fibrillation atriale",
    ),
    "EP": (
        "embolie pulmonaire",
        "épanchement pleural",
    ),
    "SCA": ("syndrome coronarien aigu",),
    "OAP": (
        "oedème aigu du poumon",
        "œdème aigu du poumon",
    ),
    "MTEV": (
        "maladie thromboembolique veineuse",
        "maladie thrombo-embolique veineuse",
    ),
}

TOKEN_RE = re.compile(r"[\w]+", re.UNICODE)
FTS_SPECIAL_CHARS_RE = re.compile(r'(["\\])')


@dataclass(frozen=True)
class Document:
    id: int
    title: str
    section: str
    body: str


@dataclass(frozen=True)
class SearchResult:
    id: int
    title: str
    section: str
    body: str
    bm25: float
    exact_phrase_match: bool
    score: float


@dataclass(frozen=True)
class BuiltQuery:
    match_query: str
    exact_phrase_query: str | None
    normalized_query: str


def normalize_medical_french(text: str) -> str:
    """Normalize French medical text for FTS matching.

    SQLite unicode61 handles many diacritics, but not all useful compatibility
    forms. We expand ligatures explicitly, then strip combining marks.
    """

    ligature_folded = (
        text.replace("œ", "oe")
        .replace("Œ", "oe")
        .replace("æ", "ae")
        .replace("Æ", "ae")
    )
    decomposed = unicodedata.normalize("NFKD", ligature_folded)
    without_marks = "".join(
        char for char in decomposed if unicodedata.category(char) != "Mn"
    )
    return without_marks.casefold()


def tokenize_query(text: str) -> list[str]:
    return TOKEN_RE.findall(normalize_medical_french(text))


def quote_fts_phrase(text: str) -> str:
    normalized = normalize_medical_french(text)
    phrase = " ".join(TOKEN_RE.findall(normalized))
    escaped = FTS_SPECIAL_CHARS_RE.sub(r"\\\1", phrase)
    return f'"{escaped}"'


def quote_fts_token(token: str) -> str:
    normalized_tokens = TOKEN_RE.findall(normalize_medical_french(token))
    if not normalized_tokens:
        raise ValueError(f"Cannot build an FTS token from {token!r}")
    escaped = FTS_SPECIAL_CHARS_RE.sub(r"\\\1", normalized_tokens[0])
    return f'"{escaped}"'


def build_query(user_query: str) -> BuiltQuery:
    """Build an FTS5 MATCH expression with abbreviation expansion.

    Each abbreviation token becomes an OR group containing the literal token and
    all configured expansions as quoted phrases. Non-abbreviation terms are kept
    as required terms by joining groups with AND.
    """

    tokens = tokenize_query(user_query)
    if not tokens:
        raise ValueError("Search query must contain at least one searchable token")

    groups: list[str] = []
    for token in tokens:
        upper_token = token.upper()
        expansions = ABBREVIATION_EXPANSIONS.get(upper_token)
        if expansions:
            alternatives = [quote_fts_token(token)]
            alternatives.extend(quote_fts_phrase(expansion) for expansion in expansions)
            groups.append("(" + " OR ".join(alternatives) + ")")
        else:
            groups.append(quote_fts_token(token))

    normalized_query = " ".join(tokens)
    exact_phrase_query = quote_fts_phrase(user_query) if len(tokens) > 1 else None
    return BuiltQuery(
        match_query=" AND ".join(groups),
        exact_phrase_query=exact_phrase_query,
        normalized_query=normalized_query,
    )


class MedicalFtsSearch:
    """SQLite FTS5 search for French medical text."""

    def __init__(self, connection: sqlite3.Connection | None = None) -> None:
        self.connection = connection or sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        self._create_schema()

    def _create_schema(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                section TEXT NOT NULL,
                body TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                title,
                section,
                body,
                content='documents',
                content_rowid='id',
                tokenize = 'unicode61 remove_diacritics 2'
            );
            """
        )

    def add_documents(self, documents: Iterable[Document]) -> None:
        rows = list(documents)
        with self.connection:
            self.connection.executemany(
                """
                INSERT INTO documents(id, title, section, body)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    section = excluded.section,
                    body = excluded.body
                """,
                [(doc.id, doc.title, doc.section, doc.body) for doc in rows],
            )
            self.connection.executemany(
                "DELETE FROM documents_fts WHERE rowid = ?",
                [(doc.id,) for doc in rows],
            )
            self.connection.executemany(
                """
                INSERT INTO documents_fts(rowid, title, section, body)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (
                        doc.id,
                        normalize_medical_french(doc.title),
                        normalize_medical_french(doc.section),
                        normalize_medical_french(doc.body),
                    )
                    for doc in rows
                ],
            )

    def search(
        self,
        user_query: str,
        *,
        limit: int = 10,
        exact_phrase_boost: float = 3.0,
    ) -> list[SearchResult]:
        built = build_query(user_query)
        exact_phrase_sql = self._exact_phrase_sql(built.exact_phrase_query)
        sql = f"""
            SELECT
                d.id,
                d.title,
                d.section,
                d.body,
                bm25(documents_fts, 3.0, 2.0, 1.0) AS bm25_score,
                {exact_phrase_sql} AS exact_phrase_match
            FROM documents_fts
            JOIN documents AS d ON d.id = documents_fts.rowid
            WHERE documents_fts MATCH ?
            ORDER BY (-bm25_score + (? * exact_phrase_match)) DESC, d.id ASC
            LIMIT ?
        """
        rows = self.connection.execute(
            sql,
            (built.match_query, exact_phrase_boost, limit),
        ).fetchall()
        return [
            SearchResult(
                id=row["id"],
                title=row["title"],
                section=row["section"],
                body=row["body"],
                bm25=float(row["bm25_score"]),
                exact_phrase_match=bool(row["exact_phrase_match"]),
                score=-float(row["bm25_score"])
                + exact_phrase_boost * int(row["exact_phrase_match"]),
            )
            for row in rows
        ]

    def _exact_phrase_sql(self, exact_phrase_query: str | None) -> str:
        if exact_phrase_query is None:
            return "0"
        escaped_query = exact_phrase_query.replace("'", "''")
        return (
            "EXISTS ("
            "SELECT 1 FROM documents_fts AS phrase_fts "
            "WHERE phrase_fts.rowid = documents_fts.rowid "
            f"AND phrase_fts MATCH '{escaped_query}'"
            ")"
        )


if __name__ == "__main__":
    engine = MedicalFtsSearch()
    engine.add_documents(
        [
            Document(
                1,
                "Oedème aigu du poumon",
                "Urgences cardiologiques",
                "Dyspnée brutale avec crépitants diffus.",
            ),
            Document(
                2,
                "Infarctus du myocarde",
                "Cardiologie",
                "Douleur thoracique avec sus-décalage du segment ST.",
            ),
        ]
    )
    for result in engine.search("œdème aigu"):
        print(result)
