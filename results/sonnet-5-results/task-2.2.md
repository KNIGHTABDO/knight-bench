# Cas clinique : patiente de 78 ans, 60 kg, embolie pulmonaire non grave, créatininémie 130 µmol/L

## Q1. Calcul de la clairance de la créatinine (formule de Cockcroft et Gault)

**Formule (unités SI, créatininémie en µmol/L) :**

ClCr (mL/min) = [(140 − âge) × Poids(kg) × k] / Créatininémie (µmol/L)

avec k = 1,23 pour un homme et k = 1,04 pour une femme.

*Remarque d'incertitude : le coefficient k (1,04 pour la femme) est une constante conventionnelle propre à la version « SI » de la formule de Cockcroft-Gault ; certaines sources utilisent la formule historique en mg/dL avec un facteur ×0,85 pour les femmes appliqué à la formule masculine. Les deux variantes donnent un résultat très proche mais pas rigoureusement identique. Je précise donc la version utilisée.*

**Application, étape par étape :**

1. (140 − âge) = 140 − 78 ans = 62 (sans unité, résultat en années soustraites)
2. 62 × Poids = 62 × 60 kg = 3 720 (kg, facteur intermédiaire)
3. 3 720 × k(femme) = 3 720 × 1,04 = 3 868,8 (facteur intermédiaire, sans unité propre)
4. ClCr = 3 868,8 / 130 µmol/L = 29,7692... mL/min

**Résultat arrondi à une décimale :**

**ClCr ≈ 29,8 mL/min**

## Q2. Interprétation du résultat (stade d'insuffisance rénale)

Classification KDIGO du débit de filtration glomérulaire (utilisée par extension avec la clairance estimée) :
- Stade 1 : ≥ 90 mL/min (normal ou augmenté)
- Stade 2 : 60-89 mL/min (légèrement diminué)
- Stade 3a : 45-59 mL/min (légèrement à modérément diminué)
- Stade 3b : 30-44 mL/min (modérément à sévèrement diminué)
- Stade 4 : 15-29 mL/min (sévèrement diminué)
- Stade 5 : < 15 mL/min (insuffisance rénale terminale)

Avec ClCr = 29,8 mL/min, la patiente se situe **à la limite entre le stade 3b (30-44 mL/min) et le stade 4 (15-29 mL/min)**. La valeur calculée (29,8) est très légèrement inférieure à 30, ce qui la classe formellement en **insuffisance rénale sévère (stade 4)**, mais elle est si proche du seuil de 30 mL/min qu'elle doit être interprétée avec prudence (incertitude de mesure de la créatininémie, variabilité de la formule, éventuelle sarcopénie chez une patiente âgée qui peut faire surestimer la fonction rénale réelle par Cockcroft-Gault).

*Signal d'incertitude : chez le sujet âgé, la formule de Cockcroft-Gault est connue pour être moins fiable (masse musculaire réduite pouvant surestimer la clairance réelle) ; le CKD-EPI serait théoriquement plus précis, mais c'est bien Cockcroft-Gault qui reste la référence réglementaire pour l'adaptation posologique des anticoagulants en France.*

## Q3. Utilisation d'une HBPM à dose curative (ex : énoxaparine) chez cette patiente

**Seuil applicable :** les HBPM à dose curative (énoxaparine 100 UI/kg x2/j ou équivalent) sont **contre-indiquées lorsque la clairance de la créatinine (Cockcroft-Gault) est < 30 mL/min**, en raison du risque d'accumulation et de surdosage (élimination rénale des HBPM), avec majoration du risque hémorragique.

Ici, ClCr ≈ 29,8 mL/min, soit une valeur **inférieure au seuil de 30 mL/min** (bien que très proche de celui-ci).

**Conclusion :** l'énoxaparine à dose curative n'est donc **pas recommandée / contre-indiquée** chez cette patiente selon le seuil habituel.

*Signal d'incertitude : la valeur (29,8) étant à moins de 1 mL/min du seuil de 30, une réévaluation de la créatininémie (recontrôle, éventuellement dosage par une méthode plus précise, ou calcul avec CKD-EPI/MDRD pour comparaison) est raisonnable avant de trancher définitivement, car une petite variation analytique pourrait faire basculer la patiente au-dessus du seuil.*

**Alternative proposée :** **héparine non fractionnée (HNF)**, par voie intraveineuse continue (à la seringue électrique), qui :
- n'est pas éliminée par le rein (métabolisme non rénal principalement) ;
- est utilisable quelle que soit la fonction rénale ;
- permet une adaptation posologique fine et rapide grâce à sa demi-vie courte ;
- dispose d'un antidote (sulfate de protamine) en cas de besoin.

Dose usuelle : bolus initial puis perfusion continue adaptée au poids, avec ajustement selon la surveillance biologique (voir Q4).

## Q4. Surveillance biologique spécifique de l'anticoagulant retenu (HNF)

Pour l'héparine non fractionnée en perfusion IV continue :

1. **TCA (temps de céphaline activée)** : premier contrôle 4 à 6 heures après le début de la perfusion (ou après tout changement de dose), puis à chaque adaptation, avec un objectif habituel de **1,5 à 2,5 à 3 fois le témoin** selon les laboratoires (le seuil exact dépend du réactif utilisé localement — à vérifier auprès du laboratoire).
2. **Activité anti-Xa** (alternative ou complément au TCA, notamment si TCA ininterprétable) : objectif cible habituel **0,3 à 0,7 UI/mL** pour une héparinothérapie curative.
3. **Numération plaquettaire (NFS/plaquettes)** : avant le début du traitement, puis 2 fois par semaine, à la recherche d'une **thrombopénie induite par l'héparine (TIH)**, qui peut survenir entre le 5e et le 21e jour de traitement.
4. **Ionogramme sanguin (kaliémie)** : surveillance du risque d'**hyperkaliémie induite par l'héparine** (inhibition de la sécrétion d'aldostérone), particulièrement pertinent ici compte tenu de l'insuffisance rénale associée.
5. **Surveillance rapprochée de la fonction rénale (créatininémie)** : pour réévaluer régulièrement la clairance et adapter la stratégie anticoagulante si la fonction rénale évolue.

*Signal d'incertitude : les bornes cibles exactes du TCA (rapport au témoin) et de l'anti-Xa peuvent varier légèrement selon les protocoles institutionnels et les réactifs de laboratoire ; il convient de se référer au protocole local.*
