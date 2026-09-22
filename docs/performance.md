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
le repère, l'échelle verticale et le DEM n'ont pas changé. Herbe et cultures
recopient les cellules communes à deux fenêtres ; leur cache est invalidé
par un changement de repère, de surface ou d'emprise routière.

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
