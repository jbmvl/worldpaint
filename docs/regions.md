# Écrire une région naturelle

Cette page s'adresse à qui remplit `src/core/regions.js` — à la main ou en
faisant travailler un modèle. Elle ne demande pas de savoir lire le moteur.

## Ce que la couche fait

Le vectoriel dit **ce qu'il y a** au sol, le MNT **quelle forme** ça a. La
région dit **à quoi ressemble le pays** : ce qui pousse dans un bois que la
carte signale sans le décrire, ce qu'on sème dans un champ qu'elle ne nomme
pas, comment on borne une parcelle, de quoi sont faits les murs, et surtout ce
qu'il y a là où elle se tait — ce qui est le plus gros du décor dès qu'on
s'éloigne des pays bien relevés.

Un lieu, une région, un dossier. Pas de mélange, pas de transition : deux
régions voisines se distinguent en les traversant, et c'est ce qu'on veut.

## Comment le moteur choisit la région

Par l'**ancre la plus proche**. Une région ne porte pas son contour, elle porte
quelques points posés dans son épaisseur ; le découpage qui en résulte tombe à
mi-chemin entre deux ancres voisines.

Conséquences pratiques quand on écrit :

- **une région compacte se contente d'une ancre.** Un plateau, un bassin, une
  île petite ;
- **une région allongée en demande trois ou quatre** — une vallée, un littoral,
  un couloir. Sinon la voisine mord dedans sur toute sa longueur ;
- **on corrige une limite en ajoutant une ancre**, jamais en redessinant quoi
  que ce soit ;
- **une région trop serrée contre une voisine disparaît.** Le test le dit :
  chaque région doit se retrouver elle-même depuis sa propre ancre ;
- au-delà de 150 km de toute ancre, il n'y a **pas** de région, et le décor
  **s'éteint** : rien n'est chargé, rien n'est posé, on voit le ciel et rien
  dessous. C'est l'état normal partout où le fichier ne va pas encore, et c'est
  volontaire — un paysage tiré dans les listes par défaut ressemble à un
  paysage, donc personne ne voit qu'il est faux. Imposer une région
  (`world.setRegion`) le rallume n'importe où, et c'est ainsi qu'on travaille un
  pays avant de l'avoir ancré.

L'ordre est `[longitude, latitude]`. Inverser les deux déplace une région d'un
continent sans rien casser d'autre.

## Le dossier

```js
{
  id: 'anjou',
  name: 'Anjou',
  anchors: [[-0.55, 47.45], [-0.15, 47.3]],
  matrix: 'hedgerow_meadow',
  stone: 'limestone',
  building: ['light_stone', 'slate_roof'],
  farming: ['cereal', 'vineyard', 'maize', 'orchard'],
  trees: ['oak', 'chestnut', 'beech'],
}
```

- **`matrix`** — le paysage là où la carte se tait. **Le champ qui porte le
  plus** : en rase campagne, une scène n'est presque que ça. Choisir d'abord
  celui-là, et l'écrire en pensant à l'entre-deux — pas au morceau le plus
  remarquable du pays, mais à ce qu'on traverse entre deux villages.
- **`stone`** — la géologie dominante, c'est-à-dire la couleur de la pierre
  partout où elle se montre : la roche des fortes pentes, la dalle et
  l'éboulis, et ce qui est bâti dedans — muret de pierre sèche, mur de
  soutènement, paroi de déblai. Une seule.
- **`building`** — un mur, puis un toit, dans cet ordre, deux mots au plus. Le
  toit se lit de plus loin que le mur.
- **`farming`** — l'assolement, **du plus répandu au moins répandu**. Le rang
  est l'information : il n'y a aucun poids à écrire, et une liste dans le
  désordre fait une région couverte de vignes.
- **`trees`** — deux à quatre essences dominantes.

Rien d'autre. Pas d'altitude, pas d'humidité, pas de score : ce qui existe
réellement à un endroit est relevé par le vectoriel, et une région qui le
redirait finirait par le contredire.

## Le vocabulaire est fermé

Les listes admises sont dans `src/core/regionInterpretation.js`, et rappelées en
tête de `src/core/regions.js` pour qu'on puisse remplir sans l'ouvrir. **Un mot
inventé est une erreur**, et le test la lève : c'est le seul endroit où
`oak_forest` écrit à la place de `broadleaf_woodland` se signale.

Certains mots sont admis sans que le décor sache encore les rendre — la
rizière, la serre, la terre crue, le palmier. Il faut les employer quand même :
décrire l'Andalousie sans serre serait décrire autre chose. Ils rendent un repli
volontairement quelconque, et le test les inventorie à chaque passage. Cet
inventaire est la liste de ce qui reste à construire.

## Ce qui n'est pas dans ce fichier

Aucune couleur, aucune hauteur, aucune densité. Un mot de région est une clé :
`regionInterpretation` le traduit en concept de moteur, le thème décide de ce
qu'il vaut à l'œil. Une teinte écrite ici serait une direction artistique
échappée de `themes/default.js`.

## Ce que le thème accroche au pays

Un dossier de région ne contient aucune couleur : ses mots sont des clés, et
c'est `src/themes/default.js` qui dit ce qu'elles valent à l'œil. Cinq tranches
les lisent, et une seule personne les écrit — le graphiste, sans toucher au
moteur.

| Tranche | Ce qu'elle accroche | Comment |
| --- | --- | --- |
| `FOREST_TYPES` | les essences | un peuplement cite des `species` ; il est retenu si le pays en nomme une |
| `TOWN_PALETTES` | le bâti | une palette cite des `materials` ; même règle |
| `SOIL_LOOK` | la matrice | une entrée par matrice : le lavage du sol, la densité et la hauteur des touffes |
| `STONE_LOOK` | la pierre | une teinte par géologie, appliquée à la roche et aux ouvrages qui en sont faits |
| `SKY_PALETTE.variants` | la matrice | une variante cite les matrices dont elle colore l'air |
| `STREET_LOOK.pavement` | la matrice | la teinte du sol revêtu de la ville |

Trois choses à savoir avant d'y toucher :

- **le repli est la liste entière.** Un pays dont aucun peuplement ne cite les
  essences se peint avec tous les peuplements, jamais avec aucun : lever ici
  aborterait la construction et emporterait les couches suivantes. C'est le test
  qui signale l'oubli, pas le décor ;
- **`SOIL_LOOK` porte des facteurs, pas des couleurs**, et son plafond de 3,5
  n'est pas décoratif : au-delà, la touffe du premier plan sature au blanc
  pendant que le sol continue de foncer, donc les deux divergent. Une matrice
  absente vaut « pas de correction » — c'est le cas du bocage atlantique, sur
  lequel le reste du thème a été réglé ;
- **`grassDensity` fait autant que la couleur.** Un sol jauni couvert d'une
  prairie continue reste une prairie jaunie ; ce qui fait une steppe, c'est la
  terre qu'on voit entre les touffes ;
- **`STONE_LOOK` porte des facteurs, comme `SOIL_LOOK`**, et pour la même
  raison : la pierre est peinte par le shader du sol *et* par la géométrie des
  ouvrages, et deux palettes les feraient diverger. Le calcaire est la
  référence et n'a pas d'entrée. Les formes du catalogue — calvaire, moulin,
  château — gardent leur pierre neutre : elles sont instanciées une fois pour
  toutes.

Trois tables ne sont pas de la direction artistique mais des règles de
plausibilité, et elles vivent dans les couches : la trame des limites de
parcelle (`BOUNDARY_MIXES`, par style de limite), le bétail (`HERD_SHEEP_ODDS`,
par matrice) et le gibier (`FOREST_GAME`, par matrice). Elles se discutent quand
même — la trame agraire se lit de bien plus loin qu'une teinte.

L'assolement, lui, n'a plus de table du tout : il est la liste `farming` du
dossier, et ses parts se déduisent du rang.

## Vérifier

```
npm test
```

Le test contrôle que chaque dossier est complet, que chaque mot existe, que
chaque mot se traduit en quelque chose que le moteur connaît, que chaque région
est atteignable depuis sa propre ancre, et affiche les mots non rendus.

Le reste ne se vérifie qu'à l'œil : qu'une région ressemble à son pays ne se
teste pas, ça se regarde.

### Stabilité pendant une génération

Le compositeur conserve la région choisie à l'initialisation du repère local.
Avancer ne remplace donc pas les essences, les cultures et la palette des
objets déjà générés. Une région explicitement imposée ou un nouveau repère
après téléportation ouvre une nouvelle génération.

Une tuile de peuplement conserve les descriptions déjà affichées lors d'un
complément de couverture : essence, hauteur, rotation, teinte et altitude.
Les places restantes reçoivent les nouveaux candidats. Une emprise routière
révélée peut retirer un arbre qui la recouvre ; une replantation explicite ou
la sortie de la tuile libère ces descriptions.
