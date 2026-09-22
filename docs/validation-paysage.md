# Contrôler la scène en déplacement

Les tests automatiques vérifient les placements, les géométries, les caches
et les fonctions de mouvement. L'appréciation du rendu appartient à l'auteur.

Dans la démo, parcourir les mêmes tronçons à environ 30 km/h :

- **Plaine agricole** : regarder les bords de cultures entre 20 et 200 m,
  puis l'herbe de bas-côté. Les brins sont une grille stratifiée continue,
  animée au shader ; leurs dimensions ne dépendent pas de la distance.
  Contrôler le fondu et le raccord de couleur au sol au-delà de 65 m.
- **Lisière forestière** : regarder un arbre de 120 m à 20 m, puis reculer.
  Le passage silhouette/volume se fait entre 95 et 60 m. Changer explicitement
  de région dans le panneau pour comparer les essences ; le déplacement seul
  ne redéfinit pas la région pendant une génération.
- **Route avec poteaux** : suivre une portion pendant l'arrivée des tuiles.
  Les ancrages conservent leur abscisse et leur sens quand la route s'étend.
  Vérifier aussi un retour sur ses pas et un carrefour.
- **Vent de jour** : comparer calme, vent latéral et vent contraire. Vérifier
  les brins, les houppes et les feuilles pliées devant route claire et sombre.
  Les feuilles utilisent une géométrie métrique, plus des points en pixels.
- **Tunnel routier** : traverser entrée et sortie, sur terrain plat puis pentu.
  Contrôler les raccords du relief et la visibilité à l'intérieur. Les ouvertures
  du terrain sont des masques locaux de portail (24 maximum), pas une
  excavation volumétrique ; une galerie peu profonde ou très courbe demande
  particulièrement ce contrôle. Les limites du streaming ne créent pas de tête.
- **Animaux et mobilier** : comparer un cervidé qui détale avec un cheval ou
  un chien, puis une bête à l'arrêt. Contrôler genoux, oreilles, ombres, pieds
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
