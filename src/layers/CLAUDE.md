# src/layers — ce qui se pose sur le terrain

Une couche lit des entités de tuile (et parfois l'index publié par une autre
couche), décide ce qui existe, et ajoute des maillages à la scène. L'ordre et
les dépendances sont écrits **une seule fois**, dans `worldComposer.js` : on ne
les devine pas ici, et une couche n'en importe pas une autre pour lui demander
son état.

## Les familles

| Fichier | Ce qu'il fait |
| --- | --- |
| `roadGraph.js` | recoud les chaussées, arrondit leurs brisures, relève les carrefours (un carrefour est un **nœud**, pas une image) |
| `roadNetwork.js` | les rubans de chaussée, leur plate-forme, l'index publié |
| `roadJunctions.js` | la surface d'un carrefour, ses bouches, qui cède le passage |
| `roadEdges.js`, `roadCorridor.js` | la rive de la chaussée, et l'emprise que le décor ne franchit pas |
| `roadWorks.js`, `bridgeLayer.js` | ponts et tunnels : un état de la chaussée, pas une classe de route |
| `roadMarkings.js`, `roadBundles.js` | marquage au sol, voies qui se longent |
| `railwayLayer.js` | la voie ferrée, qui publie sa propre emprise |
| `buildingLayer.js`, `roofGeometry.js` | le bâti et ses toitures |
| `streetLayer.js`, `gardenLayer.js` | trottoirs et coins de rue, clôtures et buissons de maison |
| `vegetationLayer.js`, `groundCover.js`, `cropLayer.js` | arbres, herbe, cultures |
| `furnitureLayer.js` + `furniture/` | tout le mobilier — voir ci-dessous |
| `faunaLayer.js`, `faunaMotion.js`, `faunaCrossing.js`, `lifeLayer.js` | ce qui bouge |
| `settlement.js` | l'habitat : emprises habitées, lieux nommés, `UrbanMask`, `FabricIndex` |

## Le mobilier

`furnitureLayer.js` **coordonne** : il tient les accumulateurs (une géométrie
fusionnée par matière linéaire, un `InstancedMesh` par forme ponctuelle),
l'emprise routière, la pose d'un objet (`_place`, `_placeBeside`), les haies,
le rendu et les animations. Il appelle chaque famille dans l'ordre, dans
`rebuild`.

**Ne lui ajoute pas une règle de famille.** Pour un nouveau type de mobilier,
identifie d'abord sa famille :

| Module | Sa question |
| --- | --- |
| `furniture/roadsideRelief.js` | ce que le **relief** impose à une chaussée : falaise de déblai, mur de soutènement, glissière et garde-corps, talus |
| `furniture/roadsideFurniture.js` | ce qui accompagne une chaussée sur sa **longueur** : éclairage, poteaux et ligne aérienne, bornes, panneaux, balises, entrée d'agglomération, alignements, haies de bas-côté |
| `furniture/junctionFurniture.js` | ce qu'un **carrefour** porte : feu tricolore, panneau de priorité |
| `furniture/parcels.js` | ce qui se lit sur une **parcelle** : contour (haie, muret, clôture), semis, rangs de vigne, cour de ferme, repères d'emprise urbaine |
| `furniture/parcelFauna.js` | qui **vit** dans une parcelle : troupeau, gibier, carnassier — et le circuit qu'il suit |
| `furniture/cemetery.js` | l'habillage d'un cimetière : mur, portail, tombes, robinet |
| `furniture/landmarks.js` | les **repères** : moulin et château d'eau d'un bourg, pierres, éoliennes, pylônes, antennes de sommet, phares, arbres de crête |
| `furniture/pointsOfInterest.js` | ce que la couche `poi` porte nommément : abribus, fontaine, lavoir, monument, château, tour |
| `furniture/catalog.js` | les listes et les plafonds : `POINT_ITEMS`, `LINEAR_KINDS`, `FURNITURE_LIMITS`, les portées partagées |

Chaque module exporte des fonctions qui prennent la couche en premier argument
(`buildParcels(layer, context, builtUp)`) : elles lisent l'emprise et les
accumulateurs par `layer`, et n'écrivent nulle part ailleurs. Aucun de ces
modules n'importe `furnitureLayer.js` — la dépendance ne remonte jamais.

Deux fichiers restent gros, et volontairement :

- **`furnitureKit.js`** (~1800 lignes) est le **catalogue de formes** : une
  fonction par objet, aucune décision de placement. On y ajoute une forme, on
  n'y met jamais une condition géographique. Pour qu'elle soit posée, il faut
  aussi une ligne dans `furniture/catalog.js`.
- **`furniturePlacement.js`** (~1100 lignes) est le **recueil de règles pures** :
  qui porte quoi, à quel espacement, avec quelle probabilité, plus les
  utilitaires d'anneau et de semis. Tout y est sans état et testable seul ;
  n'y importe ni `THREE`, ni une couche.

`roadGraph.js`, `roadNetwork.js` et `buildingLayer.js` sont gros eux aussi.
Avant d'y toucher, lis la section correspondante de `CONTRIBUTING.md` : elle dit
ce qui y est invariant, et pourquoi une règle qu'on croit libre ne l'est pas.

## Rappels

- Une couche qui ne trouve rien ne dessine rien et **ne jette pas** : une
  exception avale tout ce qui devait être construit après elle.
- Tout ce qui décide de l'apparence (couleur, silhouette, profil) se lit dans
  le thème, jamais en dur.
- Une position au sol quantifiée est la seule source de graine admise.
