### Q1. Clairance de la créatinine selon Cockcroft et Gault

**Formule rappelée avant application :**
Formule originale :
Clcr (mL/min) = [ (140 - âge (ans)) * poids (kg) * K_sexe ] / [ 72 * créatininémie (mg/dL) ]
- K_sexe = 0,85 si femme, 1 si homme

Conversion : créatininémie (mg/dL) = créatininémie (µmol/L) / 88,4

Formule simplifiée directement en µmol/L (équivalente) :
- Femme : Clcr (mL/min) = [ (140 - âge) * poids (kg) * 1,04 ] / créatininémie (µmol/L)
- Homme : Clcr (mL/min) = [ (140 - âge) * poids (kg) * 1,23 ] / créatininémie (µmol/L)

**Application étape par étape :**
Données : âge = 78 ans ; poids = 60 kg ; sexe = femme ; créatininémie = 130 µmol/L

1. 140 - âge = 140 ans - 78 ans = 62 ans
2. Créatininémie en mg/dL = 130 µmol/L / 88,4 (µmol/L)/(mg/dL) = 1,4706 mg/dL
3. Numérateur : (140 - âge) * poids = 62 ans * 60 kg = 3720 ans·kg
4. Dénominateur version mg/dL : 72 * créat = 72 * 1,4706 mg/dL = 105,88 mg/dL
   => Clcr homme = 3720 / 105,88 = 35,14 mL/min
5. Correction sexe femme : 35,14 mL/min * 0,85 = 29,87 mL/min

Vérification avec formule directe en µmol/L :
Clcr = 62 * 60 kg * 1,04 / 130 µmol/L = 3868,8 / 130 = 29,76 mL/min
La différence 29,76 vs 29,87 vient de l'arrondi 1,04 vs 0,85/0,814.

**Résultat arrondi à une décimale :**
**Clcr ≈ 29,8 mL/min** selon Cockcroft et Gault [29,9 mL/min si on garde 0,85 avec conversion 88,4]. Unité : mL/min.
Formule de Cockcroft est bien celle exigée par le RCP des HBPM pour la décision.

### Q2. Interprétation

Selon KDIGO / définition DFG estimé par Cockcroft pour adaptation posologique :
- G1 : ≥90 mL/min normal
- G2 : 60-89 léger
- G3a : 45-59 modéré léger
- G3b : 30-44 modéré à sévère
- **G4 : 15-29 mL/min insuffisance rénale sévère**
- G5 : <15 terminale

Ici 29,8 mL/min = **insuffisance rénale sévère, stade 4**, à la limite supérieure du stade. On note que Cockcroft sous-estime un peu chez la personne âgée dénutrie, mais est la référence réglementaire pour les HBPM. Facteurs aggravants de saignement : âge >75 ans, poids 60 kg, IR sévère.

### Q3. HBPM à dose curative utilisable ?

**Non.**

Justification : Pour l'énoxaparine (Lovenox) et la plupart des HBPM à dose curative, le RCP ANSM / FDA indique :
**Contre-indication formelle si Clcr <30 mL/min selon Cockcroft et Gault** pour les posologies curatives, en raison d'accumulation et d'augmentation majeure du risque hémorragique (demi-vie prolongée, élimination rénale).
Seuil retenu : <30 mL/min.

Ici patiente à 29,8 mL/min < seuil de 30 mL/min, donc HBPM curative non utilisable. Pour dalteparine/nadroparine, même prudence : déconseillé <30 mL/min, et si utilisé nécessite adaptation + surveillance anti-Xa. Tinzaparine a une AMM parfois jusqu'à 20 mL/min dans certains pays mais en France principe de précaution identique et hors RCP curatif standard.

**Alternative recommandée :**
**Héparine non fractionnée (HNF) à dose curative** : héparine sodique IV à la seringue électrique ou héparine calcique SC, car élimination non rénale (système réticulo-endothélial/héparinase), pas d'accumulation en IR. C'est le traitement de référence pour EP non grave chez IR sévère selon ESC/RELM-.

Schéma : HNF IVSE bolus 80 UI/kg puis 18 UI/kg/h adapté au TCA, ou SC à dose curative ajustée.

### Q4. Surveillance biologique pour l'anticoagulant retenu (HNF curative)

Si HNF retenue :

1. **Activité anticoagulante :**
   - TCA : 6 heures après début/chaque modification, puis 1x/jour. Cible TCA ratio : 2,0-3,0 fois le témoin ou selon réactif cible 1,5-2,5 (à vérifier localement). 
   - Ou **activité anti-Xa HNF** : cible curative 0,30-0,70 UI/mL (0,50-0,70 UI/mL si haut risque thrombotique), prélevée 4-6h après changement. Plus fiable si TCA faussé.

2. **Risque de TIH (thrombopénie induite à l'héparine) :**
   - Numération plaquettaire (NFS plaquettes) : de référence avant traitement (J0), puis 2 fois/semaine pendant 21 jours (ou au moins J0, J2, puis 2x/sem). En cas de chute >30% ou <100 G/L => évoquer TIH.

3. **Surveillance générale / tolérance :**
   - Hémoglobine, hématocrite, recherche de saignement occulte
   - Créatininémie / Clcr pour suivi IR, kaliémie (HNF peut augmenter K+)
   - Clinique : signes de saignement, thrombose, allergie.

Si malgré CI une HBPM curative était exceptionnellement maintenue (choix non recommandé), surveillance spécifique obligatoire : activité anti-Xa pic (4h après injection 3e dose), cible énoxaparine curative 0,6-1,0 UI/mL (certaines sources 1,0-1,2 UI/mL 2x/j) + pic résiduel avant réinjection pour détecter accumulation, + même surveillance plaquettes et Hb.
