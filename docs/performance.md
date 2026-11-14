# Mesurer la génération

Dans la démo, cocher **Mesures de performance** affiche les temps CPU par
couche (dernier appel et maximum), les appels de rendu, les triangles et le
nombre de ressources Three.js. Le panneau ne mesure pas le temps GPU.
Dans une application :

```js
world.setProfiling(true);
console.table(world.generationStats);
world.resetGenerationStats();
```

Le profilage est désactivé par défaut et sa mémoire est bornée par le nombre
de couches. `node scripts/benchmark-terrain.mjs` mesure hors navigateur une
tuile de 192 × 192 mailles, reconstruite douze fois sur un DEM fixe.

Les cinq relevés DEM par sommet (altitude et gradient) sont conservés tant
que la résolution, les coutures et la révision du DEM restent identiques.
Une reconstruction du déblai recalcule le déblai, pas les relevés inchangés.
Les buffers GPU de même taille sont réutilisés. Le cache est libéré avec la
tuile ; une source d'altitude externe sans `revision` ne l'utilise pas.

L’herbe conserve les instances
des mailles communes à deux fenêtres ; les arbres proches et les fleurs
conservent aussi leurs emplacements. Seuls les ajouts et les trous comblés
lors des retraits sont transférés au GPU. Les cultures recopient leurs
cellules communes. Les caches sont invalidés par un changement de repère,
de surface ou d’emprise routière.

Le partage des largeurs de chaussée (`roadWidths`) écarte les abords d'un
carrefour par un disque autour de son nœud, pas par sa surface dessinée : il
ne construit aucune surface de carrefour sur le réseau lu, et son résultat ne
dépend ni de l'observateur ni des carrefours voisins.

Mesure locale de référence du banc : médiane chaude autour de 41 ms avant
cache, autour de 2 ms après, sans changement des 73 728 triangles. Les
lectures DEM passent de 2 239 548 à 186 629 sur les douze reconstructions.
Cette mesure concerne le terrain CPU et ne prédit pas le gain de FPS global.
Le premier calcul reste autour de 80 ms sur cette machine.

Le profilage navigateur montre aussi des appels lourds de routes, bâtiments
et mobilier lors d'une reconstruction complète. Leurs temps doivent être
mesurés sur les parcours et appareils cibles ; le cache DEM ne les supprime
pas. Vérifier les images lentes et la mémoire pendant une session longue,
pas seulement les FPS moyens à l'arrêt.

Arbres et buissons restent en volume, rangés par bloc (huit par côté de tuile,
environ 105 m à 47°, six pour les arbres plantés) pour l'élimination hors
champ. Au-delà de 150 puis 280 m du point le plus proche
du bloc (`VEGETATION_DETAIL_M`), deux prototypes simplifiés reprennent les
sommets des mêmes lobes ; une marge de 20 m empêche les bascules répétées.
Positions, couleurs, matrices et densités restent identiques.
Le bouton **Comparer les maillages** du banc de forêt compare volume complet
et détail automatique à cadrage identique ; `?view=haut` prend de la hauteur. Une forêt pleine (neuf tuiles de bois plein, peuplement et sous-étage) sème
environ 390 000 plantes, dont 132 478 instances visibles pour la couche après
éclaircie, avant élimination exacte par la caméra. Le banc
`demo/lab/forest.html?view=haut` compte 10 668 984 triangles avec les volumes
complets, 9 037 116 avec le détail automatique, dans les deux cas 467 appels.
Ces compteurs incluent les ombres et ne prédisent pas les FPS sur téléphone.
Le semis
d'une telle tuile coûte 20 à 40 ms, étalés par étapes de quelques
millisecondes. Les lanternes utilisent deux lumières ponctuelles
sans ombres. Le coût GPU est à contrôler sur les appareils cibles, il n'est
pas couvert par le banc CPU du terrain.

Les neuf corrections de racine occupent 36 octets par maille dans les attributs
GPU, soit 2,7 Mo pour la capacité de 75 000 mailles, plus leur cache CPU.
Elles ne sont sondées sur le CPU que pour le repli hors atlas : une racine
entièrement couverte est déjà recalée par le shader.

L’atlas des plantes porte les positions/normales du terrain (32 octets par
sommet). Une passe GPU prépare les déformations indépendantes de la caméra
(16 octets supplémentaires par sommet, avec arrondi aux lignes de texture).
Le shader des plantes lit ces déformations et applique encore le fondu de
distance à chaque image. Il ne recalcule plus le bruit pour chaque sommet
de chaque brin. La préparation est invalidée par le terrain, les paramètres
de grain, la carte du sol ou le repère. Sans cible flottante disponible, le
calcul direct reste utilisé. Les ressources sont libérées avec l’atlas.

La reconstruction vectorielle se fait d'un bloc, toutes couches ensemble, à
chaque pas de 250 m de l'observateur ou à l'arrivée de données nouvelles
(`core/decorReach.js`). En ville, le rayon du détail est borné par un budget
de murs bâtis (60 km) et le pas de relève se resserre avec lui : le coût d'une
reconstruction suit la densité du lieu, pas sa seule étendue. Une tentative de téléchargement sans nouvelle donnée
ne relance pas la génération. Le compositeur cède après un
budget CPU de 8 ms, entre couches et entre étapes des routes, bâtiments et
familles de mobilier. Les étapes publient les maillages à la fin de leur
couche ; les semis par image attendent la fin de la génération.
Les couches gardent aussi leur méthode synchrone `rebuild`.
Le budget est un seuil de cession, pas une durée maximale garantie : la
collecte/décodage des entités, le graphe routier ou une famille de mobilier
peuvent encore le dépasser. Un recentrage attend la reconstruction en cours ;
une destruction interrompt les étapes restantes.

Pour un relevé reproductible, ouvrir la démo avec `?mesure=1`. L’heure est
fixée à 13 h le 21 juin 2026 : cinq secondes de chauffe, dix secondes immobile,
quinze secondes vers l’est à 22 m/s, puis une reconstruction forcée. Les lignes
`[worldpaint mesure]` de la console indiquent médiane, p95, maximum, images de
plus de 50 ms, temps JS, triangles et mesures par couche. Les compteurs
`routesEtape`, `batimentsEtape` et `mobilierEtape` mesurent les morceaux CPU,
sans inclure les pauses ; les compteurs de couche additionnent ces morceaux.
Une pause de plus d’une seconde invalide le relevé. Garder l’onglet actif et
ne pas naviguer pendant la mesure. Ce parcours ne remplace pas un essai sur
iPhone et ne constitue pas une mesure du temps GPU.

Le relief lointain (`terrain/farRelief.js`) se recale quand la tuile centrale
de la bulle change ou qu'une de ses tuiles vient d'être maillée, jamais par
image. Sur le banc `demo/lab/far.html`, la lecture des 58 081 altitudes prend
4 à 7 ms et le maillage (111 000 triangles, un seul appel de dessin) 2 à 8 ms.
Il charge une à quatre tuiles de MNT au zoom 11, et la bulle une marge de MNT
autour de son bloc — jusqu'à cinq tuiles de plus au zoom 14 — pour que les
normales de son bord, que le brouillard ne cache plus, soient justes.

Le banc `demo/lab/performance.html?lieu=lyon` détaille les étapes des routes,
du bâti et des familles de mobilier sur les tuiles enregistrées du lieu.
`?lieu=lyon&budget=0` emploie les rayons propres aux couches sans le budget
de murs. `node scripts/benchmark-place.mjs <dossier> lyon courant` conserve
les mesures brutes et les vues prises après chaque reconstruction ; `etendu`
remplace `courant` pour le second scénario. Playwright est requis par le
script, avec `PLAYWRIGHT_MODULE` et `CHROMIUM_PATH` pour une installation
externe ; `SOFTWARE_RENDER=0` emploie le rendu matériel. Le relevé distingue
CPU, pauses, buffers et compteurs de dessin sans mesurer le temps GPU.
Voir [le rapport lyonnais](../reports/lyon/rapport.md) pour les paramètres,
les sous-totaux et les limites de cette mesure.

## Ce qu'une reconstruction alloue

En ville, une reconstruction alloue plusieurs centaines de mégaoctets qui ne
restent pas en scène ; c'est ce volume qui fait le pic du tas. Deux règles :

- **pas d'appel par sommet vers un accumulateur typé.** Un appel non
  incorporé de `GrowingArray.push` emballe ses nombres et ses arguments. Un
  pan, une pièce du catalogue ou un joint se versent d'un seul `pushFrom` par
  attribut (`pushValues`), ou s'écrivent droit dans `data` ;
- **le point de cession ne crée rien tant que le budget tient.**
  `GenerationBudget.checkpoint` rend `undefined` sans attente ; seule la pause
  rend une promesse. Une reconstruction de Lyon compte environ 80 000 étapes.

Mesure : reconstruction forcée de Lyon (rayon 375 m), alternée dans la même
page avec la version précédente, allocations échantillonnées par
`HeapProfiler.startSampling`. Le pic du tas relevé par le banc des trois
coûts varie de plusieurs dizaines de mégaoctets d'une passe à l'autre selon
le moment des collectes : le volume alloué est le chiffre qui se compare.

## Le coût d'une image

`node scripts/frame-bench.mjs --lieu lyon` mesure ce que le GPU dessine depuis
une caméra de poursuite, bulle montée et immobile (`demo/lab/frame.html`), sur
le GPU de la machine : temps d'image par cap, puis, sur le cap le plus cher,
appels et triangles par couche (passe d'ombre à part) et temps gagné en
éteignant chaque couche. Le temps est pris file GPU vidée, par la relecture
d'un pixel : `finish()` ne bloque pas quand le rendu vit dans un autre
processus. Un Mac n'est pas un téléphone : on y lit des proportions.

Trois règles en sortent, à ne pas défaire :

- **Le sol se dessine après ce qui le cache, le ciel en dernier.** La matière
  du sol est la plus chère de l'image, et une rue la couvre presque partout :
  voirie et bâti passent d'abord (`TERRAIN_RENDER_ORDER`), puis le sol, puis le
  dôme (`SKY_RENDER_ORDER`), posé au plan lointain. Le test de profondeur
  écarte alors les pixels cachés avant de les calculer. Une couche opaque
  ajoutée garde un rang inférieur à celui du sol.
- **La carte du sol ne se départage qu'au bord d'un trait.** Quatre texels
  centraux de la même matière, sans trait à portée, donnent la matière sans
  lire les douze autres ni classer quoi que ce soit (`surfaceAt`). Une ville
  est un damier de matières : sans ce raccourci, chaque pixel de sol y payait
  le classement complet, et l'image de Lyon coûtait le double de celle d'une
  campagne. Les tableaux d'uniformes se lisent par indice, jamais par une
  boucle qui compare.
- **Un maillage fusionné se dessine par cases** (`layers/cellMeshes.js`) : le
  bâti et la voirie de rue, quelques centaines de milliers de triangles
  chacun, ne partent au GPU que pour les cases dans le champ, et dans le carré
  de la carte d'ombres.

Relevé de Lyon (Presqu'île, 2560 × 1600, Apple M4 Pro, moyenne de huit caps,
plancher du banc de 2,5 ms compris) : 6,8 → 3,2 ms par image, 1,30 M → 0,79 M
de triangles, dont ceux de la carte d'ombres 331 k → 157 k. L'image rendue est
la même au pixel près, à quelques dizaines de pixels de bord d'arête sur un
million.

`--meteo sec|pluie-legere|forte-pluie|neige|orage` (ou un état en JSON) rejoue
la météo que le jeu envoie, repassée à `updateSky` à chaque image ; le banc
compte alors les fragments de la pluie (`frameLab.fragments('rain')`) et le
temps CPU d'`advance` et d'`updateSky`. La pluie est un seul appel de
quelques milliers de rubans, animés dans le sommet sans tampon réécrit : de
l'ordre de 0,03 fragment par pixel d'écran, autant de temps GPU qu'un dôme de
ciel. L'ombre, elle, coûte sous une pluie ordinaire ce qu'elle coûte par
temps sec (le sixième de l'image de Lyon), alors qu'elle n'y garde que le
tiers de son opacité : elle ne s'éteint qu'au-delà de
`SHADOW_CUTOFF_OVERCAST`, sous un orage.

## Les trois coûts

`node scripts/costs-bench.mjs` mesure ensemble la RAM, la génération initiale
et la fluidité au mouvement, sur un lieu enregistré et dans les conditions de
la démo (`demo/lab/costs.html`). La règle d'emploi est dans `CLAUDE.md`. La
RAM y est lue par le protocole DevTools (`HeapProfiler.collectGarbage` puis
`Runtime.getHeapUsage`) et dans `/proc` pour la PSS des processus ; la
fluidité est le temps du fil principal par image, sur un trajet cadencé par le
banc pour que la trajectoire soit la même d'une version à l'autre.

Les shaders compilent dans le processus GPU, et three.js ne bloque qu'au
premier usage d'un programme (`getProgramInfoLog`). La démo appelle donc
`renderer.compile(scene, camera)` toutes les 200 ms pendant `mountAt` : les
maillages déjà publiés partent compiler pendant que le reste se construit, au
lieu d'attendre la première image. Une application qui monte le monde
derrière un écran de chargement a intérêt à faire de même.

`--cpu 3` ralentit le processeur par le protocole DevTools : la génération y
prend à peu près ce qu'un iPhone en économie d'énergie met à monter le même
lieu. `--near 0` monte la bulle d'un trait au lieu du proche d'abord.

### Le proche d'abord

`setReach(300)` avant `mountAt(lng, lat)` ne bâtit que ce qui tient dans
300 mètres, puis `setReach(null)` et `refresh(lng, lat, { force: true })`
bâtissent le reste comme une relève ordinaire, avec ses pauses : on rend
pendant ce temps. C'est la portée du monde, la même option qu'une scène figée. La démo monte
ainsi à 300 m. Le reste de la bulle coûte plus cher qu'un montage d'un trait
(le proche est bâti deux fois), mais la main est rendue bien plus tôt.

La bulle élargie n'est pas identique à la bulle montée d'un trait :
`RoadContinuity` garde l'origine des routes déjà vues, et l'élargissement est
pour elle une extension de fenêtre, comme un déplacement. Haies, poteaux et
panneaux le long des routes peuvent donc se poser un peu autrement.

### Ce qui pèse sur un téléphone

- **Le GPU.** Une campagne compte plus de quatre millions de triangles, dont
  plus d'un million projette une ombre et se dessine donc deux fois. La démo
  abaisse sa résolution quand la médiane des intervalles entre images passe
  40 ms, puis ne refait la carte d'ombres qu'une image sur deux. Safari
  plafonne à 30 images/s en économie d'énergie : 33 ms n'y est pas un échec.
- **La mémoire.** Safari ferme un onglet WebGL qui dépasse sa limite, sans
  `webglcontextlost` ni erreur. Les maillages fusionnés qu'on ne relit plus
  (bâti, voirie, mobilier linéaire) sont resserrés (`facetBuffers.js`) et
  leur copie côté page est rendue après l'envoi au GPU.

### Le niveau économe (`detail.level`)

`detail: { level: 'light' }` allège l'image pour un appareil sur batterie ;
`'full'`, le défaut, rend exactement la même géométrie et les mêmes
programmes que sans l'option. Le niveau économe ne sème ni ne pose rien
d'autre, il dessine moins des mêmes objets :

- les arbres basculent vers leurs prototypes simplifiés à 60 puis 120 m
  (`VEGETATION_DETAIL_LIGHT_M`), passe d'ombre comprise ;
- le sous-étage est complet jusqu'à 90 m et éteint à 150 m
  (`UNDERSTORY_LIGHT_M`) : la même éclaircie par poids, donc un sous-ensemble
  du sous-étage complet ;
- les nuages ne calculent que trois octaves de bruit sur cinq
  (`CLOUD_OCTAVES_LIGHT`), à chaque pixel de ciel.

Le niveau se choisit à la création du monde : les seuils sont écrits dans les
shaders du sous-étage et du ciel.

Relevé `node scripts/frame-bench.mjs --lieu <lieu> --niveau full|light
--detail 375 --dpr 2 --ombre 1024 --taille 393x852 --caps 8 --sans-ablation`
(Apple M4 Pro, plancher du banc compris, moyenne des huit caps, cinq ou six
passes alternées) :

| Lieu | niveau | image (ms, médiane des passes) | triangles | appels |
| --- | --- | ---: | ---: | ---: |
| station-montreuil-bellay (campagne) | full | 2,23–3,31 (méd. 2,69) | 601 k | 121,5 |
| | light | 2,15–2,96 (méd. 2,39) | 588 k | 121,5 |
| saint-gervais (forêt, montagne) | full | 2,96–4,51 (méd. 3,15) | 905 k | 203,0 |
| | light | 2,90–4,07 (méd. 3,23) | 712 k | 191,5 |

Sur le cap le plus chargé de saint-gervais : peuplement 122 k → 64 k
triangles, sous-étage 179 k → 58 k, carte d'ombres 253 k → 182 k.

Sur ce GPU l'écart de temps se perd dans le bruit d'une passe à l'autre :
ce sont les triangles et les appels qu'on lit, le temps reste à relever sur
un téléphone. Le ciel ne se voit pas dans ces compteurs : son coût suit le
nombre de pixels de ciel (au banc, en campagne, cinq octaves → trois rendent
0,1 à 0,2 ms sur 4,2 à densité 4). Ce qui pèse le plus reste la densité
d'écran, qui appartient à l'application.

### Les objets dans un rayon fixe (`detail.radius`)

`detail: { radius: 375 }` borne voirie, bâti, mobilier et arbres sans toucher
au terrain, à la carte du sol ni au relief lointain. Relevé du banc des trois
coûts (SwiftShader, `--near 0`, médianes de 2 à 3 passes), bulle complète →
rayon de 375 m :

| Lieu | génération initiale | triangles | appels | tas retenu |
| --- | --- | --- | --- | --- |
| station-montreuil-bellay (campagne) | 7 882 → 6 903 ms | 2,37 M → 1,75 M | 168 → 100 | 28 → 26 Mo |
| saint-gervais (forêt, montagne) | 11 844–12 212 → 6 230–6 485 ms | 15,1 M → 3,3 M | 593 → 146 | 53 → 29 Mo |
| lyon (ville, déjà resserrée par le budget de murs) | 8 533–8 916 → 8 292–8 645 ms | 4,1 M → 1,5 M | 95 → 61 | 45 → 42 Mo |

Fluidité au mouvement (fil principal, campagne) inchangée : p95 11,9 → 12,4 ms,
p99 26,4 → 24,4 ms. Le gain de génération suit ce que le lieu a d'objets au-delà
du rayon (forêts surtout) ; ce qui reste est fixe : pauses de la génération
coopérative (2,2 à 2,8 s), terrain (0,9 s), carte du sol (0,4 s).
