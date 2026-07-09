import sqlite3
import unicodedata
import re
from typing import List, Dict, Tuple

LIGATURE_MAP = {"œ":"oe","Œ":"oe","æ":"ae","Æ":"ae","ß":"ss","ø":"o","Ø":"o"}

MEDICAL_ABBREVIATIONS: Dict[str, List[str]] = {
  "IDM": ["infarctus du myocarde"],
  "BPCO": ["bronchopneumopathie chronique obstructive"],
  "AVC": ["accident vasculaire cerebral"],
  "HTA": ["hypertension arterielle"],
  "IRC": ["insuffisance renale chronique", "insuffisance respiratoire chronique"],
  "FA": ["fibrillation atriale", "fibrillation auriculaire", "fosfatase alcaline"],
  "EP": ["embolie pulmonaire", "epanchement pleural"],
  "SCA": ["syndrome coronarien aigu", "syndrome thoracique aigu"],
  "OAP": ["oedeme aigu du poumon", "oedeme aigu pulmonaire"],
  "MTEV": ["maladie thromboembolique veineuse"],
}

def normalize_french(text: str) -> str:
    if not text: return ""
    text = text.lower()
    for lig,repl in LIGATURE_MAP.items():
        text = text.replace(lig.lower(), repl)
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c)!="Mn")
    text = re.sub(r"[^a-z0-9\s]"," ",text)
    return re.sub(r"\s+"," ",text).strip()

def tokenize_raw(text: str) -> List[str]:
    return re.findall(r"\b\w+\b", text, flags=re.UNICODE)

FTS5_TABLE_DDL_INTENDED = """
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
    title, section, body,
    tokenize='unicode61 "remove_diacritics 2"'
);
"""
FTS5_TABLE_DDL_FALLBACK = """
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
    title, section, body,
    tokenize='unicode61'
);
"""

class FrenchMedicalSearch:
    def __init__(self, db_path=":memory:"):
        self.conn = sqlite3.connect(db_path)
        try:
            self.conn.execute(FTS5_TABLE_DDL_INTENDED)
        except sqlite3.OperationalError:
            self.conn.execute(FTS5_TABLE_DDL_FALLBACK)
        self.conn.execute("CREATE TABLE IF NOT EXISTS docs_meta(rowid INTEGER PRIMARY KEY, orig_title TEXT, orig_section TEXT, orig_body TEXT)")
        self.conn.commit()

    def add_document(self, title: str, section: str, body: str) -> int:
        nt, ns, nb = normalize_french(title), normalize_french(section), normalize_french(body)
        cur=self.conn.cursor()
        cur.execute("INSERT INTO docs_fts(title,section,body) VALUES (?,?,?)",(nt,ns,nb))
        rowid=cur.lastrowid
        cur.execute("INSERT INTO docs_meta VALUES (?,?,?,?)",(rowid,title,section,body))
        self.conn.commit()
        return rowid

    def _build_expanded_query(self, raw_query: str) -> Tuple[str,List[str],str]:
        norm_phrase=normalize_french(raw_query)
        raw_tokens=tokenize_raw(raw_query)
        parts=[]; expansions=[]
        for rt in raw_tokens:
            nt=normalize_french(rt)
            if not nt: continue
            key=rt.upper()
            if key in MEDICAL_ABBREVIATIONS:
                exps=MEDICAL_ABBREVIATIONS[key]
                expansions.extend(exps)
                group=[nt]
                group+=[f'"{normalize_french(e)}"' if " " in normalize_french(e) else normalize_french(e) for e in exps]
                uniq=list(dict.fromkeys(group))
                parts.append(f'({" OR ".join(uniq)})')
            else:
                parts.append(nt)
        return (" AND ".join(parts), expansions, norm_phrase)

    def search(self, raw_query: str, phrase_boost: float=10.0, limit: int=10):
        expanded_q, expansions, norm_phrase = self._build_expanded_query(raw_query)
        if not expanded_q: return []
        cur=self.conn.cursor()
        sql="SELECT rowid,title,section,body,bm25(docs_fts,3.0,2.0,1.0) FROM docs_fts WHERE docs_fts MATCH ? ORDER BY bm25(docs_fts,3.0,2.0,1.0) LIMIT ?"
        try:
            rows=cur.execute(sql,(expanded_q,limit*3)).fetchall()
        except sqlite3.OperationalError:
            rows=cur.execute(sql,(norm_phrase,limit*3)).fetchall()
        if not rows: return []
        phrase_matches=set()
        cands=[f'"{norm_phrase}"']+[f'"{normalize_french(e)}"' for e in expansions if " " in normalize_french(e)]
        for pq in cands:
            try:
                for r in cur.execute("SELECT rowid FROM docs_fts WHERE docs_fts MATCH ? LIMIT 100",(pq,)):
                    phrase_matches.add(r[0])
            except: continue
        scored=[]
        for rowid,t,s,b,br in rows:
            meta=cur.execute("SELECT orig_title,orig_section,orig_body FROM docs_meta WHERE rowid=?",(rowid,)).fetchone()
            scored.append({"rowid":rowid,"orig_title":meta[0],"orig_body":meta[2],"bm25_raw":br,"phrase_matched":rowid in phrase_matches,"final_rank":br-(phrase_boost if rowid in phrase_matches else 0),"expanded_query":expanded_q})
        scored.sort(key=lambda x:x["final_rank"])
        return scored[:limit]

