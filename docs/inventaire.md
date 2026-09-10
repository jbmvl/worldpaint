# L'inventaire : ce que le décor contient, et d'où ça vient

Ce document répond à une seule question, objet par objet : **qu'est-ce qui a
mis ça là ?** Il complète `docs/surfaces.md` (le sol, en détail) et
`docs/climats.md` (comment la famille climatique est décidée).

Les mots du métier sont définis en fin de document, dans le [glossaire](#glossaire).

## Les trois régimes

Tout ce qui apparaît à l'écran relève de l'un des trois, et savoir lequel est
la première chose à savoir devant un objet qui surprend.

| Régime | Ce que ça veut dire | Exemple |
| --- | --- | --- |
| **Relevé** | l'objet est dans les tuiles, à ses vraies coordonnées | un bâtiment, une route, un lac, un sommet, un arrêt de bus |
| **Déduit** | rien ne le dit, mais ce qui est relevé l'implique | le trottoir d'une rue, la ferme d'un parcellaire, la ripisylve d'un ruisseau |
| **Inventé** | tiré au sort, sous conditions | un lampadaire, une haie, un troupeau, une éolienne, un panneau |

Le troisième régime obéit à un **invariant dur** : toute graine dérive d'une
position au sol quantifiée à 50 cm (`positionSeed`), jamais de l'ordre de
parcours ni de la position de l'observateur. La même donnée rend donc le même
paysage, et repasser au même endroit y retrouve la même vache.

## Ce qu'on lit

**Tuiles vectorielles** OpenMapTiles (servies par OpenFreeMap), zoom 14. Neuf
couches sont ouvertes, et **elles seules** :

| Couche | Qui la lit | Pour quoi |
| --- | --- | --- |
| `landcover` | `groundClassMap`, `furnitureLayer` | matière du sol, cultures, contours de parcelle |
| `landuse` | `groundClassMap`, `settlement`, `furnitureLayer` | occupation, zones bâties, vert urbain |
| `water` | `groundClassMap`, `furnitureLayer` | lacs, fleuves larges, mer, trait de côte |
| `waterway` | `groundClassMap` | ruisseaux, canaux, fossés, et leur ripisylve |
| `transportation` | `roadNetwork`, `railwayLayer` | chaussées, voies ferrées, ponts et tunnels |
| `building` | `buildingLayer`, `settlement` | empreintes bâties, densité du tissu |
| `poi` | `buildingLayer`, `furnitureLayer` | fonction d'un bâtiment, abribus, fontaines, châteaux |
| `place` | `settlement` | nom et rang d'une agglomération |
| `mountain_peak` | `furnitureLayer` | sommets, pour les antennes |

La couche `park` **n'est pas lue** : au schéma OpenMapTiles elle ne contient
aucun parc de ville mais des périmètres de protection (Natura 2000, parcs
nationaux), qui ne disent rien de la matière du sol. Voir `docs/surfaces.md`.

**Relief** : tuiles Terrarium (Mapzen, hébergées par AWS Open Data).

**Climat** : une grille Köppen embarquée, pas 10° et **bornée à l'Europe**
(−25° à +45° de longitude, 34° à 72° de latitude). Hors fenêtre, aucune famille
n'est décidée et tout retombe sur les valeurs par défaut, qui sont celles du
climat océanique. Le relief corrige ensuite la famille : au-dessus de 1000 m un
climat méditerranéen devient montagnard, au-dessus de 1200 m tout le reste
devient alpin.

---

## Le sol

Quatorze matières, décrites en détail dans `docs/surfaces.md`. En résumé :

| Matière | Condition |
| --- | --- |
| `grass` | `landcover class=grass`, `landuse` cemetery/pitch/playground/stadium, **et tout le non-classé** |
| `settled` | `landuse` residential/suburb/neighbourhood/quarter |
| `farmland` | `landcover class=farmland` |
| `wood` | `landcover class=wood`, et la ripisylve des cours d'eau |
| `heath`, `scrub`, `alpine` | `class=grass` + sous-classe heath / scrub·shrubbery / fell·tundra |
| `wetland` | `landcover class=wetland` |
| `bare` | `landuse` industrial/commercial/retail/railway/quarry, et la glace |
| `scree`, `rock` | `class=rock` selon la sous-classe `scree` |
| `sand` | `landcover class=sand` (beach, sand, dune) |
| `pavement` | **déduit** : bâti ∩ disque urbain, moins le vert urbain |
| `water` | polygones `water`, traits `waterway` élargis |

Le climat ne lave que quatre d'entre elles (`grass`, `farmland`, `bare`,
`pavement`) : une lande, un maquis ou un éboulis disent déjà leur pays.

### Les cultures

Second axe, indépendant de la matière : un champ est du `farmland` **et** du
blé. La culture est tirée une fois, au centre de la parcelle, dans l'assolement
du pays (`CROP_MIXES`) :

| Famille | Assolement dominant |
| --- | --- |
| oceanic | blé 30 %, maïs 22 %, labour 18 %, colza 12 %, verger 9 %, tournesol 5 %, vigne 4 % |
| oceanicUpland | labour 50 %, blé 27 %, colza 10 %, maïs 8 %, verger 5 % |
| continental | blé 38 %, labour 20 %, maïs 16 %, colza 10 %, tournesol 8 % |
| boreal | labour 52 %, blé 33 %, colza 10 %, verger 5 % — ni maïs ni tournesol, la saison est trop courte |
| mediterranean | vigne 24 %, verger 24 %, blé 17 %, labour 16 %, lavande 10 %, tournesol 9 % |
| mediterraneanMontane | labour 36 %, blé 22 %, verger 22 %, lavande 12 %, vigne 8 % |
| semiArid | labour 38 %, blé 22 %, verger 22 %, lavande 10 %, vigne 8 % |
| arid | labour 70 %, verger 20 %, blé 10 % — une parcelle cultivée y est irriguée |
| alpine | labour 70 %, blé 25 %, verger 5 % |
| glacial | labour, et rien d'autre |

Deux sous-classes court-circuitent le tirage : `vineyard` donne une vigne,
`orchard`/`plant_nursery` un verger. Ces deux-là sont semées **en rangs**
(`ROW_CROPS`), les autres en vrac.

---

## La végétation

### Les arbres (`vegetationLayer`)

Ils poussent là où la carte du sol dit « bois », et nulle part ailleurs — même
donnée que le shader, donc jamais de contradiction. Le **peuplement** est tiré
sur une maille de terrain, parmi les types dont la liste `climates` accepte la
famille du lieu :

| Peuplement | Familles | Hauteur | Densité | Sous-bois |
| --- | --- | --- | --- | --- |
| futaie | oceanic, continental, mediterraneanCool | 12–22 m | 0,95 | 0,12 |
| pinède | oceanic, continental, mediterraneanCool | 11–19 m | 1,45 | 0,08 |
| taillis | les six tempérées et méditerranéennes | 3,5–7 m | 1,75 | 0,55 |
| mixte | oceanic, continental, mediterraneanCool | 7–16 m | 1,3 | 0,34 |
| pinède méditerranéenne | mediterranean, semiArid | 7–14 m | 0,85 | 0,45 |
| chênaie verte | mediterranean, mediterraneanCool | 6–11 m | 1,25 | 0,4 |
| pinède de montagne | mediterraneanMontane | 11–20 m | 1,05 | 0,2 |
| taïga | boreal | 9–18 m | 1,5 | 0,18 |
| bétulaie | boreal, oceanicUpland, alpine, glacial | 4–11 m | 1,1 | 0,35 |
| pessière subalpine | alpine | 8–16 m | 1,2 | 0,16 |
| bosquet sec | semiArid, arid | 3–8 m | 0,55 | 0,55 |
| bois rabougri | oceanicUpland | 3–7 m | 0,85 | 0,5 |

La **lisière** est traitée à part : la canopée y baisse (−30 %) et la strate
basse y monte (+55 %) — un bois vu du dehors est un mur de feuilles, pas une
coupe dans une futaie.

### La ripisylve : les arbres que personne n'a plantés

**Déduite**, et c'est le seul endroit où du bois apparaît sans qu'aucune entité
ne dise « bois ». Chaque trait de la couche `waterway` reçoit de part et d'autre
une bande de 7 m (`RIPARIAN_BUFFER_M`) peinte en `wood` dans la carte du sol —
et ce qui est peint en bois est **planté comme une vraie forêt**, avec les
mêmes silhouettes, la même densité et le même peuplement qu'un massif.

La bande totale est donc large : le lit plus deux fois sept mètres.

| Classe `waterway` | Lit | Bande de bois |
| --- | --- | --- |
| `river` | 9 m | 23 m |
| `canal` | 6 m | 20 m |
| `stream` | 3 m | 17 m |
| `drain` | 1,6 m | **aucune** |
| `ditch` | 1,2 m | **aucune** |

Le fossé et le drain n'en portent pas (`BARE_WATERWAY_CLASSES`) : ce sont des
traits creusés — en bord de champ, en bord de route — et non des cours d'eau
bordés d'arbres. Ils en portaient, et c'était l'origine des bosquets qui
suivaient les routes : dans OSM, le fossé d'assainissement d'une chaussée est
très souvent un `waterway=drain`, et l'ourlet lui plantait quinze mètres de bois
le long du bitume. Leur lit, lui, reste : c'est un fait de la carte.

Un cours d'eau souterrain (`brunnel=tunnel`) ou intermittent n'a ni lit ni
ourlet.

### Les arbustes hors des bois

Semés d'après la matière du sol seule (colonne `bushes` de `SURFACE_LOOK`) :
maquis 0,9, lande 0,3, marais 0,08, sable 0,05, pelouse d'altitude 0,04, dalle
0,02, éboulis 0. C'est ce qui fait exister un maquis — ni prairie ni forêt, mais
un fourré bas.

### L'herbe (`groundCover`)

Trois échelles selon la distance (la plante, la touffe, la masse). La quantité
est le produit de trois choses : la part de végétal lue dans la carte, la ligne
de la matière (une lande est rase et dense, un maquis clairsemé), et le climat
(`grassDensity` de 1,0 en plaine continentale à **0,15 en désert** — c'est la
terre visible entre les touffes qui fait une steppe, pas la couleur).

16 % des touffes portent des fleurs en pleine prairie, 42 % en lisière de
culture (le coquelicot). Sous les arbres, ce n'est plus une prairie mais une
litière : moitié moins haute, 30 % moins dense, réchauffée vers le brun.

---

## Le bâti

### Le volume

Empreintes relevées (`building`), extrudées à leur hauteur réelle. Une empreinte
est d'abord **rabotée** de ce qu'elle pose sur une chaussée : le tracé de la
voie et le contour du bâti viennent de deux relevés que rien ne réconcilie.

Le toit est construit sur le rectangle englobant orienté de l'empreinte ; une
empreinte trop mal remplie (moins de 62 % du rectangle) retombe sur le toit
plat.

### La couleur : un village, pas une maison

Les tuiles ne portent ni matériau, ni couleur, ni forme de toit. La palette est
donc tirée **par bourg** (maille de 1400 m), parmi celles que le climat admet :

| Palette | Familles |
| --- | --- |
| calcaire | oceanic, continental, mediterraneanCool |
| ocre | mediterranean, mediterraneanCool, semiArid, arid |
| granit | oceanic, oceanicUpland |
| brique, colombage | oceanic, continental |
| chaux | mediterranean, mediterraneanCool, semiArid |
| ardoise | oceanic, oceanicUpland, continental |
| lauze | alpine, mediterraneanMontane, oceanicUpland |
| bois rouge | boreal, oceanicUpland, glacial |
| bois vieilli | boreal, alpine |
| badigeon | arid, semiArid, mediterranean |
| brique balte | continental, boreal |
| pierre grecque | mediterraneanMontane, mediterranean |
| crépi alpin | alpine |

76 % des maisons portent des volets ; le volet est le seul endroit du bâti où
une vraie couleur est admise. Une « maison » est une empreinte de moins de
320 m² et moins de 11,5 m de haut.

### La fonction, quand la donnée la dit

Un point d'intérêt ne pose jamais un modèle à côté : il **transforme**
l'empreinte qui le contient.

| `poi` | Effet |
| --- | --- |
| `place_of_worship` | clocher (pierre + ardoise), ou minaret et coupole si `subclass=muslim` |
| `hospital` | murs clairs, toit plat |
| `mall`, `department_store`, `supermarket` | grande surface, toit plat |
| `bakery` | devanture en bois verni |
| dix-huit classes de commerce | devanture au rez-de-chaussée, avec enseigne et pictogramme |

Château, monument, tour, moulin et grande roue restent du mobilier posé à part :
ce sont de grandes structures qu'une empreinte ordinaire ne recouvre pas.

### Le jardin (`gardenLayer`)

**Inventé**, sous conditions : une maison isolée (pas mitoyenne), à moins de
170 m, dans 62 % des cas — une clôture basse à piquets et deux à cinq buissons,
cadrés sur le rectangle du toit.

---

## La voirie

### La chaussée

Six profils, tirés de `transportation.class` :

| Profil | Classes OSM | Largeur |
| --- | --- | --- |
| express | motorway, trunk | 12 m |
| major | primary, secondary, et les bretelles | 8,5 m |
| minor | tertiary, unclassified, residential | 5 m |
| lane | service, pedestrian | 3,6 m |
| track | track | 3 m, terre, ornières |
| path | path | 1,4 m, terre |
| cycleway | cycleway, `bicycle=designated` | 2,2 m, avec pictogramme au sol |

Les morceaux livrés par les tuiles (coupés à chaque frontière et à chaque
changement d'attribut) sont **recousus en graphe** avant qu'on en fasse quoi que
ce soit, faute de quoi le marquage, le mobilier et les haies redémarrent à
chaque couture. Les carrefours sont des **surfaces**, pas des points.

`brunnel` décide de l'ouvrage : un pont reçoit tablier, piles, culées et
parapets ; un tunnel, ses têtes.

### Le trottoir (`streetLayer`)

**Déduit**, et à trois conditions cumulées : la voie est dans un périmètre
`landuse` bâti, **au moins deux bâtiments** sont relevés dans les 30 m, et le
terrain en travers est presque plat (moins de 14 % de dévers). Le premier
critère est un droit, le deuxième un fait : une rue ne se compose que là où les
deux concordent. Longueur minimale d'une composition : 12 m.

### Le mobilier de bord de route

Tout **inventé** — le schéma OpenMapTiles ne porte ni lampadaire, ni panneau,
ni borne, ni poteau. Les espacements sont ceux du terrain, desserrés d'environ
un tiers par rapport aux minimums réglementaires (un plan large paraît saturé) :

| Objet | Où | Espacement |
| --- | --- | --- |
| lampadaire | en agglomération | 38 m (major), 44 m (minor), 48 m (lane) |
| poteau électrique | hors agglomération | 62 m (major), 68 m (minor) |
| borne hectométrique | major | 100 m |
| borne kilométrique | express, major | 1000 m |
| alignement d'arbres | major hors agglomération | 16 m |
| panneau | major 620 m, minor 900 m | — |
| panneau de direction | express 1300 m, major 1700 m | — |
| feu tricolore | major et minor, en agglomération | aux carrefours |
| haie | minor, lane et track hors agglomération | continue |

Le **panneau** qu'une portion porte dépend de ce qui s'y passe : au-delà de
0,02 rad/m de courbure c'est une balise de virage, entre 0,009 et 0,02 un
danger ou une balise ; en agglomération, passage piéton (30 %), limitation
(42 %), danger ; sur grand axe, priorité (30 %), interdiction de dépasser
(28 %), limitation (24 %), danger.

La **glissière** exige un vrai vide : au moins 90 cm de surplomb **et** un
versant franc (14 %) ou une courbe. Acier sur les grands axes, bois sur les
petites routes.

Le **talus enherbé** garnit un bas-côté sur trois environ (34 %), d'un seul
côté, hors agglomération.

---

## Le paysage agraire

### Le contour d'une parcelle

C'est ce qui se lit de plus loin — un bocage compartimente l'horizon, un
openfield le laisse filer. Tiré par famille climatique (`BOUNDARY_MIXES`), et
seulement sur les parcelles cultivées ou pâturées :

| Famille | Labour | Pâture |
| --- | --- | --- |
| oceanic | haie 40 %, haie basse 22 %, rien 38 % | haie 20 %, barrière 38 %, barbelé 42 % |
| oceanicUpland | **mur de pierre sèche 45 %**, haie 20 %, rien 25 % | mur 50 %, barbelé 20 %, barrière 18 % |
| continental | **rien 82 %** (openfield), haie 10 % | barbelé 50 %, barrière 30 % |
| boreal | rien 75 %, haie basse 15 % | **barrière de bois 60 %**, barbelé 25 % |
| mediterranean | rien 60 %, mur 30 % — pas de haie vive, il n'y a pas l'eau pour l'entretenir | mur 45 %, barbelé 30 % |
| mediterraneanMontane | **mur 50 %** (terrasses), rien 40 % | mur 60 %, barbelé 25 % |
| semiArid | rien 75 %, mur 20 % | barbelé 40 %, mur 30 % |
| arid | **rien 85 %** | rien 60 %, barbelé 25 % |
| alpine | mur 40 %, barrière 20 %, rien 40 % | barrière 45 %, mur 30 % |
| glacial | rien | rien |

Deux règles priment sur le tirage : au-delà d'un certain **dévers** (de 5 % en
montagne méditerranéenne à 28 % en taïga), c'est le mur, parce que la pierre
sort du premier pli de terrain ; et une parcelle **en culture** ne se clôt pas —
le blé ne s'échappe pas.

### Ce qui est semé dans une parcelle

| Contenu | Condition | Densité |
| --- | --- | --- |
| bottes de foin | `farmland`, ou culture en labour | 0,4/ha |
| troupeau | `grass`, `meadow`, `grassland` | 2,4 bêtes/ha, groupées |
| tas de bois | `wood`, rangés en lisière | 0,8/ha |
| gibier | `wood` | 0,3/ha, un massif sur deux en porte |

Le **troupeau** : la pente tranche d'abord (au-delà de 34 %, chèvre ou mouton),
le climat déplace ensuite la bascule — 28 % d'ovins en prairie océanique, 72 %
dans les Highlands, 85 % en steppe aride. Sinon vache, et rarement cheval (8 %)
ou âne (7 %).

Le **gibier** : 42 % des massifs ne portent rien du tout, et c'est voulu — un
chevreuil dans chaque bois est un parc animalier. Un massif habité tire d'abord
s'il abrite un carnassier (14 %), puis lequel :

| Famille | Gibier | Carnassiers |
| --- | --- | --- |
| oceanic | chevreuil, biche, sanglier | renard |
| mediterranean | sanglier surtout | renard |
| continental | cerf, biche, sanglier | renard, loup |
| boreal | **renne**, biche, cerf | renard, loup, **ours** |
| alpine | cerf, biche | renard, loup, ours |
| arid, glacial | rien | rien |

### La ferme (`_placeFarmstead`)

**Déduite**, faute de `landuse=farmyard` dans cette donnée : une parcelle
cultivée ou pâturée de moins de 3 ha, avec au moins deux bâtiments relevés dans
les 80 m. Elle reçoit une grange, un hangar, un ou deux silos, des serres, et ce
qui la rend habitée — une cheminée qui fume, du linge qui sèche, des poules.

> **À reprendre** : le tirage des serres est forcé à 1 dans le code, avec le
> commentaire « TEMPORAIRE (inspection visuelle) […] à remettre à 0,4 ».
> Toutes les exploitations en portent donc aujourd'hui.

---

## Les repères du paysage

| Objet | Régime | Condition |
| --- | --- | --- |
| **éolienne** | inventé | maille de 320 m, 8 % — hors bâti, hors route, sur un point haut |
| **pylône** | inventé | mêmes conditions, 6 % |
| **antenne de sommet** | relevé | sur un `mountain_peak` réel, un sur trois |
| **phare** | relevé | sur le trait de côte d'une nappe `ocean`, un point sur quarante (~2,5 km) |
| **arbre de crête** | inventé | maille de 140 m, 3,5 %, sur un point haut dégagé — résineux une fois sur trois |
| **moulin à vent** | inventé | hameau (moins de 20 bâtiments), 10 % |
| **moulin à eau** | inventé | hameau, 6 % |
| **château d'eau** | inventé | bourg (20 à 150 bâtiments), 30 % |
| **rocher** | inventé | sol minéral (> 55 %) et pente, ou pente > 28 % — trois tailles |

Une éolienne s'oriente **face au vent** courant, pas au hasard.

Les repères de bourg sont posés **hors** du périmètre bâti, à 1,25 fois son
rayon : si le point tiré retombe dans un bâti voisin ou sur une route, on
renonce plutôt que de le déplacer — un repère qui bouge d'une reconstruction à
l'autre est pire que pas de repère.

## Ce que la couche `poi` donne vraiment

Ce sont les seuls objets de mobilier que le schéma porte nommément, donc les
seuls qui soient à leur vraie place : abribus (`bus`, `bus_stop`), fontaine
(`drinking_water`, `fountain`), lavoir (`wash_house`, `watermill`), monument,
château, tour, grande roue (`theme_park`). L'abribus est repoussé hors de
l'emprise routière — il est souvent porté par le tracé de la voie elle-même —
et tourné vers la chaussée.

---

## Le vivant

| Objet | Nombre | Comportement |
| --- | --- | --- |
| bêtes au sol | 240 animées au plus | haltes et trajets sur un circuit fermé, jusqu'à 8 traversées de route en cours |
| oiseaux | 22 | dérivent entre 16 et 52 m au-dessus de l'observateur, 3 à 9 m/s |
| fumée | 6 cheminées, 9 bouffées chacune | monte à 1,15 m/s, dérive à 0,75 m/s, vit 5,5 s |

Les bêtes sont les seules choses posées au sol qui bougent d'une image à
l'autre ; tout le reste du décor est reconstruit tous les 250 m et immobile
entre deux reconstructions.

## Le ciel et le temps

Le ciel suit le modèle de Preetham, avec les nuages natifs de three : rien n'y
est peint à la main. Le **temps** n'est pas une direction artistique — il ne vit
pas dans le thème mais arrive de l'application, clé par clé : couverture
nuageuse, précipitation (`rain` ou `snow`) et intensité, vent.

Ce qu'il change : la source de lumière (voûte plutôt que disque solaire quand
c'est couvert, donc ombres effacées et relief moins modelé), la portée du
brouillard, la teinte du sol (mouillé, il fonce et sature), et deux couches de
particules — la pluie ou la neige, et les feuilles arrachées par le vent, qui
s'éteignent dès qu'il pleut.

---

## Les cadences

Savoir à quel rythme chaque chose est refaite explique la plupart des « ça a
bougé tout seul » :

| Ce qui est refait | Tous les |
| --- | --- |
| mobilier, bâti, chaussées, bêtes | 250 m |
| carte du sol (matières et cultures) | 400 m |
| fourrés du sous-bois | 12 m |
| oiseaux, fumée, pluie, vent | chaque image |

## Les limites connues

Ce sont des manques constatés dans le code, pas des jugements sur le rendu.

1. **Le non-classé est de l'herbe**, partout et quel que soit le pays. Un désert
   non cartographié est donc une prairie jaunie, et le climat n'y peut rien : il
   ne fait que laver une couleur.
2. **La grille climatique s'arrête à l'Europe.** Hors fenêtre, tout retombe sur
   le comportement par défaut, qui est celui de l'océanique.
3. **La ville est un disque**, pas un contour : sa portée se tire d'un point
   `place` (3 km pour une `city`, 1,2 km pour une `town`), seule chose que la
   donnée dise du rang d'une agglomération. Une banlieue loin du point nommé
   n'est pas pavée.
4. **La glace n'a pas de matière** : un glacier est peint comme du gravier gris.
5. **Un marais n'a pas d'eau** entre ses touffes, et toutes ses sous-classes
   sont confondues — alors qu'un `swamp` est un marais boisé.
6. `natural=shingle`, `mud`, `rock`, `cliff` **n'arrivent jamais** jusqu'à nous :
   le tableau de correspondance d'OpenMapTiles est fermé et ne les retient pas.
7. **Un cours d'eau plus étroit qu'un texel** (2,7 m) ne peut pas être rasterisé
   proprement : le drain (1,6 m) et le fossé (1,2 m) se rendent en pointillé.
   Voir `docs/surfaces.md`.
8. Le dispatch des points d'intérêt au-delà des trois premières lignes
   (abribus, fontaine, lavoir) suit le schéma `poi.yaml` **sans avoir été
   vérifié** sur les tuiles réellement servies.

## Comment vérifier ce que la donnée dit, sans deviner

Dans la démo, cocher **« étiquettes »**. Chaque couche nomme ses maillages et
`objectLabels` les traduit : une étiquette dit ce que l'objet est *pour le
code*. Les cultures et les surfaces, qui n'ont pas d'objet, sont retrouvées par
échantillonnage de la carte du sol. Pas d'étiquette : la donnée ne dit rien à
cet endroit, et c'est le repli qu'on voit.

---

## Glossaire

Les mots qui reviennent dans ce document et dans le code, par ordre
alphabétique. Chacun dit aussi *pourquoi* la chose existe : c'est ce qui manque
le plus souvent quand on lit un terme pour la première fois.

**Albédo** — la couleur d'une matière, exprimée en lumière réfléchie plutôt
qu'en couleur d'écran (0,05 pour une herbe grasse, 0,62 pour du sable). C'est la
seule chose d'une surface qui se lise encore à cent mètres, donc la seule qui
compte vraiment.

**Assolement** — la répartition des cultures d'une région : ce qu'on a une
chance de trouver dans un champ tiré au hasard. Le nôtre change par famille
climatique.

**Balayage** (`appendProfile`) — construire un volume en promenant une section
constante le long d'une ligne. C'est ainsi que sont faits les haies, les murets,
les glissières et les talus : une forme en travers, répétée tout du long.

**Bocage / openfield** — les deux trames agraires opposées. Le bocage
compartimente l'horizon en chambres closes de haies ; l'openfield le laisse
filer sans limite visible. C'est ce qui se lit de plus loin dans un paysage
agricole, avant toute couleur.

**Brunnel** — mot du schéma OpenMapTiles, contraction de *bridge* et *tunnel* :
l'attribut qui dit qu'un tronçon de route passe au-dessus ou au-dessous du
terrain. C'est lui qui décide qu'on construit un pont ou une tête de tunnel.

**Bulle** — la portion de monde chargée et affichée autour de l'observateur.
Elle a un rayon fini, elle suit l'observateur, et tout le décor est reconstruit
quand elle se déplace assez.

**Canopée / strate basse / sous-bois** — les étages d'un bois. La canopée est le
couvert des grands arbres, la strate basse ce qui pousse au sol (herbe,
litière), le sous-bois ce qui pousse entre les deux (ronces, jeunes pousses,
arbustes). Un taillis *est* son sous-bois ; une futaie entretenue n'en a
presque pas.

**Carte du sol** (carte de classes, `groundClassMap`) — une image de 1536 × 1536
points couvrant 4 km de côté autour de l'observateur, où l'on peint l'occupation
du sol avant de l'afficher. Chaque point y porte un numéro de matière et un
numéro de culture. Tout le reste du décor la relit : le sol y prend sa couleur,
l'herbe sa densité, la forêt ses arbres. C'est la source unique — d'où le fait
que rien ne peut se contredire.

**Classe / sous-classe** — les deux attributs par lesquels une tuile décrit une
entité (`class: 'grass'`, `subclass: 'heath'`). Ce ne sont **pas** les tags
OpenStreetMap : c'est OpenMapTiles qui range les tags d'origine dans une liste
fermée de classes, et ce qui n'y entre pas ne nous parvient jamais.

**Couche** (*source layer*) — un des tiroirs d'une tuile vectorielle :
`landcover`, `building`, `transportation`… Neuf sont ouvertes, et une entité qui
n'est dans aucune n'existe pas pour nous.

**Dévers** — la pente du terrain **en travers** d'une route, par opposition à la
pente dans son axe. C'est ce qui décide si une chaussée mérite un mur de
soutènement, un talus ou une glissière.

**Emprise** (routière) — la bande que la chaussée occupe réellement : le bitume
plus son accotement creusé. Rien n'a le droit de la franchir — ni haie, ni
botte de paille, ni arbre. C'est la frontière partagée du paysage, et elle est
tenue en un seul endroit pour que toutes les couches disent la même chose.

**Essence** — l'espèce d'un arbre, au sens forestier. Nous n'en distinguons que
quatre silhouettes : feuillu, résineux, colonne (peuplier, bouleau), buissonnant.

**Famille climatique** — une des onze catégories de pays que nous savons peindre
(océanique, continentale, méditerranéenne, boréale, aride…). Elle est décidée
une fois pour le lieu, à partir d'une grille de classification Köppen embarquée
et corrigée par l'altitude, puis elle change les arbres, les cultures, les
troupeaux, les murs, les couleurs de village et la couleur du sol.

**Graine / tirage** — un nombre pseudo-aléatoire *reproductible*, calculé à
partir d'une position au sol arrondie à 50 cm. C'est ce qui fait qu'un objet
« tiré au hasard » retombe toujours au même endroit avec la même apparence :
sans ça, chaque reconstruction redistribuerait tout le décor.

**Instance** — une même forme dessinée des milliers de fois avec une position,
une taille et une teinte différentes, en un seul ordre donné à la carte
graphique. Les touffes d'herbe, les arbres et les lampadaires sont des instances
— c'est ce qui rend leur nombre abordable.

**Köppen** — la classification climatique de référence (Cfb pour l'océanique,
Csa pour le méditerranéen…). Nous en embarquons une grille pour l'Europe, et
nous la traduisons en familles.

**Lisière** — le bord d'un bois, vu du dehors. Traité à part : la canopée y
baisse et la strate basse y monte, parce qu'un bois vu de l'extérieur est un mur
de feuilles et non une coupe dans une futaie.

**Litière** — le sol d'un bois : feuilles mortes et herbe rase, pas une prairie
à l'ombre.

**Maille** — une case d'une grille imaginaire posée sur le monde (1400 m pour la
palette d'un bourg, 320 m pour les éoliennes, 1,6 m pour les touffes d'herbe).
Tout ce qui est tiré au sort l'est **par maille**, ce qui donne au tirage un
ancrage au sol.

**MNT** (modèle numérique de terrain) — le relevé d'altitude du terrain, lu dans
des tuiles d'élévation. Il est bruité au mètre près, d'où les lissages
partout où une route ou une berge doit rester droite.

**OpenStreetMap / OpenMapTiles / OpenFreeMap** — trois choses différentes qu'il
vaut mieux ne pas confondre. OpenStreetMap est la base de données mondiale ;
OpenMapTiles est un **schéma** qui décide comment ses tags sont rangés en
classes et découpés en tuiles ; OpenFreeMap est un hébergeur qui sert des tuiles
à ce schéma. Nous lisons le schéma, pas OSM : c'est pourquoi certains tags
existants ne nous parviennent jamais.

**Ourlet** — une bande de matière ajoutée le long d'une ligne (ici, les sept
mètres de bois de part et d'autre d'un cours d'eau). Voir *ripisylve*.

**Peuplement** — la composition d'un massif forestier : quelles essences, à
quelle hauteur, à quelle densité, avec quel sous-bois. Tiré une fois par massif
parmi les types que le climat autorise.

**Plate-forme** — l'assise horizontale sur laquelle une route est posée, une
fois le terrain entaillé ou remblayé. Une route ne suit pas le terrain brut :
elle se creuse une plate-forme, et c'est ce qui produit les talus.

**Profil** — la catégorie d'une chaussée pour nous (express, major, minor, lane,
track, path, cycleway), déduite de sa classe OSM. Il donne la largeur, le
revêtement, le marquage et tout le mobilier qui l'accompagne.

**Rasteriser** — transformer un contour (un polygone, une ligne) en points d'une
image. C'est ce que fait la carte du sol, et c'est de là que vient sa limite :
un objet plus petit qu'un point de l'image ne peut pas s'y écrire.

**Ripisylve** — la végétation qui pousse spontanément le long d'un cours d'eau.
Chez nous, une bande de 7 m de part et d'autre du lit, peinte en « bois » dans
la carte du sol et donc plantée d'arbres comme une vraie forêt.

**Rive** — le bord de la chaussée, en tant qu'objet à part entière : la
frontière de l'union des rubans et des surfaces de carrefour. La bordure de
trottoir s'y pose, et rien d'autre ne la calcule dans son coin.

**Ruban** — une bande plaquée sur le terrain le long d'une ligne : c'est la
forme d'une chaussée, d'une voie ferrée. Plusieurs colonnes en travers, pour
qu'un côté ne se retrouve pas en l'air sur un dévers.

**Shader** — le petit programme qui s'exécute sur la carte graphique pour chaque
point de l'écran, et qui décide de sa couleur. Celui du terrain lit la carte du
sol et compose la matière du sol jusqu'à l'horizon.

**Signature** — un nombre écrit dans la carte du sol à côté de chaque
identifiant de matière, qui certifie que ce point a été peint et non fabriqué
par le lissage du dessin. Voir `docs/surfaces.md`.

**Texel** — un point de la carte du sol, et l'unité de sa finesse : ici 2,67 m
de côté. C'est la taille du plus petit détail que la carte sache décrire, et
elle explique la plupart de ses limites.

**Tuile vectorielle** — un carré de carte livré en formes géométriques (et non
en image), à un niveau de zoom donné. Nous lisons le **zoom 14**, soit des
carrés de 2,45 km de côté à l'équateur, 1,7 km à la latitude de la France. Une
entité qui traverse une frontière de tuile est livrée en morceaux, qu'il faut
recoudre.

**Vert urbain / masque urbain** — le vert urbain, ce sont les cimetières,
stades et terrains de jeu, qu'on retire du revêtement d'une ville pour qu'un
parc reste un parc. Le masque urbain est l'emprise de la ville elle-même : le
bâti relevé, borné par un disque autour d'une agglomération nommée.
