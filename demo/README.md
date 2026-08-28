# WorldPaint — démo

Une démo autonome, en three.js pur (pas de framework, pas de build), qui
monte `createWorld` et pilote une caméra volante à la main. C'est la
démo évoquée par la section « Status » du README principal.

## Lancer

```
npm install
npm run demo
```

Puis ouvrir <http://localhost:4173/demo/>.

Un serveur statique est nécessaire (les imports ES modules ne fonctionnent
pas sous `file://`) ; `npm run demo` lance un petit serveur sans dépendance
(`demo/server.mjs`). N'importe quel autre serveur statique servant la racine
du dépôt convient aussi (`npx serve .`, `python3 -m http.server`, …).

`three` est chargé depuis un CDN (jsDelivr) via un `<script type="importmap">`
dans `index.html` — la démo n'a pas de `node_modules/three` à installer.

## Ce que ça montre

- **Navigation clavier en vol libre** : flèches pour avancer/reculer et se
  déplacer sur les côtés, <kbd>Espace</kbd>/<kbd>Maj</kbd> pour monter et
  descendre, <kbd>Alt</kbd> pour accélérer. Glisser-clic pour regarder autour
  de soi.
- **Téléportation au clic** : un clic simple (sans glisser) sur le sol
  raycaste contre la bulle de terrain et pose la caméra à cet endroit.
- **Case « afficher le nom des objets »** : appelle
  `collectSceneLabels` (`src/inspect/objectLabels.js`) à intervalle régulier
  et projette chaque étiquette à l'écran.
- **Case « afficher l'emprise routière »** : peint en rouge translucide la
  chaussée **plus son accotement** (`CORRIDOR_MARGIN_M`), reconstruite à partir
  des tronçons que `RoadNetwork` publie. C'est la frontière que `roadCorridor`
  fait respecter aux haies, clôtures, jardins, cultures et herbe : un élément de
  décor posé *sur* la nappe est un défaut d'emprise, un élément posé au ras du
  bord est à sa place.
- **Champ de recherche** : géocode le texte tapé via Nominatim
  (OpenStreetMap) et déplace la bulle (`setCenter` + `refresh`) sur le
  résultat.
- **Panneau météo et heure** : sept temps prêts à l'emploi (grand beau,
  ordinaire, couvert, pluie, orage, neige, brume) et les curseurs qui les
  composent — couverture nuageuse, densité, précipitation et son type, vent,
  brume, sol mouillé. Un curseur d'heure du jour double l'horloge réelle,
  parce que la moitié de la lecture d'un éclairage est l'inclinaison du soleil
  et qu'attendre le coucher n'est pas une méthode de vérification.

  C'est **la démo** qui décide du temps qu'il fait, pas le moteur : `src/` ne
  fait aucune requête réseau et ne connaît aucun service météo. Une application
  réelle brancherait ici un relevé (Open-Meteo, gratuit et sans clé, fait
  l'affaire) ou une simulation, et passerait le même objet à `updateSky`. Ce
  sont des curseurs ici parce qu'on veut passer de l'orage au grand beau en une
  seconde pour regarder ce que ça change.

  Le curseur « sol mouillé » suit l'averse tant qu'on n'y touche pas, puis se
  détache — c'est ce qui permet de regarder une chaussée trempée sans avoir la
  pluie devant les yeux, et de simuler un sol qui sèche après l'averse.
- **Mini-carte** (bas droite, façon Street View) : toujours centrée sur la
  caméra, nord en haut, elle trace le réseau routier local à partir de
  `world.composer.roads.roadSegments` (la même donnée que l'emprise
  ci-dessus) et affiche un cône indiquant la direction du regard. Un clic
  dessus téléporte au point visé, comme le clic simple sur la scène 3D.

## Sources de données

- **Relief** : tuiles Terrarium (AWS Open Data), comme le reste du moteur —
  aucune configuration nécessaire.
- **Vectoriel** (routes, bâti, occupation du sol) : le TileJSON public
  d'[OpenFreeMap](https://openfreemap.org/), lu au démarrage plutôt que codé
  en dur, pour ne pas dépendre d'un gabarit d'URL qui peut changer. En cas
  d'échec (réseau, service indisponible), la démo continue avec le relief nu
  et l'indique dans son bandeau de statut.
- **Recherche de lieu** : [Nominatim](https://nominatim.openstreetmap.org/),
  le service de géocodage public d'OpenStreetMap — une requête par
  validation, dans les limites de son
  [usage policy](https://operations.osmfoundation.org/policies/nominatim/).
  Une application qui déploie cette démo à grande échelle devrait pointer
  vers sa propre instance ou un service commercial.

## Ce que ça n'est pas

Un client de production. Pas de réessai réseau élaboré, pas de gestion
d'erreur exhaustive, pas d'optimisation mobile — juste assez de code
applicatif pour que le moteur soit *reviewable on its own*, comme le demande
le CONTRIBUTING.
