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
| B | à la peinture, **signature** de la matière — voir « le bord d'un tracé ment » ; une fois réparée, **distance au trait** le plus proche (`surfaceContours.js`) |
| alpha | à la peinture, toujours plein — le fond est peint, pas effacé ; une fois réparée, matière **d'en face** + 1 (0 : aucun trait à portée) |

Filtrage au plus proche : ce sont des identifiants, et interpoler un
identifiant inventerait une matière entre deux (entre le sable et l'eau, il n'y
a rien). Ce qui s'interpole est la distance au trait, signée par la matière
(voir « le pas de la carte ») ; côté CPU, `shareOf` mélange les appartenances
des quatre texels voisins.

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
qu'une liste de matières — et trente et une tiennent dans le canal, ce
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
| `wetland` | herbe | `wetland` | **la plus haute du décor** (×1,4), roselière, 30 % d'eau libre |
| `wetland` + `saltmarsh` | herbe | `saltmarsh` | rase, gris-vert, 0,12 arbuste, 15 % d'eau libre |
| `wetland` + `tidalflat` | sol nu | `mud` | rien, 35 % d'eau libre |
| `rock` + `scree` | sol nu | `scree` | quasi rien |
| `rock` (autre) | sol nu | `rock` | quasi rien |
| `sand` | sol nu | `sand` | quasi rien (0,08) |
| `ice`, `subclass` `glacier`/`ice_shelf` | sol nu | `ice` | rien |

### `landuse` — qui occupe le sol

| `class` | matière |
| --- | --- |
| `residential`, `suburb`, `neighbourhood`, `quarter` | 66 % herbe, le reste minéral |
| `cemetery`, `pitch`, `playground`, `stadium` | herbe |
| `industrial`, `commercial`, `retail`, `railway`, `quarry`, `construction`, `parking`, `garages`, `bus_station`, `dam` | sol nu |
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
  piscines et les tunnels. Un polygone `intermittent` — un étang qui s'assèche,
  une lagune de Camargue — est peint en vasière (`mud`), et l'eau permanente
  est peinte après lui ;
- les **traits** de la couche `waterway`, élargis par la largeur de thème
  (`WATERWAY_CLASSES` : rivière 9 m, canal 6 m, ruisseau 3 m, drain 1,6 m,
  fossé 1,2 m). Un cours d'eau souterrain ou intermittent n'a pas de surface.
  Le lit d'une rivière, d'un canal et d'un ruisseau reçoit de part et d'autre
  une **ripisylve** de 7 m, peinte en bois et plantée comme une vraie forêt.

  Le fossé et le drain n'en ont pas (`BARE_WATERWAY_CLASSES`) : ce sont des
  traits creusés — en bord de champ, en bord de route — et non des cours d'eau
  bordés d'arbres. L'ourlet leur plantait quinze mètres de bois le long de la
  moindre chaussée assainie, le fossé d'une route étant très souvent un
  `waterway=drain` dans OSM. Leur lit reste, lui : c'est un fait de la carte.

  Attention : un trait plus étroit qu'un texel ne peut pas être rasterisé
  proprement. Le drain (1,6 m) et le fossé (1,2 m) couvrent moins de la moitié
  des texels qu'ils traversent, et se rendent donc en **pointillé** plutôt qu'en
  trait continu. Les faire disparaître (les retirer de `WATERWAY_CLASSES`) ou
  leur donner une largeur plancher d'un texel sont deux décisions d'auteur,
  pas des correctifs.

### L'eau qui affleure — marais, pré salé, vasière

Trois matières portent une part d'eau libre (`standingWater`, dans
`SURFACE_LOOK`) : le marais 30 %, la vasière 35 %, le pré salé 15 %. Le shader
de terrain y découpe des flaques — un bruit tranché à cette part — qui prennent
le rendu de l'eau, rides et rive comprises.

Le bruit est la différence de deux lectures de la texture macro, à deux échelles
incommensurables (`poolScaleM`, et 1,618 fois plus), axes permutés : symétrique
autour de sa moyenne, sans période lisible. Étiré d'un facteur 1,25, la part
mouillée mesurée sur ce bruit suit la part demandée à six points près entre 5 et
90 %. Ces constantes (l'étirement, le rapport d'échelle, la largeur du fondu)
sont partagées avec le shader — `POOL_NOISE_STRETCH`, `POOL_SCALE_RATIO`,
`POOL_EDGE_SOFTNESS` dans `groundClassMap.js` — pour qu'aucune des deux
lectures ne puisse dériver de l'autre.

**Le shader n'est plus le seul à voir les flaques.** `poolShareAt`
(`groundClassMap.js`) relit le même champ de bruit côté CPU, sur le même
calcul : `groundCover` et `vegetationLayer` s'en servent pour refuser de semer
une touffe ou un fourré au milieu d'une flaque, et pour border l'eau plus haut
et plus dense sur les derniers mètres avant elle (`poolEdgeGain`) — une
roselière borde l'eau plutôt que de la recouvrir. Ce que cette lecture ne fait
pas, en revanche : suivre le shader jusqu'au mip. La texture que la carte
graphique filtre et mipmappe lisse le bruit à distance ; la lecture CPU reste
toujours au premier niveau. Les deux ne coïncident donc qu'à courte distance —
c'est la limite suivante, vue de l'autre côté :

- **les flaques rétrécissent avec la distance, pour le shader seul.** Le mip
  lisse le bruit, ses écarts se resserrent autour de la moyenne, et le seuil
  d'une part inférieure à la moitié n'est plus atteint : un marais très
  lointain est peint sans eau à l'écran, quand bien même `poolShareAt`, lui,
  la voit toujours.

### L'eau d'une culture — la rizière

Un second axe, indépendant des matières : `standingWater` ne décrit qu'une
couverture, une culture peut porter sa propre lame d'eau
(`cropStandingWater`, dans le thème). Seul le riz en a une aujourd'hui — une
lame franche, assez haute pour se voir entre les rangs — et elle remplace
celle de `farmland` au même texel, sur le même principe de substitution que
l'albédo de la culture : un tableau d'uniformes de plus (`uCropWater`), pas un
canal de plus dans la carte des matières.

## Ce qui n'est pas lu, et ce que ça donne à l'écran

Ce sont des manques constatés dans le code, pas des jugements sur le rendu.

1. **Là où la donnée se tait, c'est le pays qui remplit.** La matrice du
   dossier de région (`surfaceForMatrix`) décide de la matière ; `unclassified`
   vaut `grass` et ne sert plus que de repli au thème. Hors des régions
   couvertes la question ne se pose plus : le décor s'éteint. **À l'intérieur
   d'une région, en revanche, la matrice est le seul recours** — un désert que
   la carte ne trace pas n'existe que si la matrice le dit.
   Une matrice boisée (`plantedSurfaceForMatrix`) ne passe pas par ce repli :
   la carte du sol la peint elle-même dans ses trous, pour que la végétation y
   plante de vrais arbres. Elle s'arrête au-dessus de `PLANTED_CEILING_M`
   (2000 m), dans les emprises habitées et à `PLANTED_BUILDING_CLEARANCE_M`
   (15 m) de chaque bâtiment ; ces trous-là prennent le repli du thème.
2. **Un marais n'a qu'une forme.** Les tuiles servies ne transmettent presque
   jamais la sous-classe d'une zone humide. Relevé au z14 sur la Camargue, la
   Brière, le lac de Grand-Lieu, la baie de l'Aiguillon, le delta du Danube, le
   Pripiat, les Everglades, les mangroves de Floride, les Sundarbans et le Flow
   Country : tout arrive en `wetland`, sauf quelques `saltmarsh` en Camargue.
   Un marais boisé (`swamp`, `mangrove`) est donc peint comme une roselière,
   sans arbres, et une saline (`saltern`) comme un marais.
3. **Une plage n'a pas de laisse de mer.** Le sable est géré de bout en bout
   (matière, couleur, quasi-absence d'herbe), et il est mouillé au contact de
   l'eau (voir « la rive »), mais cette bande ne tient qu'un carreau : elle ne
   rend pas l'estran d'une grande plage, qui court sur des dizaines de mètres
   — il y faudrait une distance à l'eau que la carte ne porte pas. Rien ne
   distingue non plus la plage, la dune et le sable de désert.
4. **`landuse` en partie ignoré** : `school`, `education`, `university`,
   `college`, `kindergarten`, `library`, `hospital`, `military`, `theme_park`,
   `zoo`, `track`. Ce sont des emprises qui mêlent pelouses, bois et bâti :
   `landcover` y dit ce qui pousse, et là où il se tait c'est l'herbe de repli.
5. **Aucune couverture ne vient de `landuse`.** Une saline (`salt_pond`), une
   tourbière exploitée ou une piste ne peuvent pas être décrites aujourd'hui.
   `pavement` fait exception et n'en est pas une : elle ne vient d'aucune
   entité, elle est déduite du masque urbain.
6. **La ville est un disque, pas un contour.** Sa portée se tire d'un point
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

2,7 m par pixel. C'est la limite dure de tout contour, et lue telle quelle elle
se voit comme un escalier — la marche du carreau — dès que deux surfaces
contrastent. Aucun filtre ne le redresse : la carte ne dit pas où passe le
polygone dans un texel, et un noyau, si large soit-il, ne fait qu'arrondir les
marches. Les limites sont donc **redessinées en traits**, puis seulement
cassées en segments. Cinq étapes, dans trois fichiers :

1. **Le contour tombe au bon demi-texel** (`repairSurfaceEdges`, dans
   `groundClassMap.js`). Le lissage du canevas est défait après coup, et le
   seuil de reprise est celui de la couverture : un texel couvert à plus de la
   moitié par une matière la prend.
2. **L'escalier redevient un trait** (`surfaceContours.js`). Les arêtes entre
   deux matières (deux cultures comptent pour deux matières) sont chaînées
   d'une jonction à l'autre, simplifiées par Douglas-Peucker à un texel près,
   et chaque morceau est réajusté par moindres carrés sur ses points : une
   droite rasterisée redevient la droite, à un dixième de texel près ; un coin
   de parcelle reste vif ; les virages doux sont arrondis. Un coin en damier
   laisse passer en diagonale la matière la plus rare alentour, pour qu'un
   filet d'eau d'un texel ne se coupe pas à chaque marche. Chaque texel proche
   d'un trait reçoit sa distance au trait (bleu) et la matière d'en face
   (alpha), et prend la matière du côté où tombe son centre.
3. **La distance signée s'interpole** (`surfaceAt`, dans `terrainMaterial.js`),
   sur seize texels par une cubique de Catmull-Rom. Elle reproduit exactement
   une fonction linéaire, donc un trait droit ; et contrairement au bilinéaire,
   elle garde continu un filet d'un texel qui ne se touche que par les coins.
4. **Le trait est cassé en segments** (`edgeWarp`, même fichier). La lecture de
   la carte est déplacée par un champ de vecteurs linéaire par triangle, sur un
   réseau fixe au monde : un trait droit le reste dans chaque triangle et casse
   à chaque arête, soit un sommet tous les `edgeStepM` (2 m) écarté d'au plus
   `edgeJitterM` (50 cm) — thème, `terrain`. Les deux berges d'un ruisseau
   bougent ensemble : sa largeur reste.
5. **Le contour est tranché, pas fondu**, sur la largeur d'un pixel d'écran
   (`fwidth`) ; et **la rive** (thème `shoreWet`) mouille le sol au contact de
   l'eau, du même film d'eau que la pluie.

L'herbe instanciée, elle, ne lit pas ce contour : chaque maille lit le sol à
quelques mètres d'elle-même (`fringeOffset`, thème `edgeWarpM`, dans
`groundCover.js`), et au bord une maille sur deux lit l'autre surface. Ce sont
les petits points d'une lisière, et ils n'obéissent pas à la peinture. La
végétation et `shareOf` lisent la carte au texel : ils suivent le trait à un
demi-texel près, sans ses segments.

Ce qui reste hors d'atteinte : un trait plus étroit qu'un demi-texel disparaît
dès la réparation (un fossé de 1,2 m n'est peint que là où il couvre la moitié
d'un texel), et un détail de moins d'un texel le long d'une limite est gommé
par la simplification.

### Couverture proche et transitions

L'herbe proche est une trame sans texture : neuf brins fins à trois triangles
occupent toute la surface d'une maille, sans pied commun. Leur couleur est
uniforme sur la hauteur (`theme.grass.bladeColors.root`) ; `bladeWidth` règle
leur largeur relative et `bladeBend` leur courbure. Chaque racine suit le
triangle effectivement chargé sous elle, coutures et déblais compris. Les
corrections individuelles sont conservées dans le cache des mailles. Une
reconstruction du terrain invalide les appuis, même sans déplacement.
Les surfaces `settled` et `pavement` ont un grain géométrique nul : le bâti
lit une altitude sans bosse, et une bosse y enterrerait son rez-de-chaussée.
Les autres matières et la roche de pente conservent leur grain GPU ; cet
appui CPU ne mesure pas cette déformation supplémentaire.
L’éclairage des brins utilise la verticale du monde transformée dans
l’espace de la caméra, comme les normales du matériau Lambert.
Le sol porte la continuité verte jusqu'à l'horizon ; les brins s'effacent
entre 35 et 55 mètres. Les fleurs blanches, jaunes et les coquelicots sont
rendus séparément, avec les mêmes règles de présence, de sol et d'exclusion.
Leurs couleurs se règlent dans `theme.grass.flowers`.

La référence visuelle vient du [fil BOTW fourni](https://www.reddit.com/r/howdidtheycodeit/comments/dshc03/how_does_botw_render_the_grass/).
Le [tutoriel de Roystan](https://roystan.net/articles/grass-shader/) qui y est
cité détaille les brins courbés et leur répartition ; il ne documente pas
l'implémentation de Nintendo. Ici, la géométrie est instanciée avec Three.js,
sans geometry shader ni tessellation dynamique.

Les cultures conservent leurs atlas spécifiques. Le semis de chaque bande
est chargé avec une réserve autour de la portée visible. Le fondu est
calculé à chaque image depuis la position de l'observateur : ni la taille
nominale ni la présence d'un candidat ne dépendent de ce fondu. Le découpage
tramé est ancré à la surface, sans transparence triée.


### Terrain des franchissements

`transportCrossings` décide des profils avant les maillages. Les tranchées
ferroviaires restent locales aux ponts routiers ; leurs raccords préservent
les passages à niveau. Les routes inférieures peuvent être creusées ; sur une
autoroute isolée, le dégagement est partagé avec un remblai des accès supérieurs.
Deux carrefours atteints à moins de 100 m le long du réseau supérieur font
privilégier le déblai inférieur. Les rivières n'imposent aucune surélévation.

`transportEarthworks` déforme la maille commune et conserve les matières du
lieu. Le remblai se raccorde doucement au relief ; la tranchée a une rive plus
franche. Le fond plat tient compte de la résolution de la maille, comme le
déblai routier. Une route voisine conserve un appui dans ce terrain : la
tranchée ne la déchausse pas. Une branche qui rejoint une culée se raccorde au
tablier ; elle ne compte pas comme passage inférieur. Les chemins lisent le terrain final sans le terrasser. Les
mailles sont reconstruites avant le décor et les plantations sont reprises
après modification, afin de ne pas conserver les anciennes altitudes.

### Tunnels et accès

`transportTunnels` distingue les passages courts dans une emprise bâtie, les
passages inférieurs courts sous une chaussée ou un rail, et les galeries sous
le relief. La longueur seule ne transforme pas un tunnel en franchissement.
Le sens dessus/dessous reste celui de la donnée. Les passages inférieurs ont
un plafond plat ; les galeries conservent leur voûte. Les bâtiments traversés
ne déclenchent pas de tranchée.

La couverture se mesure sur le terrain naturel. Si elle manque, la plateforme
et ses accès sont abaissés ensemble, avec un raccord progressif. Les passages
courts utilisent un raccord plus resserré que les galeries longues. Un tunnel
ancre le profil de la voie ferrée qui le surplombe : une tranchée voisine ne
peut s’y prolonger. Le terrain
reste au-dessus de la galerie ; l'excavation des accès s'arrête à son seuil.
Les remblais et déblais intégrés ne reçoivent pas un second relief décoratif.

Deux tunnels proches partagent une enveloppe si leurs tracés sont parallèles,
leurs entrées concordent et leurs niveaux sont compatibles. Les chaussées ne
fusionnent pas : seuls la voûte, les portails et l'éclairage sont communs.
Une galerie courbe, incomplète dans les tuiles chargées, ou à un autre niveau
reste indépendante. Les passages bâtis n'ont pas d'éclairage ; ailleurs, une
marge d'un espacement de lampe reste libre à chaque entrée.

### Coutures des chaussées et des portails

Le carrefour publie une triangulation commune au rendu, à la lecture des
altitudes et au déblai. Un contour concave que le nœud ne voit pas entièrement
est triangulé par découpage en oreilles, en conservant ses arêtes ; les autres
carrefours gardent leur éventail et les giratoires leur couronne. Un contour
dégénéré que le découpage ne termine pas conserve un éventail complet ; la
réparation topologique des contours auto-croisés reste distincte. Les rubans
adoptent l’altitude de cette surface à leur point de raccord, y compris quand
ils atteignent un bord entre deux bouches.

Le dégagement devant un portail reçoit des parois découpées contre les
triangles du terrain affiché. Leur limite suit l’intersection géométrique des
surfaces ; les parties au-dessus du sol sont retirées. Le plancher ferme le
bas de l’ouverture. Ce raccord ne dépend pas d’un pas de sondage du relief.

Référence pour la triangulation : David Eberly,
[Triangulation by Ear Clipping](https://www.geometrictools.com/Documentation/TriangulationByEarClipping.pdf).
Le découpage des parois procède par demi-plans successifs, selon le principe
de Sutherland–Hodgman.
