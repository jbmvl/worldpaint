# CLAUDE.md — règles de travail sur WorldPaint

Ce fichier complète `CONTRIBUTING.md`, qui reste la référence sur la structure
du projet, la frontière thème/moteur et les invariants d'architecture. Ce qui
suit est ce qu'un assistant doit savoir **en plus**.

## Vérification visuelle

Un changement qui touche l'image se regarde, et c'est à toi de le faire —
mais pas dans `demo/index.html` : c'est la démo de l'auteur, faite pour un
humain, et elle tire tuiles et `three` du réseau. Tu passes par les bancs de
`demo/lab/`, sans réseau, pilotables depuis la console ou par script :

- `demo/lab/sky.html` — ciel, soleil et brouillard seuls sur un sol plat semé
  de blocs ; `skyLab.set({ sunDeg, lookDeg, pitchDeg, weather })` dans la
  console, ou `node scripts/sky-shot.mjs <dossier> '<réglages JSON>'` pour une
  image par réglage.
- `demo/lab/crops.html` — la `CropLayer` réelle sur un champ plat traversé par
  une route sinueuse, avec une lisière entre deux cultures ;
  `cropLab.set({ crop, next, height, pitchDeg })` dans la console.

Si le chantier touche une partie du rendu qu'aucun banc ne montre, écris le
banc plutôt que d'ouvrir la démo.

Dis ce que tu as regardé (quel banc, quels réglages) et ce que tu y vois, en
termes concrets (« le lointain au sol est plus clair que la bande de ciel »),
et ce qui reste à voir dans la vraie démo, que les bancs ne remplacent pas
(relief réel, tuiles, bâti). Le jugement final sur le paysage reste celui de
l'auteur.

Ce qui se vérifie sans les yeux doit l'être aussi : `npm test`, le chargement
des modules, le nombre de tests avant et après. Rapporte ces chiffres tels
quels, sans les arrondir dans le bon sens.

## Où est la documentation

- `README.md` — ce que fait le projet, son statut, comment le lancer.
- `CONTRIBUTING.md` — la structure de `src/`, la frontière thème/moteur, et les
  **invariants d'architecture** (emprise routière, carrefour-nœud, déterminisme,
  ponts, marquage). À lire avant de toucher à la voirie.
- `docs/inventaire.md` — objet par objet : qu'est-ce qui a mis ça là. Le premier
  endroit où aller devant un élément du décor qui surprend. Glossaire en fin.
- `docs/surfaces.md` — le sol en détail : ce qui est lu, peint, laissé.
- `docs/regions.md` — les régions naturelles : comment le lieu décide du
  contenu, le dossier d'un pays, le vocabulaire fermé, et comment poser une
  ancre.
- `src/layers/CLAUDE.md` et `src/terrain/CLAUDE.md` — la carte fine de ces deux
  répertoires, et ce qu'il ne faut pas ajouter aux gros fichiers qui y vivent.

Quand un chantier rend une de ces pages fausse, c'est la page qu'on corrige —
pas un commentaire de code qui la contredit dans son coin.

## La carte du code

```
RAW DATA → INTERPRÉTATION → COMPOSITION → GÉNÉRATION → THREE.JS
```

- **interprétation** — comprendre le territoire : `core/` (tuiles, relief,
  région, profil du lieu), `terrain/surfaceClassification.js` (ce qu'une classe
  OSM dit du sol), `layers/settlement.js` (habitat, « sommes-nous en ville ? »),
  `layers/roadGraph.js` (un carrefour est un nœud).
- **composition** — décider ce qui existe et où : `layers/furniturePlacement.js`,
  `layers/furniture/`, `layers/faunaCrossing.js`.
- **génération** — fabriquer la géométrie : `layers/ribbonGeometry.js`,
  `layers/hedgeGeometry.js`, `layers/facetJitter.js` (le grain low poly du
  mobilier balayé), `layers/furnitureKit.js`, `models/`.
- **orchestration** — `worldComposer.js`, et lui seul, dit l'ordre de
  construction et qui lit quoi.

La séparation est une **direction**, pas un état acquis : beaucoup de code
décide encore et dessine dans la même fonction. On ne la force pas au passage ;
on évite seulement d'enfoncer une règle géographique de plus au milieu d'un
maillage.

## Où chercher selon le changement

| Ce qu'on veut changer | Où aller |
| --- | --- |
| une couleur, une silhouette, une palette | `themes/default.js` — jamais une couche |
| l'ordre de construction, une dépendance entre couches | `worldComposer.js` |
| du mobilier (bord de route, parcelle, carrefour, repère) | `layers/furniture/` — voir `src/layers/CLAUDE.md` |
| une forme du catalogue de mobilier | `layers/furnitureKit.js` |
| ce qui est posé et combien (listes, plafonds) | `layers/furniture/catalog.js` |
| ce qu'une classe `landuse`/`landcover` peint au sol | `terrain/surfaceClassification.js` |
| le portrait d'un pays (matrice, pierre, bâti, cultures, essences) | `core/regions.js` — voir `docs/regions.md` |
| ce qu'un mot de région signifie pour le moteur | `core/regionInterpretation.js` |
| une couche (routes, bâti, végétation, herbe…) | `src/layers/CLAUDE.md` d'abord |

## Comment on écrit

Le code, les commentaires et les tests sont **en français**.

Chaque module porte un **en-tête** qui dit sa raison d'être et les décisions
qu'on ne doit pas défaire par inadvertance ; quand tu modifies un module en
profondeur, cet en-tête fait partie du diff.

Les commentaires, eux, suivent une discipline stricte :

- commenter le **pourquoi non évident**, jamais ce que le code dit déjà ; un
  commentaire qui paraphrase la ligne suivante est du bruit ;
- une ou quelques lignes, pas un essai. Si l'explication demande un paragraphe,
  c'est souvent que le nom de la fonction ou la structure du code est à revoir ;
- **le code décrit le fonctionnement actuel, pas son histoire.** Pas d'ancienne
  implémentation, pas de « avant on faisait », pas de justification d'une
  approche abandonnée. Un commentaire qui décrit un fonctionnement révolu se
  supprime ;
- ne pas commenter chaque fonction ni chaque bloc quand le code est explicite ;
- ce qui relève de la décision d'architecture ou du contexte général va dans
  `CLAUDE.md` ou `docs/`, pas dans un fichier source.

Cette règle vaut pour ce que tu écris **et** pour ce que tu déplaces : du code
déplacé n'emporte pas avec lui ses commentaires historiques. Ne
transforme pas un chantier en réécriture de tous les commentaires, réduit-les seulement au passage si nécessaire en n'en ajoute pas nouveaux.

Un `CLAUDE.md`, un en-tête de module ou une page de `docs/` ne racontent jamais
un chantier en cours ni ne se datent (« dans ce chantier », « désormais ») :
ils décrivent l'état actuel, pour quelqu'un qui arrive dans six mois.

## Les pièges qui reviennent

- **Une couche ne lit pas une autre couche.** Elle lit ce que `worldComposer`
  lui passe, ou ce qu'une couche a explicitement publié (un index, une liste).
- **Le mobilier de rive est dans l'emprise, et c'est sa place.** Ce qui pousse
  n'y est pas. Les deux questions ne se posent pas avec la même fonction.
- **Une graine vient d'une position au sol quantifiée**, jamais d'un indice de
  boucle ni de la position de l'observateur.
- **Un plafond atteint ne doit pas arrêter le parcours** : il arrête ce qu'il
  plafonne, sinon l'ordre des tuiles décide à la place de la distance.
- **Un gros fichier n'est pas une invitation à y ajouter une ligne de plus** :
  regarder d'abord si la responsabilité a déjà son module.

## Portée d'un chantier

- Une étape à la fois, telle qu'elle a été demandée. Pas de refactor préventif,
  pas d'abstraction « pendant qu'on y est », pas de système générique tant qu'il
  n'a pas deux sites d'appel réels.
- Une valeur artistique (couleur, densité, hauteur, palette) ne se change pas au
  passage pour faire tenir un correctif. Si une correction en exige une, dis-le
  et laisse la décision à l'auteur.
- Le déterminisme spatial est un invariant dur : la même donnée doit rendre le
  même paysage. Toute graine dérive d'une position au sol quantifiée, jamais de
  l'ordre de parcours ni de la position de l'observateur.

## Ce qu'on attend en fin de tâche

Reste sobre. On évite de consommer des token inutilement.
1. ce qui a été délibérément laissé hors périmètre, et pourquoi ;
2. ce qui a été regardé sur un banc, et ce qui reste à contrôler dans la démo.
