# Les surfaces : ce qu'on lit, ce qu'on peint, ce qu'on laisse

État des lieux de l'occupation du sol, à jour de la branche courante. Tout ce
qui suit est décidé dans `src/terrain/groundClassMap.js` — deux fonctions pures
(`groundClassFor`, `coverFor`) et deux rasters de 4096 m de côté à 1536 px,
soit **2,7 m par pixel**.

Le reste du décor ne fait que relire ces deux cartes : le shader de terrain y
prend la couleur du sol jusqu'à l'horizon (`terrainMaterial`), l'herbe sa
hauteur et sa densité (`groundCover`), la végétation ses arbustes
(`vegetationLayer`).

## Les deux cartes

| Carte | Canaux | Filtrage | Sens |
| --- | --- | --- | --- |
| matières | R herbe, G bois, B culture, A classé | linéaire | des **parts**, qui se mélangent ; les lisières se fondent sur quelques mètres |
| cultures/couvertures | R culture, G couverture, A peint | au plus proche | des **identifiants**, qui ne se mélangent pas |

Une parcelle porte donc une part de chaque matière, et *une* culture **ou**
*une* couverture, jamais un mélange des deux.

## Ce qui est lu

### `landcover` — de quoi le sol est fait

| `class` (et `subclass`) | matière | couverture | strate basse |
| --- | --- | --- | --- |
| `wood` | bois | — | arbres (`vegetationLayer`) |
| `farmland` | culture | — | tiges de la culture tirée (`cropFor`) |
| `grass` | herbe | — | prairie |
| `grass` + `heath` | herbe | `heath` | rase, dense, brune, 0,3 arbuste |
| `grass` + `scrub`, `shrubbery` | herbe | `scrub` | peu d'herbe, 0,9 arbuste |
| `grass` + `fell`, `tundra` | herbe | `alpine` | rase, verte |
| `wetland` | herbe | `wetland` | **la plus haute du décor** (×1,4), roselière |
| `rock` + `scree` | sol nu | `scree` | quasi rien |
| `rock` (autre) | sol nu | `rock` | quasi rien |
| `sand` | sol nu | `sand` | quasi rien (0,08) |
| `ice`, `subclass` `glacier`/`ice_shelf` | sol nu | **aucune** | — |

### `landuse` — qui occupe le sol

| `class` | matière |
| --- | --- |
| `residential`, `suburb`, `neighbourhood`, `quarter` | 66 % herbe, le reste minéral |
| `cemetery`, `pitch`, `playground`, `stadium` | herbe |
| `industrial`, `commercial`, `retail`, `railway`, `quarry` | sol nu |
| tout le reste | **rien** (voir « ce qui n'est pas lu ») |

`landuse` ne pose jamais de couverture : il dit qui occupe le sol, pas de quoi
il est fait.

### Ce que `landcover` ne contient pas

Notre `class` vient de la tuile, pas d'OSM : c'est OpenMapTiles qui range le
tag d'origine dans une des sept classes, et **son tableau de correspondance est
fermé**. Sur la clé `natural`, il ne retient que `wood`, `wetland`, `fell`,
`grassland`, `heath`, `scrub`, `shrubbery`, `tundra`, `glacier`, `bare_rock`,
`scree`, `beach`, `sand`, `dune`.

Conséquence directe, et elle explique le plus souvent une surface manquante :
`natural=shingle` (une plage de **galets**), `natural=mud`, `natural=rock`,
`natural=cliff` **n'arrivent jamais jusqu'à nous** — pas de feature du tout,
donc repli en herbe. Une plage n'est du sable pour nous que si elle est taguée
`natural=beach`, `natural=sand` ou `natural=dune`.

Sources : [schéma `landcover`](https://github.com/openmaptiles/openmaptiles/blob/master/layers/landcover/landcover.yaml),
[correspondance des tags](https://github.com/openmaptiles/openmaptiles/blob/master/layers/landcover/mapping.yaml),
[portage Planetiler](https://github.com/openmaptiles/planetiler-openmaptiles/blob/main/src/main/java/org/openmaptiles/layers/Landcover.java)
(c'est celui qu'OpenFreeMap fait tourner ; le sable y est servi jusqu'au z14
sans autre filtre qu'une taille minimale au-dessous du z13).

### `park`

Toujours de l'herbe, peint en dernier, et il **efface** la culture ou la
couverture qui se trouvait dessous : un parc tracé sur une lande n'est pas une
lande.

### `water` et `waterway` — l'eau

L'eau n'est pas une surface posée sur le terrain : le sol *est* l'eau là où la
carte le dit (couverture `water`). Deux entrées :

- les **polygones** de la couche `water` (lacs, fleuves larges, mer), sauf les
  piscines et les tunnels ;
- les **traits** de la couche `waterway`, élargis par la largeur de thème
  (`WATERWAY_CLASSES` : rivière 9 m, canal 6 m, ruisseau 3 m, drain 1,6 m,
  fossé 1,2 m). Un cours d'eau souterrain ou intermittent n'a pas de surface.
  Chaque lit reçoit de part et d'autre une **ripisylve** de 7 m, peinte en bois
  et plantée comme une vraie forêt ; le fossé n'en a pas.

## Ce qui n'est pas lu, et ce que ça donne à l'écran

Ce sont des manques constatés dans le code, pas des jugements sur le rendu.

1. **Là où la donnée se tait, c'est de l'herbe.** `unclassifiedWeights` vaut
   `[1, 0, 0, 0]` partout, quel que soit le pays. C'est le pari gagnant en rase
   campagne européenne ; c'est aussi la raison pour laquelle **un désert non
   cartographié est une prairie**. Le climat (`soilWashFor`) ne fait ensuite que
   jaunir cette herbe — en `arid` elle devient olive et clairsemée, jamais du
   sable — et la grille climatique **s'arrête à l'Europe** : hors fenêtre, le
   Sahara est peint avec l'albédo d'herbe d'une prairie normande.
   Un désert n'existe donc aujourd'hui que là où OSM a tracé un `natural=sand`.
2. **La glace n'a pas de couverture.** `ice`, `glacier`, `ice_shelf` tombent en
   sol nu sans identifiant : un glacier est peint comme du gravier gris.
   `COVER_KINDS` n'a ni `snow` ni `ice`.
3. **Un marais n'a pas d'eau.** La couverture `wetland` existe, avec sa couleur
   et sa roselière haute, mais rien ne rend le **film d'eau** entre les touffes.
   Toutes les sous-classes (`bog`, `marsh`, `swamp`, `saltmarsh`, `fen`…) sont
   confondues, alors que le `swamp` est un marais **boisé**.
4. **Une plage n'a pas de laisse de mer.** Le sable est géré de bout en bout
   (matière, couleur, quasi-absence d'herbe) mais il est le même partout :
   ni bande de sable mouillé au contact de l'eau, ni distinction entre plage,
   dune et sable de désert.
5. **`landuse` ignoré** : `military`, `school`, `university`, `college`,
   `kindergarten`, `hospital`, `track`, `dam`. Ils retombent donc sur l'herbe de
   repli — ce qui est plausible pour une école, moins pour un barrage.
6. **Aucune couverture ne vient de `landuse`.** Une saline (`salt_pond`), une
   tourbière exploitée ou une piste ne peuvent pas être décrites aujourd'hui.

## Comment vérifier ce que la donnée dit, sans deviner

Dans la démo, cocher **« étiquettes »**. `collectPlaceLabels` parcourt les
emprises `landcover` et `landuse` dans un rayon de 260 m et les nomme telles
qu'elles arrivent : une étiquette « sable » signifie qu'une entité de classe
`sand` est bien là, et donc que si le sol n'a pas la couleur du sable, le
défaut est chez nous. Pas d'étiquette : la donnée ne dit rien à cet endroit, et
c'est le repli en herbe qu'on voit.

## Le pas de la carte

2,7 m par pixel. C'est la limite dure de tout contour : les matières la
masquent par leur filtrage linéaire, les identifiants (culture, couverture) ne
le peuvent pas, puisqu'interpoler un identifiant inventerait une matière.

Pour l'eau, dont le bord est le contraste le plus fort du décor, le shader
interpole le **résultat du test** « ce carreau est-il de l'eau » sur les quatre
carreaux voisins (`waterShareAt`, dans `terrainMaterial.js`) : la berge est une
rampe d'un carreau au lieu d'une marche. Ce qui reste, et qui demanderait une
carte de couverture d'eau à part, peinte avec son antialiasing : le contour
passe par les centres des carreaux, il ne retrouve pas la position exacte du
polygone à l'intérieur de l'un d'eux.
