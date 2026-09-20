# src/terrain — le sol

| Fichier | Ce qu'il fait |
| --- | --- |
| `terrainBubble.js` | la bulle de terrain : maillage, anneaux, marche des falaises et déblai de la chaussée |
| `terrainMaterial.js` | le shader du sol — il lit la carte des matières |
| `roadCut.js` | l'entaille du terrain sous une chaussée |
| `cliffCut.js` | la marche du terrain sous une falaise relevée |
| `lowPolyGrain.js` | le grain géométrique du sol : bosse au sommet, facette par dérivées d'écran |
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
  est bosselé (`lowPolyGrain`), et la facette qui en résulte est lue par
  dérivées d'écran. Une roche rugueuse se règle donc par son entrée `grain`
  dans le thème, jamais par un relief inventé au fragment — celui-là avait été
  retiré parce qu'un relief sans relevé d'altitude fourmille avec l'observateur.

## Ce qui déforme le relief lu

Deux choses seulement, et dans cet ordre : la **marche** d'une falaise relevée
(`cliffCut`, publiée par `layers/cliffLayer`), puis le **déblai** d'une
chaussée (`roadCut`). La falaise façonne le terrain naturel, la route entaille
ce qu'elle trouve — l'ordre inverse taillerait la chaussée dans une rampe que
la marche vient de supprimer.

Les deux sont des fonctions **pures de la position au sol** : c'est ce qui
permet à deux tuiles voisines de s'accorder au bord sans se consulter. Une
déformation qui dépendrait de la tuile courante, de l'ordre de parcours ou de
la position de l'observateur ouvrirait une crevasse à chaque jointure.
