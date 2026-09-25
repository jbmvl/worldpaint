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
Les arbres en volume portent jusqu'à 190 m et les lanternes utilisent deux
lumières ponctuelles sans ombres. Ces réglages privilégient les demandes de
densité et de transition lointaine ; leur coût GPU est à contrôler sur les
appareils cibles, il n'est pas couvert par le banc CPU du terrain.

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

La reconstruction vectorielle respecte les dépendances : du mobilier périmé
seul ne reconstruit pas les chaussées. Une tentative de téléchargement sans
nouvelle donnée ne relance pas la génération. Le compositeur cède après un
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
