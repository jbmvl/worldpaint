# src/terrain — le sol

| Fichier | Ce qu'il fait |
| --- | --- |
| `terrainBubble.js` | la bulle de terrain : maillage, anneaux, marche des falaises et déblai de la chaussée |
| `terrainMaterial.js` | le shader du sol — il lit la carte des matières |
| `lowPolyGrain.js` | le grain low poly géométrique du sol (bruit, fondu de distance, bosse le long de la normale) — câblé par matière dans `terrainMaterial.js`, réglages dans `SURFACE_LOOK` |
| `roadCut.js` | l'entaille du terrain sous une chaussée |
| `cliffCut.js` | la marche du terrain sous une falaise relevée |
| `groundClassMap.js` | la carte des matières et des cultures, rasterisée pour toute la scène |
| `surfaceClassification.js` | ce qu'une entité de tuile **dit** du sol |

## Avant de modifier `groundClassMap.js` (~1000 lignes)

C'est la source unique de ce dont le sol est fait : le shader, la végétation,
l'herbe, les cultures et le mobilier lisent tous la même carte au même endroit.
Elle fait trois choses qui tiennent ensemble et qu'on ne sépare pas à la
légère — peindre (`rebuild`, `_paintPavement`), encoder et réparer
(`surfaceFill`, `SURFACE_SIGNATURES`, `repairSurfaceEdges`), échantillonner
(`surfaceAt`, `shareOf`, `woodAt`, `cropAt`…). La signature et la réparation
sont l'une la raison d'être de l'autre : elles défont le lissage du canevas, et
les lire séparément ne veut rien dire.

À part de la carte elle-même : `poolShareAt`, le pendant CPU du bruit de
flaque que `terrainMaterial.js` découpe en GLSL — même champ, mêmes constantes
partagées (`POOL_NOISE_STRETCH`, `POOL_SCALE_RATIO`, `POOL_EDGE_SOFTNESS`),
pour que `groundCover` et `vegetationLayer` sachent où l'eau affleure sans
relire une seconde vérité.

Ce qui en est sorti, parce que c'est de la lecture pure et qu'on y va souvent :
**`surfaceClassification.js`**. Pour changer ce qu'une classe `landuse` ou
`landcover` peint au sol, quelle eau compte, ou ce qu'un cours d'eau pose,
c'est là — pas dans la carte. Les fonctions y sont pures et testables seules.

Deux pièges :

- **l'ordre de `SURFACE_KINDS` est gravé** : l'identifiant est peint dans un
  canal 8 bits et relu par le shader comme par les couches. Le changer repeint
  une lande en éboulis. Ajouter une matière veut dire : une ligne ici, une
  ligne dans `SURFACE_LOOK` (thème), et une signature qui tient le test d'écart.
- **l'eau est une matière du sol**, pas une surface posée dessus. Il n'y a pas
  de plan d'eau dans la scène.
- **la rugosité d'une matière est géométrique**, pas une texture : le sommet
  est bosselé le long de sa normale (`lowPolyGrain`), et la facette qui en
  résulte est lue par dérivées d'écran. Une matière se règle par
  `grainCellM`/`grainAmplitudeM` dans le thème, jamais par un relief inventé au
  fragment — celui-là avait été retiré parce qu'un relief sans relevé
  d'altitude fourmille avec l'observateur. La roche a en plus une entrée
  `grain` à part (`uRockGrain`) : celle que toute paroi prend sur la seule foi
  de sa pente, quelle que soit la matière lue.
- **la carte des matières est plane, et ne peut rien dire d'une paroi
  verticale.** Un texel fait 2,67 m ; une falaise de quarante mètres n'occupe
  que trois mètres d'emprise au sol, soit un liseré que la cubique du contour
  noie dans ce qui l'entoure — et toute la hauteur de la paroi se texture
  depuis ce liseré, donc s'étire. Ce qu'une surface raide doit porter se décide
  par la **pente** (`slopeStart`, `slopeEnd` dans le thème), qui la décrit
  exactement : c'est par là qu'arrivent la teinte de roche et son grain.

## Ce qui déforme le relief lu

Deux choses seulement, et dans cet ordre : la **marche** d'une falaise relevée
(`cliffCut`, publiée par `layers/cliffLayer`), puis le **déblai** d'une
chaussée (`roadCut`). La falaise façonne le terrain naturel, la route entaille
ce qu'elle trouve — l'ordre inverse taillerait la chaussée dans une rampe que
la marche vient de supprimer.

Trois lectures en découlent, et chacune a son lecteur : le **MNT brut**
(`rawSurfaceElevationAtLocal`), sur lequel seule la couche des falaises mesure
la marche ; le **terrain naturel** (`naturalElevationAtLocal`), falaises
comprises et déblai exclu, sur lequel se dressent les plates-formes et que lit
le relief de rive ; la **surface affichée** (`surfaceElevationAtLocal`), tout
compris, pour le reste du décor. Une plate-forme dressée sur le MNT brut
flotterait au pied d'une falaise et s'enfoncerait à son arase.

Les deux déformations sont des fonctions **pures de la position au sol** : c'est ce qui
permet à deux tuiles voisines de s'accorder au bord sans se consulter. Une
déformation qui dépendrait de la tuile courante, de l'ordre de parcours ou de
la position de l'observateur ouvrirait une crevasse à chaque jointure.

## Deux largeurs de déblai, et on ne les confond pas

`roadCut.js` en porte deux :

- `ROAD_CUT_M` — l'**emprise**, l'accotement excavé tel qu'un terrassier le
  laisse. C'est ce que le paysage garde libre, et ce dont `roadCorridor` tire
  sa marge.
- `cutBenchAt(pas)` — le **fond plat réellement creusé**, au moins une maille
  de terrain. Plus étroit, il peut ne contenir aucun sommet de la maille : le
  triangle enjambe alors la chaussée et sa corde passe au-dessus.

Le pas est celui de la maille la plus grossière qui soit entaillée
(`ROAD_CUT_MAX_RING`), et non celui de la tuile où l'on creuse — sinon la
largeur du fond plat changerait avec l'anneau, donc avec la caméra.
`terrainBubble` publie la cote une fois pour toutes en `cutBenchM`, et ce qui
borde une chaussée la lit là : l'index des routes (`roadNetwork`) pour sa
marge, la falaise du déblai (`roadsideRelief`) pour le pied de sa paroi, le
masque du grain low poly (`roadCutMaskAt`) pour son emprise.
