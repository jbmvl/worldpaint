# Feuille de route : paysage roulant

Le chantier poursuit deux objectifs indissociables : faire durer les éléments
du paysage pendant un déplacement rapide, puis enrichir les formes sans payer
cette richesse par des apparitions ou disparitions visibles. Une forme ne passe
à l'étape suivante que si sa position, sa variante et son niveau de détail
restent tous attachés au même lieu.

## 1. Stabiliser la couverture végétale

### 1.1 Distance réelle dans les bandes

Les grilles de semis restent arrondies et ancrées au sol. Le fondu entre deux
bandes, en revanche, se mesure depuis l'observateur réel, jamais depuis le
dernier centre arrondi de redistribution. Herbe, cultures et sous-bois doivent
employer la même mesure.

**Terminé quand :** une maille donnée change de poids uniquement parce que la
distance réelle du cycliste à son centre a changé. Le test unitaire couvre ce
contrat.

### 1.2 Cellules persistantes

Remplacer le tampon unique réécrit autour de la caméra par des cellules de
monde mises en cache : une cellule entre devant, vit sans être régénérée, puis
sort derrière. Chaque instance porte un identifiant issu de sa maille, de son
emplacement et de sa bande.

**Terminé quand :** un aller-retour sur une même portion retrouve le même jeu
d'instances, et une cellule du recouvrement ne dépend plus de l'ordre de mise
à jour du tampon.

### 1.3 Passage de LOD au shader

Conserver les deux représentations dans le recouvrement et les faire passer par
un seuil haché fixe, calculé avec la distance à la caméra. L'hystérésis garde
une instance dans son niveau tant qu'elle n'a pas réellement franchi la marge.

**Terminé quand :** aucun changement de maillage CPU n'est requis pour faire
progresser un fondu déjà préparé.

## 2. Stabiliser l'infrastructure et le mobilier

### 2.1 Tronçons routiers persistants

Donner à chaque chaîne routière une clé stable, une abscisse curviligne de
référence et un cache indépendant de la fenêtre de 900 m. Les fenêtres servent
au chargement et à l'éviction, pas à redéfinir la route.

**Terminé quand :** deux reconstructions dont les fenêtres se recouvrent
produisent les mêmes positions de route, bornes, poteaux, câbles et haies dans
leur intersection.

### 2.2 Priorité de préparation

Préparer d'abord un couloir dans le sens du déplacement, puis les côtés, puis
l'arrière. La file des arbres suit la même priorité plutôt que l'ordre des
tuiles dans la carte.

**Terminé quand :** aucun objet d'infrastructure ne doit être corrigé dans la
zone déjà traversée parce que son index routier vient seulement d'arriver.

### 2.3 Connaissance des emprises

Une zone qui ne connaît pas encore complètement l'emprise route/rail ne reçoit
pas de décor définitif. Elle peut porter une masse distante neutre, mais pas un
arbre, une culture ou un poteau qu'il faudra déplacer ensuite.

**Terminé quand :** l'arrivée d'une emprise ne change pas un placement stable
déjà visible.

## 3. Arbres à trois niveaux

### 3.1 Proche : modèles low-poly instanciés

Créer des squelettes de feuillus et conifères : tronc effilé, bifurcation ou
branches principales, volumes de couronne facettés. Les variantes sont tirées
par identité d'arbre : âge, port, dissymétrie et inclinaison.

### 3.2 Moyenne distance : bouquets

Regrouper les arbres du peuplement en bouquets avec les silhouettes d'atlas
existantes. Un bouquet a une composition et une teinte stables, plutôt qu'une
succession de cartes indépendantes.

### 3.3 Horizon : imposteurs de masses forestières

Préparer des cartes 2D de massifs, alignements et lisières, ancrées à des
patches de forêt. Elles partagent espèce, saison et teinte avec les niveaux
proches.

**Terminé quand :** les trois niveaux lisent une même identité de peuplement et
passent l'un dans l'autre dans un recouvrement stable.

## 4. Catalogue de formes au bord de la route

### 4.1 Poteaux et câbles

Ajouter des familles de poteaux (bois, béton, acier), des traverses et
isolateurs compatibles, ainsi que des variantes de dévers et de hauteur. Les
câbles constituent des portées continues entre deux poteaux réellement posés.

### 4.2 Arbres isolés et mobilier

Décliner les arbres isolés par port et par âge. Décliner bornes, panneaux,
abribus, clôtures et glissières sans convertir le placement en tirage lié à la
caméra.

### 4.3 Bâti et repères

Enrichir d'abord les silhouettes : débords de toiture, soubassement,
encadrements, volets, dépendances agricoles et typologies de clochers. Les
repères lointains reçoivent eux aussi trois niveaux de représentation.

**Terminé quand :** chaque nouvelle variante est un choix du thème ou de la
région, et non une valeur artistique cachée dans une couche.

## 5. Paysage parcouru

Introduire une phase saisonnière indépendante du type de culture, puis les
états qui aident un cycliste à lire le lieu : fauche, moisson, chaussée humide,
vent, visibilité, accotement et fossé. Étendre ensuite les régions européennes
par trames paysagères et typologies construites, avec des transitions qui ne
forcent pas une reconstruction globale visible.

## Vérification transversale

Avant chaque étape visuelle, enregistrer une courte route de référence dans des
paysages contrastés : bocage, openfield, forêt, montagne et village. Les tests
automatisés vérifient le déterminisme et les intersections de fenêtres ; la
démo sert à contrôler visuellement les déplacements continus, les limites de
LOD et les vues depuis une caméra à hauteur de selle.
