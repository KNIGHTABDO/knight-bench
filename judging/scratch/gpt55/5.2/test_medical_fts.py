from __future__ import annotations

import unittest

from medical_fts import (
    ABBREVIATION_EXPANSIONS,
    Document,
    MedicalFtsSearch,
    build_query,
    normalize_medical_french,
)


class MedicalFtsSearchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = MedicalFtsSearch()
        self.engine.add_documents(
            [
                Document(
                    1,
                    "Œdème aigu du poumon",
                    "Urgences",
                    "Patient avec dyspnée brutale et crépitants.",
                ),
                Document(
                    2,
                    "Oedeme périphérique",
                    "Médecine interne",
                    "Gonflement chronique des membres inférieurs.",
                ),
                Document(
                    3,
                    "Infarctus du myocarde",
                    "Cardiologie",
                    "Douleur thoracique prolongée compatible avec IDM.",
                ),
                Document(
                    4,
                    "Bronchopneumopathie chronique obstructive",
                    "Pneumologie",
                    "Exacerbation de BPCO avec sibilants.",
                ),
                Document(
                    5,
                    "Accident vasculaire cérébral",
                    "Neurologie",
                    "Déficit neurologique focal brutal.",
                ),
                Document(
                    6,
                    "Insuffisance rénale chronique",
                    "Néphrologie",
                    "IRC stade 4 avec clairance basse.",
                ),
                Document(
                    7,
                    "Insuffisance respiratoire chronique",
                    "Pneumologie",
                    "IRC sur BPCO évoluée avec hypoxémie.",
                ),
                Document(
                    8,
                    "Hypertension artérielle",
                    "Cardiologie",
                    "HTA essentielle traitée par IEC.",
                ),
                Document(
                    9,
                    "Fibrillation atriale",
                    "Rythmologie",
                    "FA rapide sous anticoagulation.",
                ),
                Document(
                    10,
                    "Embolie pulmonaire",
                    "Urgences",
                    "EP probable avec douleur thoracique et dyspnée.",
                ),
                Document(
                    11,
                    "Épanchement pleural",
                    "Pneumologie",
                    "EP liquidien gauche à ponctionner.",
                ),
                Document(
                    12,
                    "Syndrome coronarien aigu",
                    "Cardiologie",
                    "SCA sans sus-décalage du segment ST.",
                ),
                Document(
                    13,
                    "Maladie thromboembolique veineuse",
                    "Vasculaire",
                    "MTEV avec thrombose veineuse profonde.",
                ),
                Document(
                    14,
                    "Cas général de douleur thoracique",
                    "Urgences",
                    "Le dossier mentionne douleur thoracique, douleur thoracique, douleur thoracique, mais pas infarctus du myocarde.",
                ),
                Document(
                    15,
                    "Formulation exacte",
                    "Cardiologie",
                    "Suspicion clinique d'infarctus du myocarde chez un patient diabétique.",
                ),
            ]
        )

    def result_ids(self, query: str) -> list[int]:
        return [result.id for result in self.engine.search(query, limit=20)]

    def test_normalizer_folds_accents_and_ligatures(self) -> None:
        self.assertEqual(normalize_medical_french("œdème"), "oedeme")
        self.assertEqual(normalize_medical_french("oedème"), "oedeme")
        self.assertEqual(normalize_medical_french("ŒDÈME"), "oedeme")
        self.assertEqual(normalize_medical_french("ætiologie"), "aetiologie")

    def test_ligature_query_matches_ascii_oedeme_document(self) -> None:
        self.assertIn(2, self.result_ids("œdème"))

    def test_ascii_query_matches_ligature_document(self) -> None:
        self.assertIn(1, self.result_ids("oedeme"))

    def test_accented_query_matches_unaccented_document(self) -> None:
        self.assertIn(2, self.result_ids("oedème périphérique"))

    def test_idm_expands_to_infarctus_du_myocarde(self) -> None:
        self.assertIn(3, self.result_ids("IDM"))

    def test_bpco_expands_to_long_form(self) -> None:
        self.assertIn(4, self.result_ids("BPCO"))

    def test_multiple_required_terms_with_abbreviation_expansion(self) -> None:
        ids = self.result_ids("BPCO exacerbation")
        self.assertIn(4, ids)
        self.assertNotIn(7, ids)

    def test_ambiguous_irc_expands_to_both_meanings(self) -> None:
        ids = self.result_ids("IRC")
        self.assertIn(6, ids)
        self.assertIn(7, ids)
        self.assertEqual(
            ABBREVIATION_EXPANSIONS["IRC"],
            (
                "insuffisance rénale chronique",
                "insuffisance respiratoire chronique",
            ),
        )

    def test_ambiguous_ep_expands_to_both_meanings(self) -> None:
        ids = self.result_ids("EP")
        self.assertIn(10, ids)
        self.assertIn(11, ids)

    def test_phrase_boost_changes_ranking(self) -> None:
        without_boost = self.engine.search(
            "infarctus du myocarde",
            limit=5,
            exact_phrase_boost=0.0,
        )
        with_boost = self.engine.search(
            "infarctus du myocarde",
            limit=5,
            exact_phrase_boost=3.0,
        )

        self.assertEqual(with_boost[0].id, 15)
        self.assertTrue(with_boost[0].exact_phrase_match)
        self.assertNotEqual([r.id for r in without_boost], [r.id for r in with_boost])

    def test_query_builder_contains_or_group_for_ambiguous_abbreviation(self) -> None:
        built = build_query("IRC")
        self.assertIn('"irc"', built.match_query)
        self.assertIn('"insuffisance renale chronique"', built.match_query)
        self.assertIn('"insuffisance respiratoire chronique"', built.match_query)
        self.assertIn(" OR ", built.match_query)

    def test_column_weights_allow_title_match_to_outrank_body_only_match(self) -> None:
        self.engine.add_documents(
            [
                Document(
                    101,
                    "Titre non pertinent",
                    "Divers",
                    "hypertension arterielle hypertension arterielle",
                ),
                Document(
                    102,
                    "Hypertension artérielle",
                    "Divers",
                    "mention courte",
                ),
            ]
        )
        results = self.engine.search("hypertension artérielle", limit=20)
        ordered_ids = [result.id for result in results]
        self.assertLess(ordered_ids.index(102), ordered_ids.index(101))


if __name__ == "__main__":
    unittest.main()
