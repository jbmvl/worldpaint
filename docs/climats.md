# Écrire le décor d'un climat

Ce document s'adresse à qui reprend la **direction artistique** de WorldPaint —
en pratique, au graphiste qui travaillera sur Dot Racing. Il ne demande pas de
savoir lire le moteur : tout ce qui suit se change dans un seul fichier,
`src/themes/default.js`, et se vérifie avec `npm test`.

Ce qui existe aujourd'hui est une **proposition par défaut**, écrite pour que
personne n'ait la page blanche. Elle est faite pour être contredite.

## Ce que le moteur sait du lieu

À partir d'une longitude et d'une latitude, le moteur détermine une **famille
climatique** (`src/core/climate.js`) : une carte Köppen-Geiger embarquée, puis
une correction par l'altitude réelle du terrain. Onze familles, taillées pour
l'Europe :

| Famille | Où | Ce qui la caractérise à l'écran |
|---|---|---|
| `oceanic` | Bretagne, Normandie, Irlande, Benelux, plaine anglaise | feuillus hauts, herbe grasse, bocage |
| `oceanicUpland` | Highlands, côtes norvégiennes, Islande | arbres bas et rares, lande, roche |
| `mediterranean` | Provence, Espagne côtière, Italie, Grèce | pins, chênes verts, herbe sèche, vigne et verger |
| `mediterraneanCool` | Portugal intérieur, Galice, arrière-pays | même famille, moins sèche |
| `semiArid` | Èbre, Castille sèche, Murcie | steppe rase, sol nu dominant |
| `arid` | Tabernas, Bardenas | presque pas d'arbre, roche et gravier |
| `continental` | Pologne, Baltique, plaine du Pô | grandes futaies mêlées, openfield |
| `boreal` | Scandinavie, Finlande | épicéas serrés, bouleaux |
| `alpine` | au-dessus de la limite forestière | alpage, pessière, roche |
| `mediterraneanMontane` | montagnes grecques, Apennins, sierras | pin noir, karst sec |
| `glacial` | calottes | cas limite, peu de contenu |

**Le climat n'est pas l'occupation du sol.** Ce qu'il y a *réellement* à un
endroit — forêt, prairie, champ, lande, maquis, marais, éboulis — vient
d'OpenStreetMap, et le climat ne fait que décider de *quelle sorte* : une forêt
existe parce que la donnée le dit, elle est une taïga ou une chênaie verte parce
que le climat le dit.

## Les quatre tranches à écrire

Chaque entrée porte une liste `climates` : les familles où elle est plausible.
**Une entrée sans `climates` est retenue partout** — c'est le comportement d'un
thème écrit avant que les climats existent.

### 1. Les peuplements — `FOREST_TYPES`

Deux ou trois par famille suffisent : c'est le contraste entre eux qui se lit,
pas leur nombre.

```js
{
  name: 'taïga',
  climates: ['boreal'],
  essences: ['conifer', 'conifer', 'conifer', 'column'], // parmi broadleaf,
                                                          // column, conifer, bushy
  minHeight: 9,          // mètres
  maxHeight: 18,
  density: 1.5,          // facteur, 1 = densité de référence
  understory: 0.18,      // part de buissons, comptés **en plus** des arbres
  tint: [0.8, 1, 0.94],  // multiplicateur de teinte du feuillage, par canal
}
```

Ce qui compte le plus, dans l'ordre : la **hauteur** (un taillis et une futaie
ne se confondent jamais), la **densité**, puis la teinte. Les quatre silhouettes
d'essence sont dessinées procéduralement et ne se changent pas ici.

### 2. Les palettes de bourg — `TOWN_PALETTES`

```js
{
  name: 'badigeon',
  climates: ['arid', 'semiArid', 'mediterranean'],
  walls: ['#f4f2ea', '#eae7dc', '#faf8f2'],   // deux ou trois tons
  roofs: ['#c07a4e', '#a96a45'],               // deux tons
  shutters: ['#3f6f8e', '#2f5a4a'],            // deux tons
  roofShapes: ['flat', 'gable'],               // deux ou trois formes, jamais plus
  pitch: 0.25,                                  // facultatif : pente du toit
}
```

Quatre règles, et elles sont tenues par des tests :

- **deux ou trois formes de toit** par palette. Une seule fait un lotissement,
  quatre font un catalogue ;
- **les murs restent clairs** : la valeur maximale d'un ton de mur, une fois
  modulée par maison, doit dépasser 0,4 en linéaire. C'est ce qui empêche le
  décor de basculer du côté du jouet. Le rouge de Falun scandinave livré par
  défaut est *délavé* pour cette raison — le vrai casse la règle, et l'assouplir
  est une décision à prendre en connaissance de cause ;
- **le volet est la seule vraie couleur** admise sur une façade ;
- **`pitch` se voit de plus loin que la couleur.** 0,25 est un toit-terrasse,
  0,42 une tuile canal, 0,55 le défaut, 0,85 un pignon balte ou nordique.

### 3. Les couvertures — `COVER_LOOK` et `TERRAIN_LOOK.coverAlbedo`

Elles ne dépendent pas du climat mais de la donnée OSM : lande, maquis, marais,
pelouse d'altitude, éboulis, dalle, sable. `coverAlbedo` donne la couleur du sol
au loin, `COVER_LOOK` la strate basse (hauteur, densité et teinte de l'herbe,
densité d'arbustes). Les deux sont indispensables : une lande de la bonne
couleur couverte d'une prairie de quatre-vingts centimètres reste une prairie.

### 4. L'air — `SKY_PALETTE.variants`

```js
{ name: 'poussière', climates: ['semiArid', 'arid'], fog: '#efe6d6' }
```

Une variante ne redit que ce qu'elle change. C'est la couleur la plus
déterminante du décor : elle décide de la distance apparente. À toucher en
dernier, et par petites touches.

## Ce qui n'est **pas** de la direction artistique

- les portées, les plafonds d'instances, les cadences de reconstruction : ce
  sont des images par seconde, pas du goût ;
- la liste des cultures (`CROP_KINDS`) et celle des couvertures
  (`COVER_KINDS`) : leur ordre est un **encodage** peint dans une image et relu
  par le shader. Ajouter une lavande ou un olivier demande un motif d'atlas et
  un réencodage, pas une ligne de table ;
- l'assolement par climat (`CROP_MIXES`, dans `layers/furniturePlacement.js`) et
  le bétail (`HERD_SHEEP_ODDS`) : ce sont des règles de plausibilité, pas des
  couleurs. Elles se discutent quand même.

## Vérifier

```
npm test
```

Deux garde-fous concernent directement ce fichier :

- **chaque famille climatique doit avoir au moins un peuplement et une
  palette.** Sans ça, la région se peint avec un contenu générique, en silence :
  le test est le seul endroit où l'oubli se signale franchement ;
- **aucun mur de bourg ne tombe hors de la plage claire.**

Le reste ne se vérifie qu'à l'œil, dans la démo (`npm run demo`), en se
téléportant d'une région à l'autre. Le moteur ne juge pas de son propre rendu.
