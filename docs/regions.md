# Écrire une région naturelle

Cette page s'adresse à qui remplit `src/core/regions.js` — à la main ou en
faisant travailler un modèle. Elle ne demande pas de savoir lire le moteur.

## Ce que la couche fait

Le vectoriel dit **ce qu'il y a** au sol, le MNT **quelle forme** ça a. La
région dit **à quoi ressemble le pays** : ce qui pousse dans un bois que la
carte signale sans le décrire, ce qu'on sème dans un champ qu'elle ne nomme
pas, comment on borne une parcelle, de quoi sont faits les murs, et surtout ce
qu'il y a là où elle se tait — ce qui est le plus gros du décor dès qu'on
s'éloigne des pays bien relevés.

Un lieu, une région, un dossier. Pas de mélange, pas de transition : deux
régions voisines se distinguent en les traversant, et c'est ce qu'on veut.

## Comment le moteur choisit la région

Par l'**ancre la plus proche**. Une région ne porte pas son contour, elle porte
quelques points posés dans son épaisseur ; le découpage qui en résulte tombe à
mi-chemin entre deux ancres voisines.

Conséquences pratiques quand on écrit :

- **une région compacte se contente d'une ancre.** Un plateau, un bassin, une
  île petite ;
- **une région allongée en demande trois ou quatre** — une vallée, un littoral,
  un couloir. Sinon la voisine mord dedans sur toute sa longueur ;
- **on corrige une limite en ajoutant une ancre**, jamais en redessinant quoi
  que ce soit ;
- **un littoral collé à un massif se borne par `reachKm`.** Sans portée, ses
  ancres mangeraient le massif jusqu'à mi-chemin des siennes. Avec, la région
  n'est retenue qu'à `reachKm` d'une de ses ancres, posées serrées sur le
  rivage (une tous les 6 à 8 km pour une portée de 4,5 km), et au-delà le lieu
  garde exactement la région qu'il avait sans elle ;
- **une région trop serrée contre une voisine disparaît.** Le test le dit :
  chaque région doit se retrouver elle-même depuis sa propre ancre ;
- au-delà de 150 km de toute ancre, il n'y a **pas** de région, et le décor
  **s'éteint** : rien n'est chargé, rien n'est posé, on voit le ciel et rien
  dessous. C'est l'état normal partout où le fichier ne va pas encore, et c'est
  volontaire — un paysage tiré dans les listes par défaut ressemble à un
  paysage, donc personne ne voit qu'il est faux. Imposer une région
  (`world.setRegion`) le rallume n'importe où, et c'est ainsi qu'on travaille un
  pays avant de l'avoir ancré.

L'ordre est `[longitude, latitude]`. Inverser les deux déplace une région d'un
continent sans rien casser d'autre.

## Voir la couverture

L’atlas local `/demo/lab/regions.html` (avec `npm run demo`) montre tous les
dossiers de `REGIONS` et la couverture échantillonnée de `regionAt`, avec
les grandes villes comme repères. Les ancres sont consultables dans les fiches. Recherche et filtre par matrice permettent d’isoler une famille ;
un clic ouvre le dossier. Le fond Natural Earth est embarqué et indépendant du
moteur. Les couleurs débordent en mer comme la règle de proximité ; elles ne
constituent pas des contours officiels et ne changent aucune donnée régionale.

## Le dossier

```js
{
  id: 'anjou',
  name: 'Anjou',
  anchors: [[-0.55, 47.45], [-0.15, 47.3]],
  matrix: 'hedgerow_meadow',
  stone: 'limestone',
  building: 'light_stone_slate',
  farming: ['cereal', 'vineyard', 'maize', 'orchard'],
  trees: ['oak', 'chestnut', 'beech'],
}
```

- **`matrix`** — le paysage là où la carte se tait. **Le champ qui porte le
  plus** : en rase campagne, une scène n'est presque que ça. Choisir d'abord
  celui-là, et l'écrire en pensant à l'entre-deux — pas au morceau le plus
  remarquable du pays, mais à ce qu'on traverse entre deux villages.
- **`stone`** — la géologie dominante, c'est-à-dire la couleur de la pierre
  partout où elle se montre : la roche des fortes pentes, la dalle et
  l'éboulis, et ce qui est bâti dedans — muret de pierre sèche, mur de
  soutènement, paroi de déblai. Une seule.
- **`building`** — la palette du bâti, par sa clé `<mur>_<couverture>` dans
  `TOWN_PALETTES`. Une seule : elle donne le mur, le toit, le volet et la pente
  de toit de toutes les maisons du pays. Si aucune palette écrite ne convient,
  on en ajoute une au thème et sa clé à `BUILDING_KINDS`.
- **`farming`** — l'assolement, **du plus répandu au moins répandu**. Le rang
  est l'information : il n'y a aucun poids à écrire, et une liste dans le
  désordre fait une région couverte de vignes.
- **`trees`** — deux à quatre essences dominantes, **de la plus répandue à la
  moins répandue**. Comme pour `farming`, le rang donne les parts : chaque
  maille de bois de 420 m est dominée par une essence tirée selon ces parts, et
  les autres y font des bosquets. Les arbres plantés (alignements, parcs,
  bourgs, crêtes) tirent leur essence dans la même liste, aux mêmes parts.
- **`sparse`** — facultatif : ce que la carte relève mal dans ce pays, **mesuré**
  et non supposé. Seul mot admis : `buildings`. Il autorise
  `layers/buildingInfill.js` à semer des maisons dans les rues habitées où OSM
  ne relève aucun bâtiment. Mesure : carrés de 1 km² tirés au hasard dans le
  pays, ceux de 5 à 400 bâtiments retenus, part d'OSM parmi les bâtiments
  d'Overture Maps (version 2026-10-21.0). Le mot est posé sous 70 %, la part de
  la Slovaquie, et pas au-dessus : France 87 %, Italie du Nord 82 %, Slovaquie
  70 %, Slovénie 68 %, Hongrie 66 %, Monténégro 65 %, Italie du Centre 64 %,
  Croatie 53 %, Bosnie-Herzégovine 51 %, Italie du Sud 47 %, Serbie 37 %,
  Kosovo 35 %, Portugal 18 %, Roumanie 16 %, Macédoine du Nord 2 %. Overture ne
  connaît pas tout le bâti : ces parts sont des ordres de grandeur. Pour l'Italie,
  la limite suit la première ancre de la région, à 44° de latitude. Avant de
  l'ajouter à un pays, mesurer de même ; le semis se contrôle par
  `node scripts/buildings-audit.mjs`.

Quatre champs facultatifs disent du bâti ce qu'une palette ne dit pas ;
absents, la palette décide (`layers/townStyle.js`) :

- **`roofs`** — les formes de toit (`flat · gable · hip · pyramid`), **de la
  plus répandue à la moins répandue**, aux parts du rang comme `farming`. La
  taille tranche toujours avant : un immeuble et un hangar restent plats.
- **`roofPitch`** — `low` ou `steep` : la pente du pays rapportée à celle de sa
  couverture. Le thème dit ce que vaut chaque mot (`theme.roofs.pitchFactors`).
- **`walls`** — les murs du pays, le plus répandu d'abord, et ce premier est
  celui de `building`. Chaque façade tire son mur à la part du rang et prend le
  ton de la première palette du thème qui porte ce mur (`wallToneFor`).
- **`townStoreys`** — `[min, max]` niveaux d'un bâtiment **en ville** dont la
  donnée tait la hauteur : sans attribut, ou avec les 5 m que les tuiles
  OpenMapTiles donnent par défaut (`buildingHeightUnknown`). Le nombre est tiré
  du lieu. Hors de la ville, et partout ailleurs, la hauteur reste celle de la
  donnée — sauf la maison semée d'un bourg `compact`, qui est une maison de
  ville.
- **`townForm`** — `detached` (défaut) ou `compact`. Le semis du bâti
  (`sparse: ['buildings']`) prend ses cotes en conséquence : maisons isolées en
  retrait, mesurées sur des villages roumains, ou façades mitoyennes à
  l'alignement du trottoir, un jour de moins de 6 m entre deux voisines comblé
  (`INFILL_COMPACT`).
- **`belfry`** — `spire` (défaut), `campanile`, `dome` ou `crenellated` : le
  clocher des églises du pays, que le thème dessine (`theme.belfries`). `dome`
  couronne d'une coupole sur tambour le clocher des églises assez longues ;
  `crenellated` laisse la tour sans toit, sous les mâchicoulis et les merlons
  du château `crenellated`.
- **`fortress`** — `keep` (défaut) ou `crenellated` : le château et l'enceinte
  du pays (`theme.fortresses`). `crenellated` ôte le toit du château, le
  couronne de mâchicoulis et de merlons, et carre ses tours ; l'enceinte prend
  la même pierre et ses merlons.
- **`planted`** — les essences plantées en ville (rues, parcs, cours, places),
  dans le vocabulaire de `trees`, quand ce ne sont pas celles des bois. Un pays
  qui y nomme le palmier en borde son front de mer (`seafrontPalms`).
- **`naturalized`** — ce qui pousse en sauvage sur la matrice sans être une
  essence des bois : `prickly_pear` (figuier de Barbarie), `tree_spurge`
  (euphorbe arborescente), `agave`. Semé épars sur la matière de la matrice et
  sur celle qu'elle cède en pente (`biomeDebris.js`, densité
  `NATURALIZED_SOWING`), et au bord des routes, en ville comme en campagne
  (`roadsideWild.js`, `roadPerKm`), et seulement dans les pays qui le nomment.

Rien d'autre. Pas d'altitude, pas d'humidité, pas de score : ce qui existe
réellement à un endroit est relevé par le vectoriel, et une région qui le
redirait finirait par le contredire.

## Le vocabulaire est fermé

Les listes admises sont dans `src/core/regionInterpretation.js`, et rappelées en
tête de `src/core/regions.js` pour qu'on puisse remplir sans l'ouvrir. **Un mot
inventé est une erreur**, et le test la lève : c'est le seul endroit où
`oak_forest` écrit à la place de `broadleaf_woodland` se signale.

Certains mots sont admis sans que le décor sache encore les rendre — la
rizière, la serre, la terre crue, le palmier. Il faut les employer quand même :
décrire l'Andalousie sans serre serait décrire autre chose. Ils rendent un repli
volontairement quelconque, et le test les inventorie à chaque passage. Cet
inventaire est la liste de ce qui reste à construire.

## Ce qui n'est pas dans ce fichier

Aucune couleur, aucune hauteur, aucune densité. Un mot de région est une clé :
`regionInterpretation` le traduit en concept de moteur, le thème décide de ce
qu'il vaut à l'œil. Une teinte écrite ici serait une direction artistique
échappée de `themes/default.js`.

## Ce que le thème accroche au pays

Un dossier de région ne contient aucune couleur : ses mots sont des clés, et
c'est `src/themes/default.js` qui dit ce qu'elles valent à l'œil. Cinq tranches
les lisent, et une seule personne les écrit — le graphiste, sans toucher au
moteur.

| Tranche | Ce qu'elle accroche | Comment |
| --- | --- | --- |
| `TREE_SPECIES` | les essences | une entrée par mot : ses silhouettes, le peuplement de `FOREST_TYPES` qu'elle forme quand elle domine, et ses cotes une fois plantée (`planted`) |
| `TOWN_PALETTES` | le bâti | une palette par clé : le pays nomme la sienne |
| `SOIL_LOOK` | la matrice | une entrée par matrice : le lavage du sol ; `grassPatch`, les plaques d'une seconde couleur sur l'herbe (albédo absolu, force) ; `gapBushes` et `gapBush`, les arbustes semés dans le trou ; `scatteredTreesPerHa`, les arbres isolés du trou (`furniture/gapTrees.js`) ; `coverBush`, le buisson que le pays sème sur une matière relevée (`{ scrub: 'palmGarrigue' }`). Absent = aucun |

Référence de direction pour les pays secs : *Alba: a Wildlife Adventure*
(ustwo, [article sur son décor](https://ustwogames.co.uk/news/the-environment-art-of-alba-a-wildlife-adventure/)),
pour la végétation qui se superpose (arbres, buissons, sol). La couleur du
trou, elle, suit les vues de Street View prises en Sicile de mai à novembre
(`scripts/roadside-views.mjs`) : en culture et en pâture sèches, le fond est
paille, cassé de plaques d'herbe ou de calcaire ; seules les terrasses restent
herbeuses.
| `STONE_LOOK` | la pierre | une teinte par géologie, appliquée à la roche et aux ouvrages qui en sont faits |
| `SKY_PALETTE.variants` | la matrice | une variante cite les matrices dont elle colore l'air ; `sun`, `ambient`, `haze`, `turbidity` (facteurs, 1 par défaut) y règlent la lumière directe et diffuse de jour, la densité du brouillard et celle du ciel ; `water`, l'albédo de toute l'eau (mer, lac, rivière) |
| `STREET_LOOK.pavement` | la matrice | la teinte du sol revêtu de la ville |

Quatre choses à savoir avant d'y toucher :

- **une essence sans entrée est ignorée**, et un pays dont aucune essence n'a
  d'entrée prend `DEFAULT_TREE_SPECIES` : lever ici aborterait la construction
  et emporterait les couches suivantes. C'est le test qui signale l'oubli, pas
  le décor ;
- **une essence sans peuplement (`stand`) ne fait pas de bois** : elle n'est
  que plantée — parcs, cours, places, alignements —, à sa part du rang parmi
  les arbres plantés. C'est le palmier, arbre d'ornement en Europe ;
- **`SOIL_LOOK` porte des facteurs, pas des couleurs**, et le plafond de 3,5
  de sa colonne `farmland` n'est pas décoratif : au-delà, la tige de culture
  du premier plan sature au blanc pendant que le sol continue de foncer, donc
  les deux divergent. `grass` et `bare` ne teintent que le sol peint. Une matrice
  absente vaut « pas de correction » — c'est le cas du bocage atlantique, sur
  lequel le reste du thème a été réglé ;
- **`STONE_LOOK` porte des facteurs, comme `SOIL_LOOK`**, et pour la même
  raison : la pierre est peinte par le shader du sol *et* par la géométrie des
  ouvrages, et deux palettes les feraient diverger. Le calcaire est la
  référence et n'a pas d'entrée. Les formes du catalogue en pierre — calvaire,
  lavoir, moulin, château, rochers (`stoneFurnitureItems`) — sont refaites dans
  la pierre du pays. Le bâti, lui, ne lit pas la géologie.

Trois tables ne sont pas de la direction artistique mais des règles de
plausibilité, et elles vivent dans les couches : la trame des limites de
parcelle (`BOUNDARY_MIXES`, par style de limite), le bétail (`HERD_SHEEP_ODDS`,
par matrice) et le gibier (`FOREST_GAME`, par matrice). Elles se discutent quand
même — la trame agraire se lit de bien plus loin qu'une teinte.

L'assolement n'a pas de table : il est la liste `farming` du dossier, et ses
parts se déduisent du rang.

## Vérifier

```
npm test
```

Le test contrôle que chaque dossier est complet, que chaque mot existe, que
chaque mot se traduit en quelque chose que le moteur connaît, que chaque région
est atteignable depuis sa propre ancre, et affiche les mots non rendus.

Le reste ne se vérifie qu'à l'œil : qu'une région ressemble à son pays ne se
teste pas, ça se regarde.

### Stabilité pendant une génération

Le compositeur conserve la région choisie à l'initialisation du repère local.
Avancer ne remplace donc pas les essences, les cultures et la palette des
objets déjà générés. Une région explicitement imposée ou un nouveau repère
après téléportation ouvre une nouvelle génération.

Une tuile de peuplement conserve les descriptions déjà affichées lors d'un
complément de couverture : essence, hauteur, rotation, teinte et altitude.
Les places restantes reçoivent les nouveaux candidats. Une emprise routière
révélée peut retirer un arbre qui la recouvre ; une replantation explicite ou
la sortie de la tuile libère ces descriptions.
