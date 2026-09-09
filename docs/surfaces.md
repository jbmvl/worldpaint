# Les surfaces : ce qu'on lit, ce qu'on peint, ce qu'on laisse

État des lieux de l'occupation du sol, à jour de la branche courante. Tout ce
qui suit est décidé dans `src/terrain/groundClassMap.js` — une fonction pure
(`surfaceFor`) et **un** raster de 4096 m de côté à 1536 px, soit **2,7 m par
pixel**.

Le reste du décor ne fait que relire cette carte : le shader de terrain y prend
la couleur du sol jusqu'à l'horizon (`terrainMaterial`), l'herbe sa hauteur et
sa densité (`groundCover`), la végétation ses arbustes (`vegetationLayer`).

## La carte

| Canal | Sens |
| --- | --- |
| R | identifiant de **matière** (`SURFACE_KINDS`), 0 = la donnée se tait |
| G | identifiant de **culture** (`CROP_KINDS`), 0 = rien ne pousse |
| alpha | toujours plein — le fond est peint, pas effacé |

Filtrage au plus proche : ce sont des identifiants, et interpoler un
identifiant inventerait une matière entre deux (entre le sable et l'eau, il n'y
a rien). Le fondu des lisières est reconstruit là où il est lu — le shader et
`shareOf` lisent les **quatre texels voisins** et mélangent leurs
appartenances. Une appartenance, elle, s'interpole.

Il y en avait **deux**, une de poids et une d'identifiants, et la frontière
n'était pas une idée : une « matière » avait sa texture dessinée et méritait un
canal, une « couverture » n'avait qu'une teinte et empruntait la texture d'une
voisine. Depuis qu'une surface est une couleur — ni motif, ni grain —, il n'y a plus
qu'une liste de quatorze matières — et trente et une tiennent dans le canal, ce
qui est le point : on en ajoute une en ajoutant une ligne.

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

### Le revêtement urbain — la seule matière qui ne vient d'aucune couche

`pavement` n'est pas relevée, elle est **déduite** : entre la chaussée et les
façades, un centre-ville n'a ni herbe ni sol nu, il a du trottoir. Elle est
peinte à partir du masque urbain (`settlement.UrbanMask` : emprise bâtie ∩
disque autour d'un `place` de classe `city`/`town`, moins le vert urbain), en
sol nu dans la carte des matières et en couverture dans celle des cultures.

Son rang dans l'ordre de peinture **est** la règle des parcs :

    landuse (occupation) → pavement → vert urbain → landcover

Elle recouvre le 66 % d'herbe d'un quartier d'habitation, et se fait recouvrir
par tout ce qui décrit du vert — cimetière, stade et terrain de jeu au troisième
temps, parc, bois et prairie par `landcover`. Le vert est en outre **retiré en
trous** au moment de peindre le revêtement, et pas seulement recouvert après :
sinon la couverture resterait sous le parc, et le parc se peindrait en dalle.

Un village n'est donc jamais pavé : sans `place` de rang urbain dans la fenêtre,
la passe ne pose rien.

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

### `park` — **pas lue**, et le nom est un piège

La couche `park` ne contient aucun parc de ville. Au schéma OpenMapTiles elle
porte `boundary=protected_area`, `boundary=national_park`,
`boundary=aboriginal_lands`, `leisure=nature_reserve` et quelques
`historic=*` : des **périmètres de protection**, souvent immenses — Natura 2000
couvre presque tout le littoral français, la Camargue, les Landes, la plupart
des massifs.

Elle était lue, rendue en herbe, peinte **en dernier par-dessus tout le
reste**, et son passage **effaçait** la couverture en dessous. Tout ce qui
était classé finissait donc en prairie dès qu'il tombait dans un périmètre
protégé : un cordon dunaire, un marais, une lande, une forêt de parc naturel
régional. C'est la raison pour laquelle on ne voyait de sable nulle part.

Un périmètre juridique ne dit rien de la matière du sol : la couche n'est plus
parcourue. Le parc de ville, lui, n'est pas perdu — `leisure=park`, `garden`,
`village_green`, `recreation_ground` et `golf_course` sont rangés par le schéma
dans `landcover`, classe `grass`.

Source : [schéma `park`](https://github.com/openmaptiles/openmaptiles/blob/master/layers/park/park.yaml),
[correspondance des tags](https://github.com/openmaptiles/openmaptiles/blob/master/layers/park/mapping.yaml).

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

1. **Là où la donnée se tait, c'est de l'herbe.** `unclassified` vaut `grass`
   partout, quel que soit le pays. C'est le pari gagnant en rase
   campagne européenne ; c'est aussi la raison pour laquelle **un désert non
   cartographié est une prairie**. Le climat (`soilWashFor`) ne fait ensuite que
   jaunir cette herbe — en `arid` elle devient olive et clairsemée, jamais du
   sable — et la grille climatique **s'arrête à l'Europe** : hors fenêtre, le
   Sahara est peint avec l'albédo d'herbe d'une prairie normande.
   Un désert n'existe donc aujourd'hui que là où OSM a tracé un `natural=sand`.
2. **La glace n'a pas de matière.** `ice`, `glacier`, `ice_shelf` tombent en
   sol nu : un glacier est peint comme du gravier gris. `SURFACE_KINDS` n'a ni
   `snow` ni `ice` — et depuis la fusion, les ajouter n'est plus qu'une ligne
   dans la liste et une dans `SURFACE_LOOK`.
3. **Un marais n'a pas d'eau.** La couverture `wetland` existe, avec sa couleur
   et sa roselière haute, mais rien ne rend le **film d'eau** entre les touffes.
   Toutes les sous-classes (`bog`, `marsh`, `swamp`, `saltmarsh`, `fen`…) sont
   confondues, alors que le `swamp` est un marais **boisé**.
4. **Une plage n'a pas de laisse de mer.** Le sable est géré de bout en bout
   (matière, couleur, quasi-absence d'herbe), et il est mouillé au contact de
   l'eau (voir « la rive »), mais cette bande ne tient qu'un carreau : elle ne
   rend pas l'estran d'une grande plage, qui court sur des dizaines de mètres
   — il y faudrait une distance à l'eau que la carte ne porte pas. Rien ne
   distingue non plus la plage, la dune et le sable de désert.
5. **`landuse` ignoré** : `military`, `school`, `university`, `college`,
   `kindergarten`, `hospital`, `track`, `dam`. Ils retombent donc sur l'herbe de
   repli — ce qui est plausible pour une école, moins pour un barrage.
6. **Aucune couverture ne vient de `landuse`.** Une saline (`salt_pond`), une
   tourbière exploitée ou une piste ne peuvent pas être décrites aujourd'hui.
   `pavement` fait exception et n'en est pas une : elle ne vient d'aucune
   entité, elle est déduite du masque urbain.
7. **La ville est un disque, pas un contour.** Sa portée se tire d'un point
   `place`, seule chose que la donnée dise du rang d'une agglomération : une
   banlieue loin du point nommé n'est pas pavée, et un quartier dense d'un gros
   bourg non plus.

## Comment vérifier ce que la donnée dit, sans deviner

Dans la démo, cocher **« étiquettes »**. `collectPlaceLabels` parcourt les
emprises `landcover` et `landuse` dans un rayon de 260 m et les nomme telles
qu'elles arrivent : une étiquette « sable » signifie qu'une entité de classe
`sand` est bien là, et donc que si le sol n'a pas la couleur du sable, le
défaut est chez nous. Pas d'étiquette : la donnée ne dit rien à cet endroit, et
c'est le repli en herbe qu'on voit.

## Le pas de la carte

2,7 m par pixel. C'est la limite dure de tout contour, et sans précaution elle
se lit à l'écran comme un escalier à 45° — la marche du carreau — dès que deux
surfaces contrastent : le sable et l'herbe, l'eau et n'importe quoi. Les
matières la masquent par le filtrage linéaire de leur carte ; les identifiants
(culture, couverture) ne le peuvent pas, puisqu'interpoler un identifiant
inventerait une matière entre deux.

Trois choses la traitent, toutes dans `terrainMaterial.js` :

1. **L'appartenance s'interpole, l'identifiant non** (`surfaceAt`). Les quatre
   carreaux voisins sont lus au plus proche — chacun rend donc la couverture
   peinte et rien d'autre — et ce sont ces appartenances qu'on mélange. Le
   sable rejoint l'herbe par une rampe d'un carreau, comme les matières le font
   déjà ; l'eau suit la même mécanique, sa part étant tenue à part du mélange.
2. **La frange** (`edgeWarp`, thème `edgeWarpM`). Le sol est lu quelques mètres
   à côté du point demandé, d'un déplacement continu tiré du bruit de lisière. La limite
   reste où elle est, au mètre près, mais perd l'angle droit du carreau. Ce
   n'est pas un flou : c'est la même limite, déformée. L'herbe instanciée fait
   de même de son côté (`fringeOffset`, dans `groundCover.js`), avec son propre
   tirage : les deux ne suivent pas la même limite, elles la brouillent sur la
   même largeur.
3. **La rive** (thème `shoreWet`). Le sol au contact de l'eau est mouillé — plus
   sombre, plus saturé, du même film d'eau que la pluie y met. Une berge cesse
   d'être une découpe entre deux couleurs.

Ce qui reste, et qui demanderait une carte peinte avec son antialiasing : le
contour passe par les centres des carreaux, il ne retrouve pas la position
exacte du polygone à l'intérieur de l'un d'eux.
