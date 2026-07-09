# Vérification d’attribution — réponse IC-FEr

## 1. Découpage et classification des affirmations

### A1 — « Le traitement de l’IC-FEr repose sur quatre piliers : IEC ou ARNI, bêtabloquants, […] antagonistes des récepteurs minéralocorticoïdes et iSGLT2. »
- **Statut :** **[SOURCÉ]** — [C1]
- **Justification :** [C1] indique explicitement que le traitement repose sur quatre classes : IEC (ou ARNI), bêtabloquants, antagonistes des récepteurs minéralocorticoïdes, et inhibiteurs de SGLT2. « Quatre piliers » / « iSGLT2 » est une reformulation fidèle de « quatre classes » / « inhibiteurs de SGLT2 ».

### A2 — « bêtabloquants (par exemple bisoprolol […]) »
- **Statut :** **[SOURCÉ]** — [C2]
- **Justification :** [C2] liste le bisoprolol parmi les bêtabloquants ayant l’AMM dans l’IC-FEr (avec carvédilol, métoprolol succinate, nébivolol). L’exemple « bisoprolol » est donc directement soutenu.

### A3 — « à débuter à 1,25 mg/j »
- **Statut :** **[NON SOUTENU]**
- **Justification :** [C2] précise seulement que « l’introduction se fait à faible dose avec titration progressive », sans aucune posologie chiffrée (ni 1,25 mg/j, ni autre dose). La valeur 1,25 mg/j est absente des chunks — même si elle est cliniquement courante pour le bisoprolol, elle constitue ici une hallucination au regard des sources récupérées.
- **Note d’inférence possible (non retenue pour la posologie) :** on pourrait inférer « début à faible dose » à partir de [C2], mais **pas** la dose précise 1,25 mg/j.

### A4 — « La FEVG seuil est ≤ 40 %. »
- **Statut :** **[SOURCÉ]** — [C1]
- **Justification :** [C1] définit l’IC-FEr par une FEVG ≤ 40 %.

### A5 — « L’ivabradine est indiquée en première intention si la FC reste > 70/min. »
- **Statut :** **[NON SOUTENU]**
- **Justification :** Aucun des chunks [C1], [C2], [C3] ne mentionne l’ivabradine, la fréquence cardiaque, le seuil 70/min, ni une place en première intention. Affirmation absente des sources (et potentiellement inexacte par rapport aux schémas thérapeutiques usuels, mais le critère retenu ici est uniquement l’ancrage dans les chunks).

### A6 — « La vaccination antigrippale est recommandée »
- **Statut :** **[SOURCÉ]** — [C3]
- **Justification :** [C3] : « La vaccination antigrippale annuelle est recommandée chez les patients insuffisants cardiaques. » Le caractère « annuel » n’est pas repris dans la réponse générée, mais la recommandation elle-même est explicitement soutenue.

### A7 — « de même que la vaccination antipneumococcique »
- **Statut :** **[NON SOUTENU]**
- **Justification :** [C3] ne parle que de la vaccination antigrippale. Aucune mention de vaccination antipneumococcique dans les chunks. L’association « de même que » étend indûment une recommandation non présente dans les sources.

### A8 — « Une restriction hydrique stricte à moins d’un litre par jour est systématique. »
- **Statut :** **[NON SOUTENU]**
- **Justification :** Aucune information sur la restriction hydrique, un seuil de 1 L/j, ou le caractère « systématique » dans [C1]–[C3]. Affirmation absente des sources.

---

## 2. Synthèse des attributions

| # | Affirmation (résumée) | Attribution | Chunk(s) |
|---|------------------------|-------------|----------|
| A1 | 4 classes/piliers thérapeutiques (IEC/ARNI, BB, ARM, iSGLT2) | **[SOURCÉ]** | C1 |
| A2 | Exemple de BB : bisoprolol | **[SOURCÉ]** | C2 |
| A3 | Dose initiale bisoprolol 1,25 mg/j | **[NON SOUTENU]** | — |
| A4 | FEVG ≤ 40 % pour IC-FEr | **[SOURCÉ]** | C1 |
| A5 | Ivabradine 1ʳᵉ intention si FC > 70/min | **[NON SOUTENU]** | — |
| A6 | Vaccination antigrippale recommandée | **[SOURCÉ]** | C3 |
| A7 | Vaccination antipneumococcique recommandée | **[NON SOUTENU]** | — |
| A8 | Restriction hydrique stricte < 1 L/j systématique | **[NON SOUTENU]** | — |

**Éléments [INFÉRÉ] :** aucun élément retenu comme purement inféré dans la réponse telle quelle. La seule inférence raisonnable non explicitée serait « démarrer le bisoprolol à faible dose avec titration » ([C2]), mais la réponse va au-delà en inventant une posologie chiffrée.

---

## 3. Verdict global

**Non publiable telle quelle.**

La réponse mêle correctement plusieurs faits ancrés dans les chunks (définition FEVG ≤ 40 %, quadrithérapie, bisoprolol comme BB d’AMM, vaccination antigrippale) à **quatre affirmations non soutenues** (posologie 1,25 mg/j ; ivabradine en 1ʳᵉ intention si FC > 70 ; vaccination antipneumococcique ; restriction hydrique stricte systématique < 1 L/j). Ces ajouts constituent des **hallucinations au regard des sources récupérées** et rendent la réponse non fiable pour publication sans correction.

---

## 4. Réécriture (uniquement [SOURCÉ] / inférences strictement justifiées)

**Version corrigée publiable :**

« L’insuffisance cardiaque à fraction d’éjection réduite (IC-FEr) est définie par une FEVG ≤ 40 %. Son traitement repose sur quatre classes : IEC (ou ARNI), bêtabloquants, antagonistes des récepteurs minéralocorticoïdes et inhibiteurs de SGLT2. Parmi les bêtabloquants ayant l’AMM dans l’IC-FEr figurent notamment le bisoprolol, le carvédilol, le métoprolol succinate et le nébivolol ; l’introduction se fait à faible dose avec titration progressive. La vaccination antigrippale annuelle est recommandée chez les patients insuffisants cardiaques. »

**Éléments volontairement retirés (non soutenus par les chunks) :**
- posologie chiffrée du bisoprolol (1,25 mg/j) ;
- ivabradine / FC > 70/min / « première intention » ;
- vaccination antipneumococcique ;
- restriction hydrique stricte < 1 L/j « systématique ».

**Ancrage de la réécriture :**
- Définition FEVG ≤ 40 % et quadrithérapie → [C1]
- Liste des BB d’AMM + faible dose / titration → [C2]
- Vaccination antigrippale annuelle → [C3]
