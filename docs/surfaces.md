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
| B | **signature** de la matière — voir « le bord d'un tracé ment » |
| alpha | toujours plein — le fond est peint, pas effacé |

Filtrage au plus proche : ce sont des identifiants, et interpoler un
identifiant inventerait une matière entre deux (entre le sable et l'eau, il n'y
a rien). Le fondu des lisières est reconstruit là où il est lu — le shader et
`shareOf` lisent les **quatre texels voisins** et mélangent leurs
appartenances. Une appartenance, elle, s'interpole.

### Le bord d'un tracé ment, et on le lui reprend

L'alpha plein ne suffit pas. **Le canevas 2D lisse le bord de ses tracés**, et
aucune API ne le débraye : un texel de bord porte `α·A + (1−α)·B`, le mélange
des deux identifiants voisins — et un identifiant mélangé en désigne un
**troisième**. Entre le bois et l'eau, c'est-à-dire tout le long de chaque cours
d'eau (où la ripisylve borde le lit), quatre-vingt-dix pour cent de la rampe
tombe sur une matière absente du lieu : du sable, de la roche, du trottoir, une
lande. Autour d'un lac, c'est douze matières parasites.

C'est ce qui semait des taches claires le long des ruisseaux, les faisait
changer de place à chaque re-rasterisation (la grille se requantifie tous les
400 m) et n'en laissait voir qu'une partie — le shader ne les faisait gagner que
là où son bruit de lisière les favorisait. Ranger les matières voisines côte à
côte dans `SURFACE_KINDS` limite les dégâts entre voisines ; ça ne peut rien
pour l'eau, qui borde tout.

Deux pièces le défont :

1. le canal **bleu** porte une signature de la matière (`SURFACE_SIGNATURES`).
   La table est faite pour qu'**aucun triplet n'y soit aligné** : pour qu'un
   texel de bord se fasse passer pour la matière C, il faudrait que son rouge
   tombe sur celui de C *et* que son bleu tombe en même temps sur la signature
   de C. L'écart minimal est de 8 quand l'arrondi du canevas vaut 1 ; un test le
   vérifie en balayant toutes les couvertures de toutes les paires ;
2. `repairSurfaceEdges`, passée sur la relecture, rend chaque texel non signé à
   la matière dont son rouge est le plus proche — c'est-à-dire à **celle qui
   couvre plus de la moitié de sa surface**. La limite tombe donc au bon
   demi-texel au lieu d'inventer une matière. La carte réparée est renvoyée au
   canevas : le shader lit la texture, la végétation lit la copie, et les deux
   doivent dire la même chose.

Ce que la passe ne rattrape pas : le canal des cultures n'a pas de signature à
lui — il n'y a plus de canal libre — et n'est vérifié que par son pas. Un
mélange de deux cultures sur vingt-huit passe encore au travers, à la seule
limite entre deux parcelles de cultures différentes.

Ajouter une matière demande donc une ligne de plus qu'avant : une signature. Le
test dit sans ambiguïté si la valeur choisie tient.

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
  (`WATERWAY_CLASSES` : rivière 9 m, canal 6 m, ruisseau 3 m). Un cours d'eau
  souterrain ou intermittent n'a pas de surface, et une classe absente du thème
  n'en a pas non plus. Chaque lit reçoit de part et d'autre une **ripisylve**
  de 7 m, peinte en bois et plantée comme une vraie forêt.

  Le drain (1,6 m) et le fossé (1,2 m) y étaient et n'y sont plus : la carte a
  un pas de 2,7 m, ils couvrent donc moins de la moitié des texels qu'ils
  traversent et ne pouvaient se rendre qu'en **pointillé**. Un trait d'eau
  discontinu au milieu d'un champ se voit plus qu'il ne décrit. Le ruisseau
  (3 m) est le plus étroit qui tienne encore.

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

Quatre choses la traitent. La première est dans `groundClassMap.js`, les trois
autres dans `terrainMaterial.js` :

1. **Le contour tombe au bon demi-texel** (`repairSurfaceEdges`). Le lissage du
   canevas est défait après coup, et le seuil de reprise est celui de la
   couverture : un texel couvert à plus de la moitié par une matière la prend.
   C'est la seule des quatre qui déplace la limite plutôt que de la déguiser.
2. **L'appartenance s'interpole, l'identifiant non** (`surfaceAt`). Les quatre
   carreaux voisins sont lus au plus proche — chacun rend donc la couverture
   peinte et rien d'autre — et ce sont ces appartenances qu'on mélange. Le
   sable rejoint l'herbe par une rampe d'un carreau, comme les matières le font
   déjà ; l'eau suit la même mécanique, sa part étant tenue à part du mélange.
3. **La frange** (`edgeWarp`, thème `edgeWarpM`). Le sol est lu quelques mètres
   à côté du point demandé, d'un déplacement continu tiré du bruit de lisière. La limite
   reste où elle est, au mètre près, mais perd l'angle droit du carreau. Ce
   n'est pas un flou : c'est la même limite, déformée. L'herbe instanciée fait
   de même de son côté (`fringeOffset`, dans `groundCover.js`), avec son propre
   tirage : les deux ne suivent pas la même limite, elles la brouillent sur la
   même largeur.
4. **La rive** (thème `shoreWet`). Le sol au contact de l'eau est mouillé — plus
   sombre, plus saturé, du même film d'eau que la pluie y met. Une berge cesse
   d'être une découpe entre deux couleurs.

Ce qui reste : le contour passe par les centres des carreaux, il ne retrouve pas
la position exacte du polygone à l'intérieur de l'un d'eux. La couverture
sous-texel existe pourtant, un instant : c'est **exactement** ce que porte la
valeur d'antialiasing que `repairSurfaceEdges` écrase. La rendre au shader —
α = (rouge − A) / (B − A), les deux voisins étant connus — placerait le contour
au huitième de texel, soit trente centimètres au lieu de deux mètres soixante-
dix, sans supersampling ni seconde rasterisation. Le canal bleu, libéré une fois
la réparation faite, est là où elle irait. Ce n'est pas fait.
