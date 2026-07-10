SCORE: 8 (FINAL)
AUTO_CHECKS: 4/4, failures: none
BAND_JUSTIFICATION: The answer delivers a sound 7-8 pipeline: external-content FTS5, `bm25(chunks_fts, ...)`, structural hop-1 signals, deterministic candidate extraction, filtered hops, failure modes, and measurable stopping criteria. It explicitly keeps the system within `SQLite FTS5 with BM25 only` and discusses accents and abbreviation expansion. It does not reach 9-10 because the reranking story remains largely deterministic boosts rather than a separately validated reranker with a budgeted evaluation. The verifier's initial embedding flag was corrected as a phrase-matching false positive.
UNVERIFIED_CLAIMS: Measured latency and retrieval quality on the stated 40,000-chunk corpus.
RED_FLAGS: none
