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
- au-delà de 150 km de toute ancre, il n'y a **pas** de région, et le décor se
  peint générique. C'est l'état normal partout où le fichier ne va pas encore.

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
  quand elle affleure : falaise, éboulis, muret, moellon. Une seule.
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

## Vérifier

```
npm test
```

Le test contrôle que chaque dossier est complet, que chaque mot existe, que
chaque mot se traduit en quelque chose que le moteur connaît, que chaque région
est atteignable depuis sa propre ancre, et affiche les mots non rendus.

Le reste ne se vérifie qu'à l'œil : qu'une région ressemble à son pays ne se
teste pas, ça se regarde.
