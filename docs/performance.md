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

Les falaises ne republient pas leur index et leur géométrie si les tracés,
le repère, l'échelle verticale et le DEM n'ont pas changé. L’herbe conserve les instances
des mailles communes à deux fenêtres ; les arbres proches et les fleurs
conservent aussi leurs emplacements. Seuls les ajouts et les trous comblés
lors des retraits sont transférés au GPU. Les cultures recopient leurs
cellules communes. Les caches sont invalidés par un changement de repère,
de surface ou d’emprise routière.

Le partage des largeurs de chaussée (`roadWidths`) consulte les surfaces de
carrefour de tout le réseau lu, pas de la seule portée. Elles ne dépendent
pas de l'observateur : `WidthAreasMemo` les garde d'une reconstruction à
l'autre tant que les lignes lues sont les mêmes, et elles ne sont refaites
qu'à l'arrivée de nouvelles tuiles.

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

Le tapis dense utilise neuf brins à trois triangles par maille (27 triangles),
sans ombres projetées. Sur un plan intégralement herbeux, sa fenêtre et sa
réserve représentent environ 47 000 mailles, soit 1,27 million de triangles,
auxquels s'ajoutent les fleurs. La portée visible est limitée à 55 m.
Arbres et buissons restent en volume, rangés par bloc de 250 m pour
l'élimination hors champ. Au-delà de 600 puis 1000 m du point le plus proche
du bloc, deux prototypes simplifiés reprennent les sommets des mêmes lobes ;
une marge de 60 m empêche les bascules répétées. Positions, couleurs, matrices
et densités restent identiques. Sous 500 m, le prototype complet est garanti.
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

`node scripts/benchmark-instances.mjs` mesure quarante déplacements de 9 m
sur un terrain CPU fixe, après chauffe, et compte les octets d’attributs
marqués pour transfert. Un chemin de module optionnel permet de comparer
un autre état avec le même thème. Relevé local : 47 232 instances dans les
deux états ; médiane CPU de 31,55 ms à 11,31 ms et transferts d’herbe de
10 200 000 à 1 096 269 octets en moyenne par déplacement. Les temps dépendent
de la machine et de sa charge ; les octets ne mesurent pas le temps GPU.

Le contrôle `/test/browser/plant-support.html`, servi par le serveur de démo,
compare numériquement les appuis directs et préparés, sur les deux triangles,
plusieurs distances, changements de relief et de paramètres : 144 points
comparés. Il vérifie les calculs GPU sans évaluer le paysage.

Le relief lointain (`terrain/farRelief.js`) se recale quand la tuile centrale
de la bulle change ou qu'une de ses tuiles vient d'être maillée, jamais par
image. Sur le banc `demo/lab/far.html`, la lecture des 58 081 altitudes prend
4 à 7 ms et le maillage (111 000 triangles, un seul appel de dessin) 2 à 8 ms.
Il charge une à quatre tuiles de MNT au zoom 11, et la bulle une marge de MNT
autour de son bloc — jusqu'à cinq tuiles de plus au zoom 14 — pour que les
normales de son bord, que le brouillard ne cache plus, soient justes.
