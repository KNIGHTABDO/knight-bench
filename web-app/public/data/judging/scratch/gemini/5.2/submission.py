import sqlite3
import unicodedata
import re
import itertools
import unittest

# 1. Abbreviation Dictionary
ABBREVIATIONS = {
    "idm": ["infarctus du myocarde"],
    "bpco": ["bronchopneumopathie chronique obstructive"],
    "avc": ["accident vasculaire cerebral"],
    "hta": ["hypertension arterielle"],
    "irc": [
        "insuffisance renale chronique",
        "insuffisance respiratoire chronique"
    ],
    "fa": [
        "fibrillation auriculaire",
        "fibrillation atriale",
        "flutter auriculaire"
    ],
    "ep": [
        "embolie pulmonaire",
        "epanchement pleural"
    ],
    "sca": ["syndrome coronarien aigu"],
    "oap": ["oedeme aigu du poumon"],
    "mtev": ["maladie thromboembolique veineuse"]
}

# French Stopwords list
FRENCH_STOPWORDS = {
    "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "au", "aux",
    "par", "pour", "dans", "sur", "avec", "ce", "ces", "cette", "dans", "chez",
    "est", "sont", "a", "ont", "aussi", "qui", "que", "dont", "ou", "se", "sa",
    "son", "ses", "leur", "leurs"
}

# 2. Text Normalization Function
def normalize_text(text: str) -> str:
    if not text:
        return ""
    text = text.lower()
    # Handle common French ligatures
    text = text.replace("œ", "oe").replace("æ", "ae")
    # Normalize unicode to decompose accents
    text = unicodedata.normalize('NFKD', text)
    # Strip combining diacritical marks
    text = "".join([c for c in text if not unicodedata.combining(c)])
    return text

# 3. Tokenizer
def tokenize_string(text: str) -> list:
    normalized = normalize_text(text)
    return re.findall(r'[a-z0-9]+', normalized)

# 4. Query Builder for Abbreviation Expansion
def build_expanded_query(tokens: list) -> str:
    # Filter stopwords for the AND-group, but ensure we don't drop abbreviations
    filtered = [t for t in tokens if t not in FRENCH_STOPWORDS or t in ABBREVIATIONS]
    if not filtered:
        filtered = tokens  # Fallback to all tokens if everything got filtered
        
    parts = []
    for token in filtered:
        if token in ABBREVIATIONS:
            expansions = ABBREVIATIONS[token]
            or_terms = [token]
            for exp in expansions:
                exp_tokens = tokenize_string(exp)
                or_terms.append(f'"{ " ".join(exp_tokens) }"')
            parts.append(f"({' OR '.join(or_terms)})")
        else:
            parts.append(token)
    return " AND ".join(parts)

# 5. Query Builder for Exact Phrase Variants
def generate_phrase_variants(tokens: list) -> list:
    # We keep all tokens (including stopwords) to build the exact phrase variants
    choices = []
    for token in tokens:
        if token in ABBREVIATIONS:
            token_choices = [[token]]
            for exp in ABBREVIATIONS[token]:
                token_choices.append(tokenize_string(exp))
            choices.append(token_choices)
        else:
            choices.append([[token]])
    
    variants = []
    for prod in itertools.product(*choices):
        flattened = []
        for term_list in prod:
            flattened.extend(term_list)
        variants.append(f'"{ " ".join(flattened) }"')
    return variants

# 6. Database Operations
def init_db():
    db = sqlite3.connect(":memory:")
    cursor = db.cursor()
    # Table for original text display
    cursor.execute("""
    CREATE TABLE documents (
        id INTEGER PRIMARY KEY,
        title TEXT,
        section TEXT,
        body TEXT
    );
    """)
    # FTS5 table with normalized text for search
    cursor.execute("""
    CREATE VIRTUAL TABLE docs_fts USING fts5(
        title,
        section,
        body,
        tokenize="unicode61"
    );
    """)
    db.commit()
    return db

def add_document(db, title: str, section: str, body: str) -> int:
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO documents (title, section, body) VALUES (?, ?, ?)",
        (title, section, body)
    )
    doc_id = cursor.lastrowid
    
    # Normalize inputs for index-time diacritic folding
    norm_title = normalize_text(title)
    norm_section = normalize_text(section)
    norm_body = normalize_text(body)
    
    cursor.execute(
        "INSERT INTO docs_fts (rowid, title, section, body) VALUES (?, ?, ?, ?)",
        (doc_id, norm_title, norm_section, norm_body)
    )
    db.commit()
    return doc_id

def search(db, query_str: str, phrase_boost_weight: float = 10.0):
    tokens = tokenize_string(query_str)
    if not tokens:
        return []
    
    expanded_query = build_expanded_query(tokens)
    phrase_variants = generate_phrase_variants(tokens)
    exact_phrase_query = " OR ".join(phrase_variants)
    
    # SQL combining BM25 weights (Title=3.0, Section=2.0, Body=1.0) and Phrase Boost
    sql = """
    WITH
      exact_match AS (
        SELECT rowid, :phrase_boost AS phrase_boost
        FROM docs_fts
        WHERE docs_fts MATCH :exact_phrase_query
      ),
      main_match AS (
        SELECT rowid, bm25(docs_fts, 3.0, 2.0, 1.0) AS bm25_score
        FROM docs_fts
        WHERE docs_fts MATCH :expanded_query
      )
    SELECT d.id, d.title, d.section, d.body,
           (-m.bm25_score + COALESCE(e.phrase_boost, 0.0)) AS score,
           (CASE WHEN e.phrase_boost IS NOT NULL THEN 1 ELSE 0 END) AS matched_phrase
    FROM main_match m
    JOIN documents d ON d.id = m.rowid
    LEFT JOIN exact_match e ON e.rowid = m.rowid
    ORDER BY score DESC;
    """
    
    cursor = db.cursor()
    cursor.execute(sql, {
        "phrase_boost": phrase_boost_weight,
        "exact_phrase_query": exact_phrase_query,
        "expanded_query": expanded_query
    })
    
    results = []
    for row in cursor.fetchall():
        results.append({
            "id": row[0],
            "title": row[1],
            "section": row[2],
            "body": row[3],
            "score": row[4],
            "matched_phrase": bool(row[5])
        })
    return results

# 7. Test Suite
class TestMedicalSearch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = init_db()
        # Seed documents
        cls.doc1 = add_document(cls.db, "Traitement de l'oedème", "Urgences", "Prise en charge de l'oedème aigu du poumon.")
        cls.doc2 = add_document(cls.db, "Pathologie cardiaque", "Insuffisance", "Le patient présente un œdème aigu du poumon.")
        cls.doc3 = add_document(cls.db, "Néphrologie clinique", "Suivi", "Patient atteint d'insuffisance renale chronique.")
        cls.doc4 = add_document(cls.db, "Néphrologie clinique 2", "Suivi", "Patient atteint d'insuffisance rénale chronique.")
        cls.doc5 = add_document(cls.db, "Pneumologie clinique", "Suivi", "Insuffisance respiratoire chronique sous oxygénothérapie.")
        cls.doc6 = add_document(cls.db, "Fiches cliniques", "Cardiologie", "Le patient a un infarctus. Le myocarde est normal.")
        cls.doc7 = add_document(cls.db, "Fiches cliniques 2", "Cardiologie", "Le patient présente un infarctus du myocarde.")
        cls.doc8 = add_document(cls.db, "Hypertension artérielle", "Général", "Le suivi régulier est recommandé.")
        cls.doc9 = add_document(cls.db, "Généralités", "Suivi", "Le patient souffre d'hypertension artérielle.")
        cls.doc10 = add_document(cls.db, "Diagnostic", "accident vasculaire cerebral", "Patient hospitalisé.")
        cls.doc11 = add_document(cls.db, "Diagnostic", "Général", "Le patient présente un accident vasculaire cerebral.")

    def test_case1_direct_accent_matching(self):
        """Case 1: Query 'oedeme' (no accents/ligatures) matches both 'oedème' and 'œdème'."""
        results = search(self.db, "oedeme")
        matched_ids = {r["id"] for r in results}
        self.assertIn(self.doc1, matched_ids)
        self.assertIn(self.doc2, matched_ids)

    def test_case2_ligature_matching(self):
        """Case 2: Query with ligature 'œdème' matches 'oedème' and 'oedeme'."""
        results = search(self.db, "œdème")
        matched_ids = {r["id"] for r in results}
        self.assertIn(self.doc1, matched_ids)
        self.assertIn(self.doc2, matched_ids)

    def test_case3_accent_insensitivity(self):
        """Case 3: Query 'renale' matches 'rénale'."""
        results = search(self.db, "renale")
        matched_ids = {r["id"] for r in results}
        self.assertIn(self.doc3, matched_ids)
        self.assertIn(self.doc4, matched_ids)

    def test_case4_single_expansion(self):
        """Case 4: BPCO abbreviation expands to 'bronchopneumopathie chronique obstructive'."""
        bpco_doc = add_document(self.db, "Dossier BPCO", "Pneumo", "Le patient souffre de bronchopneumopathie chronique obstructive.")
        results = search(self.db, "BPCO")
        matched_ids = {r["id"] for r in results}
        self.assertIn(bpco_doc, matched_ids)

    def test_case5_ambiguous_expansion(self):
        """Case 5: Ambiguous abbreviation 'IRC' matches both rénale and respiratoire chronic insufficiency."""
        results = search(self.db, "IRC")
        matched_ids = {r["id"] for r in results}
        self.assertIn(self.doc3, matched_ids) # renale
        self.assertIn(self.doc4, matched_ids) # rénale
        self.assertIn(self.doc5, matched_ids) # respiratoire

    def test_case6_phrase_boost(self):
        """Case 6: Exact phrase match 'infarctus du myocarde' ranks higher than separate terms."""
        results = search(self.db, "infarctus du myocarde")
        # Both doc6 and doc7 must be in results
        matched_ids = {r["id"] for r in results}
        self.assertIn(self.doc6, matched_ids)
        self.assertIn(self.doc7, matched_ids)
        
        # Doc 7 (exact phrase) must rank higher than Doc 6 (out of order terms)
        rank_doc7 = next(i for i, r in enumerate(results) if r["id"] == self.doc7)
        rank_doc6 = next(i for i, r in enumerate(results) if r["id"] == self.doc6)
        self.assertLess(rank_doc7, rank_doc6)
        self.assertTrue(results[rank_doc7]["matched_phrase"])
        self.assertFalse(results[rank_doc6]["matched_phrase"])

    def test_case7_column_weight_title_vs_body(self):
        """Case 7: Matching term in Title (weight 3.0) ranks higher than matching in Body (weight 1.0)."""
        results = search(self.db, "HTA")
        rank_doc8 = next(i for i, r in enumerate(results) if r["id"] == self.doc8)
        rank_doc9 = next(i for i, r in enumerate(results) if r["id"] == self.doc9)
        self.assertLess(rank_doc8, rank_doc9)

    def test_case8_column_weight_section_vs_body(self):
        """Case 8: Matching term in Section (weight 2.0) ranks higher than matching in Body (weight 1.0)."""
        results = search(self.db, "AVC")
        rank_doc10 = next(i for i, r in enumerate(results) if r["id"] == self.doc10)
        rank_doc11 = next(i for i, r in enumerate(results) if r["id"] == self.doc11)
        self.assertLess(rank_doc10, rank_doc11)

if __name__ == "__main__":
    unittest.main()
