# Contrôler la scène en déplacement

Les tests automatiques vérifient les placements, les géométries, les caches
et les fonctions de mouvement. L'appréciation du rendu appartient à l'auteur.

Dans la démo, parcourir les mêmes tronçons à environ 30 km/h :

- **Plaine agricole** : regarder les bords de cultures entre 20 et 200 m,
  puis l'herbe de bas-côté. Les brins sont une grille stratifiée continue,
  animée au shader ; leurs dimensions ne dépendent pas de la distance.
  Contrôler le fondu et le raccord de couleur au sol au-delà de 55 m.
- **Lisière forestière** : regarder un arbre de 230 m à 20 m, puis reculer.
  Le passage silhouette/volume se fait entre 190 et 120 m. Changer explicitement
  de région dans le panneau pour comparer les essences ; le déplacement seul
  ne redéfinit pas la région pendant une génération.
- **Route avec poteaux** : suivre une portion pendant l'arrivée des tuiles.
  Les ancrages conservent leur abscisse et leur sens quand la route s'étend.
  Vérifier aussi un retour sur ses pas et un carrefour.
- **Vent de jour** : comparer calme, vent latéral et vent contraire. Vérifier
  les brins, les houppes et les feuilles pliées devant route claire et sombre.
  Aucune feuille sous 30 % de vent ; elles glissent entre 30 et 45 %,
  puis s’élèvent et accélèrent. Avancer doit conserver leurs positions monde.
- **Tunnel routier** : traverser entrée et sortie, sur terrain plat puis pentu.
  Contrôler les côtés de l’arc, les raccords du relief et les lanternes à l’intérieur. Les ouvertures
  du terrain sont des masques locaux de portail (24 maximum), pas une
  excavation volumétrique ; une galerie peu profonde ou très courbe demande
  particulièrement ce contrôle. Les limites du streaming ne créent pas de tête.
- **Animaux et mobilier** : comparer les bonds lents d’un cervidé et d’un renard au trot d’un
  chien, d’un chat et d’un loup, puis à la marche d’un ours et au repos.
  Contrôler genoux, oreilles, ombres, pieds
  et tangage sur pente. La locomotion ne résout pas le contact individuel de
  chaque patte. Inspecter aussi poteaux, abribus, bottes, granges et souches.

## Performance

Cocher **Mesures de performance**. Comparer attente à l'arrêt, progression et
arrivée de nouvelles tuiles ; faire aussi une session longue pour la mémoire.
Le banc `node scripts/benchmark-terrain.mjs` mesure le cache CPU du terrain,
pas le temps GPU ni un parcours complet. Voir [performance.md](performance.md).

La première construction du terrain et les reconstructions des routes,
bâtiments et mobilier restent des travaux synchrones parfois longs. Le
prochain chantier de performance à prioriser est leur répartition entre
images, puis leur déplacement dans un worker si les mesures le justifient.
Les triangles de végétation proche ajoutés doivent être mesurés sur le matériel
cible : les caches de génération ne diminuent pas leur coût de rendu.

Les saisons, le préchargement d'itinéraire et de nouveaux repères touristiques
sont hors périmètre. Le catalogue d'objets reste procédural ; les objets proches
listés ci-dessus ont été détaillés, pas remplacés par des assets externes.

## Banc de prairie isolé

Avec `npm run demo`, ouvrir `/demo/grass-lab.html`. Le terrain déterministe
ne dépend d’aucune donnée géographique distante. Le rapport vérifie les
erreurs de shader, les appuis de 9 000 racines et l’éclairage GPU comparé à
un Lambert témoin sous trois angles de caméra. Le contrôle négatif réinjecte
une normale dans le mauvais espace : son écart doit être supérieur à 2,
celui du calcul courant inférieur ou égal à 2.

À contrôler à l’œil : continuité verte sur les arêtes et les pentes, forme
des brins courts, présence des fleurs et raccord lointain. Tourner la caméra,
changer le soleil, régler le vent et activer **Avancer**. La case **Herbe et
fleurs** permet de comparer avec le sol. Refaire ensuite ces contrôles dans
la démo géographique : le banc isolé ne couvre pas le grain des autres biomes
ni les arrivées de tuiles réelles.
