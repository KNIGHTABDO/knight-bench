"""
Test suite for French medical BM25 / SQLite FTS5 retrieval.

≥8 cases covering:
  - accent / ligature variants match
  - abbreviations expand
  - phrase boost changes ranking
  - ambiguous abbreviation produces both expansions
"""

from __future__ import annotations

import unittest

from medical_fts import (
    ABBREVIATION_TABLE,
    COLUMN_WEIGHTS,
    FTS_TOKENIZER,
    MedicalFrenchSearch,
    build_fts_query,
    demo_corpus,
    expand_ligatures,
    lookup_abbreviations,
    normalize_for_fts,
)


class TestNormalization(unittest.TestCase):
    def test_ligature_oe_expansion(self):
        self.assertEqual(expand_ligatures("œdème"), "oedème")
        self.assertEqual(expand_ligatures("Œdème"), "OEdème")
        self.assertEqual(normalize_for_fts("œdème"), "oedème")

    def test_ae_ligature(self):
        self.assertEqual(expand_ligatures("cæsium"), "caesium")


class TestAccentAndLigatureRetrieval(unittest.TestCase):
    """Cases 1–3: accent / diacritic / ligature folding."""

    def setUp(self):
        self.engine = MedicalFrenchSearch()
        self.engine.index_many(demo_corpus())

    def _ids(self, query: str) -> list[int]:
        hits, _ = self.engine.search(query)
        return [h.id for h in hits]

    def test_01_oedeme_ascii_matches_ligature_title(self):
        """Query 'oedeme' must retrieve doc titled 'Œdème aigu du poumon'."""
        ids = self._ids("oedeme")
        self.assertIn(1, ids, "œdème-indexed title should match ascii oedeme")

    def test_02_ligature_query_matches_ascii_indexed_body(self):
        """Query with œ must match body text written as 'oedème'."""
        ids = self._ids("œdème")
        self.assertIn(2, ids, "œdème query should match oedème in body/title")
        self.assertIn(1, ids)

    def test_03_all_three_variants_share_hits(self):
        """oedème / œdème / oedeme should return overlapping relevant docs."""
        a = set(self._ids("oedème"))
        b = set(self._ids("œdème"))
        c = set(self._ids("oedeme"))
        # All three must find the OAP / oedeme documents
        for s in (a, b, c):
            self.assertTrue({1, 2} & s, f"expected OAP/oedeme docs in {s}")
        # Pairwise overlap on the core oedema docs
        core = {1, 2, 3}
        self.assertTrue(a & b & core)
        self.assertTrue(b & c & core)
        self.assertTrue(a & c & core)


class TestAbbreviationExpansion(unittest.TestCase):
    """Cases 4–6: abbreviation expansion at query time."""

    def setUp(self):
        self.engine = MedicalFrenchSearch()
        self.engine.index_many(demo_corpus())

    def test_04_idm_expands_and_finds_full_form(self):
        hits, built = self.engine.search("IDM")
        self.assertIn("IDM", built.expanded_abbreviations)
        expansions = built.expanded_abbreviations["IDM"]
        self.assertTrue(
            any("infarctus" in e and "myocarde" in e for e in expansions)
        )
        ids = [h.id for h in hits]
        # Doc 4 has full form + IDM; doc 5 has acronym only
        self.assertIn(4, ids)
        self.assertIn(5, ids)
        # MATCH should OR the short form with the phrase
        self.assertIn("OR", built.match_expr)
        self.assertIn("infarctus du myocarde", built.match_expr.lower())

    def test_05_bpco_avc_hta_sca_oap_mtev_present_in_table(self):
        required = ["IDM", "BPCO", "AVC", "HTA", "IRC", "FA", "EP", "SCA", "OAP", "MTEV"]
        for abbr in required:
            self.assertIn(abbr, ABBREVIATION_TABLE)
            self.assertGreaterEqual(len(ABBREVIATION_TABLE[abbr]), 1)

        hits_bpco, b1 = self.engine.search("BPCO")
        self.assertTrue(any(h.id in (7, 13) for h in hits_bpco))
        self.assertIn("BPCO", b1.expanded_abbreviations)

        hits_avc, _ = self.engine.search("AVC")
        self.assertTrue(any(h.id == 11 for h in hits_avc))

        hits_mtev, _ = self.engine.search("MTEV")
        self.assertTrue(any(h.id in (8, 14) for h in hits_mtev))

        hits_sca, _ = self.engine.search("SCA")
        self.assertTrue(any(h.id == 10 for h in hits_sca))

    def test_06_oap_and_hta_expand_in_combined_query(self):
        hits, built = self.engine.search("OAP HTA")
        self.assertIn("OAP", built.expanded_abbreviations)
        self.assertIn("HTA", built.expanded_abbreviations)
        ids = [h.id for h in hits]
        self.assertIn(1, ids, "OAP+HTA doc should rank among results")


class TestAmbiguousAbbreviations(unittest.TestCase):
    """Case 7: ambiguous IRC / EP produce both expansions."""

    def setUp(self):
        self.engine = MedicalFrenchSearch()
        self.engine.index_many(demo_corpus())

    def test_07_irc_ambiguous_both_senses(self):
        hits, built = self.engine.search("IRC")
        self.assertIn("IRC", built.ambiguous)
        senses = built.ambiguous["IRC"]
        # Must surface BOTH renal and respiratory chronic insufficiency
        joined = " | ".join(s.lower() for s in senses)
        self.assertIn("renale", joined.replace("é", "e").replace("è", "e"))
        # Check renal sense
        self.assertTrue(
            any("renale" in _fold(s) or "rénale" in s.lower() for s in senses)
            or any("renale" in _fold(s) for s in senses)
        )
        self.assertTrue(
            any("respiratoire" in s.lower() for s in senses),
            f"expected respiratory sense in {senses}",
        )
        ids = [h.id for h in hits]
        # Doc 6 = rénale, doc 7 = respiratoire — both must match
        self.assertIn(6, ids, "insuffisance rénale chronique doc missing")
        self.assertIn(7, ids, "insuffisance respiratoire chronique doc missing")

    def test_07b_ep_ambiguous_pulmonary_embolism_and_electrophoresis(self):
        hits, built = self.engine.search("EP")
        self.assertIn("EP", built.ambiguous)
        senses = " ".join(_fold(s) for s in built.ambiguous["EP"])
        self.assertIn("embolie", senses)
        self.assertIn("electrophorese", senses)
        ids = [h.id for h in hits]
        self.assertIn(8, ids)  # embolie pulmonaire
        self.assertIn(9, ids)  # électrophorèse

    def test_07c_domain_filter_narrows_but_never_empties(self):
        renal = lookup_abbreviations("IRC", preferred_domains=["nephro"])
        phrases = [_fold(e.phrase) for e in renal]
        self.assertTrue(any("renale" in p for p in phrases))
        # Preferred domain should prefer nephro expansions; still non-empty
        self.assertGreaterEqual(len(renal), 1)

        # Unknown domain must fall back to full list (not empty)
        fallback = lookup_abbreviations("IRC", preferred_domains=["odontologie"])
        self.assertGreaterEqual(len(fallback), 2)


class TestPhraseBoostRanking(unittest.TestCase):
    """Case 8: phrase boost changes ranking."""

    def setUp(self):
        self.engine = MedicalFrenchSearch()
        self.engine.index_many(demo_corpus())

    def test_08_phrase_boost_changes_ranking(self):
        # Query expands IDM → "infarctus du myocarde"
        # Doc 4 contains the exact multi-word phrase; doc 5 only the acronym.
        # With phrase_boost > 0, doc 4 should outrank doc 5 more strongly
        # (or at least achieve a higher score than with boost=0 when both match).

        hits_boost, built = self.engine.search("IDM", phrase_boost=5.0)
        hits_flat, _ = self.engine.search("IDM", phrase_boost=0.0)

        self.assertTrue(built.phrase_terms, "expected phrase terms for IDM expansion")

        by_id_boost = {h.id: h for h in hits_boost}
        by_id_flat = {h.id: h for h in hits_flat}
        self.assertIn(4, by_id_boost)
        self.assertIn(5, by_id_boost)
        self.assertIn(4, by_id_flat)
        self.assertIn(5, by_id_flat)

        # Doc 4 has the exact expansion phrase → phrase_hits >= 1
        self.assertGreaterEqual(by_id_boost[4].phrase_hits, 1)
        # Doc 5 acronym-only → typically 0 phrase hits for the full expansion
        self.assertEqual(by_id_boost[5].phrase_hits, 0)

        # Boost increases score of the phrase-bearing document
        self.assertGreater(by_id_boost[4].score, by_id_flat[4].score)

        # Relative ranking: with strong phrase boost, phrase doc scores above acronym-only
        self.assertGreater(
            by_id_boost[4].score,
            by_id_boost[5].score,
            "phrase-bearing infarctus doc should outrank acronym-only with boost",
        )

        # Ordering of top hits should place doc 4 ahead of doc 5 when boost is on
        order_boost = [h.id for h in hits_boost if h.id in (4, 5)]
        self.assertEqual(order_boost[0], 4)


class TestQueryBuilderAndWeights(unittest.TestCase):
    """Extra structural guarantees (≥8 total with above)."""

    def test_09_column_weights_constant(self):
        self.assertEqual(COLUMN_WEIGHTS, (3.0, 2.0, 1.0))
        self.assertIn("remove_diacritics 2", FTS_TOKENIZER)
        self.assertIn("unicode61", FTS_TOKENIZER)

    def test_10_title_weight_prefers_title_match(self):
        engine = MedicalFrenchSearch()
        engine.index_many(
            [
                (1, "embolie pulmonaire", "Divers", "note sans détail"),
                (
                    2,
                    "Compte rendu anodin",
                    "Divers",
                    "long texte mentionnant une embolie pulmonaire au passage "
                    + (" blabla" * 40),
                ),
            ]
        )
        hits, _ = engine.search(
            "embolie pulmonaire",
            phrase_boost=0.0,
            column_weights=(3.0, 2.0, 1.0),
        )
        self.assertGreaterEqual(len(hits), 2)
        # Title match should rank first under title=3.0
        self.assertEqual(hits[0].id, 1)

    def test_query_builder_or_groups_and_phrases(self):
        built = build_fts_query("IDM")
        self.assertIn("OR", built.match_expr)
        self.assertTrue(any("infarctus" in p for p in built.phrase_terms))


def _fold(text: str) -> str:
    import unicodedata

    t = normalize_for_fts(text).lower()
    return "".join(
        c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn"
    )


if __name__ == "__main__":
    unittest.main(verbosity=2)
