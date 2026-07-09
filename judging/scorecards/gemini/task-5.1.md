SCORE: 8 (FINAL)
AUTO_CHECKS: 4/4, failures: none
BAND_JUSTIFICATION:
The selected band is based on the official rubric and the mechanical evidence for task 5.1. Meets all scripted checks with a clear two-hop FTS5/BM25 design, worked SQL, and failure modes; less deep on French-specific lexicon and measurable stopping criteria than the best answers.
Direct output evidence includes: "CREATE VIRTUAL TABLE chunks_fts USING fts5(". It also says: "A single-shot BM25 search fails on questions like: *"Quelle est la prise en charge de la complication la plus fréquente de la maladie X ?"* because the target ("prise en…". A further relevant quote is: "A[User Query: Maladie X + Complication + aspect] --> B[Hop 1: Identify Maladie X & 'complication']".
The saved mechanical evidence reports 4/4 checks passed, so the score does not reward unverified polish over working constraints.
This score is final because the task is in the script/rubric-sufficient set.
UNVERIFIED_CLAIMS: none beyond claims not testable from task materials
RED_FLAGS: none
