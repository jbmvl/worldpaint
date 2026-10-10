# Coût de génération de Lyon — relevé du 10 octobre 2026

Avec les réglages courants, la Presqu’île se reconstruit en **2,86 s** à données chargées. Avec le budget de murs retiré, elle demande **5,96 s**. Le coût principal vient du terrain corrigé, des routes et de la carte du sol ; à grande portée, les rues, le bâti et le mobilier deviennent également importants. Les temps ci-dessous sont des mesures locales sur le code présent dans le dossier de travail, modifications non commitées comprises.

## 1. Ce qui est mesuré

Machine : **Apple M4 Pro, 12 cœurs, 24 Gio de RAM**, macOS arm64, Node v22.12.0. Navigateur : Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36. Rendu : **ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)**, accélération Metal, fenêtre de **960 × 600**, antialiasing et ombres activés.

Les tuiles ont été capturées depuis OpenFreeMap et AWS Terrarium : **25 tuiles vectorielles au zoom 14**, **25 tuiles MNT au zoom 14**, plus **9 tuiles MNT au zoom 10** pour le relief lointain. La source MapTiler a refusé les requêtes (HTTP 403) ; seul le MNT Terrarium est employé. Le rejeu interdit toute requête extérieure à localhost. **Aucune tuile manquante** dans les deux relevés. Le téléchargement public n’est pas inclus dans les temps de génération.

Point de départ : **4,832° E / 45,764° N**. Le terrain utilise les valeurs par défaut : bulle de **3 × 3 tuiles au zoom 15**, **192 × 192 mailles par tuile** dans ce bloc, et relief lointain de **31 × 31 tuiles** avec MNT au zoom 10. Il y a donc **663 552 triangles de terrain proche** et **122 040 triangles de relief lointain** dans les inventaires.

Deux scénarios :

- **Courant** : budget de murs de 60 km, inchangé. Cinq reconstructions forcées au même point après le démarrage.
- **Étendu** : `detail: { budget: 0 }`. Trois reconstructions après le démarrage. Les rayons propres aux couches et les plafonds existants restent appliqués : routes jusqu’à 900 m, bâtiments jusqu’à 1 500 m. Ce scénario représente un grand quartier dense, pas toute la commune chargée simultanément.

Chaque déplacement est un saut vers un point géographique, suivi d’une reconstruction forcée et du vidage des files de terrain, d’herbe et d’arbres. Il ne représente pas un parcours continu à vitesse constante. Les médianes sont calculées sur les reconstructions répétées de la Presqu’île ; les autres quartiers ont un relevé chacun. Aucun p95 n’est revendiqué avec un si petit échantillon.

Les compteurs CPU de couche excluent les pauses du compositeur. Le chronomètre du navigateur est quantifié : « 0,00 ms » signifie sous sa résolution, et non un coût nul. L’instrumentation ajoute aussi un petit coût, notamment aux milliers de passages du générateur de routes. Les sous-étapes sont incluses dans leur couche : **ne pas les additionner une seconde fois**. Les temps de dessin GPU, FPS, compilation des shaders et téléchargements en conditions réelles ne sont pas mesurés. Les triangles rendus sont comptés par Three.js, ombres comprises. Les buffers sont des tableaux typés de géométrie et d’instances conservés côté CPU, capacité inutilisée comprise ; ils ne représentent ni la mémoire totale du processus ni la VRAM.

## 2. Temps globaux et budget du détail

| Scénario | Construction des objets | Démarrage et files | Reconstruction médiane | Min–max des répétitions | Pauses médianes |
| --- | --- | --- | --- | --- | --- |
| Courant | 61,10 ms | 3809,70 ms | 2858,70 ms | 2798,30–3010,70 ms | 954,80 ms |
| Étendu | 63,30 ms | 6877,60 ms | 5960,90 ms | 5840,70–6013,00 ms | 1729,10 ms |

La construction des objets est relevée séparément avant le démarrage : matériaux, catalogues, prototypes et réserves d’instances. Le temps global de reconstruction inclut les pauses et l’orchestration. Les médianes de chaque couche prises séparément ne se somment pas exactement à la médiane globale.

| Quartier | Coordonnées | Rayon courant | Pas de relève courant | Bâtiments courant / étendu | Boutiques courant / étendu | Terrasses courant / étendu |
| --- | --- | --- | --- | --- | --- | --- |
| Presqu’île | 4.83200, 45.76400 | 350 m | 100,00 m | 737 / 3280 | 325 / 268 | 289 / 215 |
| Fourvière | 4.82105, 45.76265 | 550 m | 166,67 m | 945 / 2066 | 55 / 204 | 75 / 240 |
| Croix-Rousse | 4.83200, 45.77433 | 350 m | 100,00 m | 1140 / 4724 | 153 / 334 | 194 / 430 |
| Rhône | 4.84101, 45.76400 | 450 m | 133,33 m | 701 / 2802 | 286 / 280 | 340 / 279 |

Le scénario étendu conserve un pas de relève de **250 m**. Le plafond de bâtiments n’est pas un maximum absolu de 1 500 : la zone stable conserve les bâtiments proches. Cela explique les 4 724 bâtiments du relevé étendu de la Croix-Rousse. Le plafond de **600 personnalités de bâtiment** continue à s’appliquer ; augmenter la portée ne garantit donc pas davantage de devantures locales. Les terrasses publiées ne correspondent pas au nombre d’appels de construction : une façade peut publier plusieurs positions.

## 3. Coût CPU de chaque grande brique

| Brique | Premier passage courant, ms | Médiane courante, ms | Médiane étendue, ms | Ce que couvre le compteur |
| --- | --- | --- | --- | --- |
| Lieu et habitat | 18,90 | 4,60 | 5,10 | Budget des murs, habitat urbain, lieux nommés et distance à la mer. |
| Falaises | 0,40 | 0,10 | 39,30 | Collecte et géométrie des ruptures cartographiées ; cache au point fixe. |
| Eau : préparation | 2,90 | 1,60 | 1,70 | Cotes et profils des surfaces d’eau ; les corrections par sommet sont dans le terrain. |
| Carte du sol | 394,60 | 393,20 | 392,30 | Lecture des occupations, peinture, réparation des classes et contours. |
| Routes | 920,10 | 319,10 | 1050,50 | Collecte, graphe, largeurs, profils, franchissements, rubans, carrefours et marquages. |
| Terrain corrigé | 769,00 | 753,90 | 1098,40 | Vidage des étapes de maillage avec eau, falaises et terrassements. |
| Ponts et tunnels | 7,50 | 3,90 | 16,50 | Habillage des ouvrages ; leur interprétation et leurs profils sont inclus dans les routes. |
| Rails | 5,80 | 3,00 | 5,80 | Voies, ballast, rails et caténaires sur terrain corrigé. |
| Bâtiments | 217,30 | 144,00 | 583,70 | Empreintes, personnalités, murs, toits, baies, commerces et terrasses. |
| Rues et bordures | 129,10 | 106,60 | 477,60 | Rives, caniveaux, maçonnerie, coins de carrefour et marquages de rue. |
| Jardins | 16,60 | 12,40 | 51,70 | Clôtures et buissons des maisons ; les arbres sont confiés à la végétation. |
| Mobilier | 90,50 | 75,20 | 392,00 | Toutes les familles détaillées plus bas, puis publication des géométries. |
| Arbres et sous-étage | 54,00 | 38,10 | 44,20 | Semis différé et publication des instances ; le rendu est compté séparément. |
| Herbe | 5,80 | 3,60 | 3,90 | Semis local au point observé, faible surface herbeuse au centre. |
| Cultures | 2,10 | 1,40 | 1,60 | Recherche et semis local ; aucune instance de culture dans ces quartiers. |

L’appui des plantes, les transferts d’instances d’herbe et les fleurs sont des sous-mesures du travail des plantes :

| Sous-mesure | Premier passage courant, ms | Médiane courante, ms | Médiane étendue, ms |
| --- | --- | --- | --- |
| appuiPlantes | 1,90 | 0,00 | 0,00 |
| instancesHerbe | 1,20 | 0,60 | 0,70 |
| fleurs | 0,70 | 0,30 | 0,30 |

Relief lointain au premier passage courant : lecture des altitudes **4,80 ms**, maillage **8,00 ms**. Au même point, ces opérations sont réutilisées. Aux déplacements, la lecture coûte 3,10–4,00 ms et le maillage 5,90–8,40 ms dans le scénario courant. Le wrapper chronomètre ces fonctions synchrones, pas seulement le lancement de leur appel asynchrone.

Le chargement vectoriel local au premier passage courant coûte **12,40 ms** ; à chaud, sa médiane est **0,00 ms**. Ce compteur couvre lecture locale et création des objets de tuile. La conversion détaillée des entités relues par les couches est comptée dans chacune d’elles.

## 4. Routes : où part le temps

| Sous-étape | Premier passage courant, ms | Médiane courante, ms | Médiane étendue, ms |
| --- | --- | --- | --- |
| collecte et absorption | 52,00 | 43,60 | 42,20 |
| graphe et chaînage | 123,20 | 73,10 | 82,80 |
| largeurs parallèles | 576,40 | 80,70 | 148,20 |
| profils, ouvrages et maillages | 166,50 | 119,70 | 784,80 |

Les trois premières étapes ont une cession explicite : collecte et absorption des axes urbains, construction du graphe/chaînage, puis ajustement des largeurs parallèles. Le reste regroupe les profils, ouvrages, raccords, index, surfaces de carrefour et maillages ; il n’est pas séparé en temps exact par fonction dans ce relevé.

La préparation des largeurs est particulièrement coûteuse au premier passage ou lorsque l’ensemble des lignes change. Le cache fait baisser ce coût aux reconstructions sur les mêmes données, sans l’annuler. Le budget de murs réduit les segments dessinés, mais les étapes globales doivent encore comprendre le réseau lu.

## 5. Bâti, commerces et personnalités

| Sous-étape | Premier passage courant, ms | Médiane courante, ms | Médiane étendue, ms |
| --- | --- | --- | --- |
| collecte empreintes et POI | 34,10 | 21,80 | 25,00 |
| association et dédoublonnage | 15,50 | 14,30 | 186,40 |
| géométrie par bâtiment | 148,50 | 98,20 | 321,80 |
| terrasses (inclus dans bâtiment) | 28,40 | 20,90 | 11,40 |
| fenêtres nocturnes (inclus dans publication) | 1,10 | 0,90 | 4,00 |
| enseignes (inclus dans publication) | 0,00 | 0,00 | 0,10 |
| publication | 18,80 | 12,40 | 47,30 |

Les terrasses, fenêtres nocturnes et enseignes sont **incluses** dans la géométrie ou la publication. Le coût de la reconnaissance des commerces est dans la collecte/association ; murs de devanture, baies, toitures et caractères religieux sont inclus dans la géométrie par bâtiment. Une valeur faible de publication des enseignes ne signifie pas que les commerces sont gratuits.

La Presqu’île courante produit **737 bâtiments**, **35 472 baies de jour**, **21 626 triangles de fenêtres nocturnes**, **325 devantures** et **289 positions de terrasse**. Elle retient 600 personnalités : 583 commerces génériques, 8 boulangeries, 5 bâtiments commerciaux et 4 églises. Les autres points comprennent aussi mosquée, hôpital et station-service. Les variantes de château, murailles et toutes les formes du catalogue ne sont pas chacune présentes : aucune performance individuelle ne leur est attribuée.

## 6. Mobilier : toutes les familles parcourues

| Famille | Premier passage courant, ms | Médiane courante, ms | Médiane étendue, ms | Maximum aux quatre points courants, ms |
| --- | --- | --- | --- | --- |
| préparation + rives et relief routier | 59,50 | 51,00 | 316,00 | 129,30 |
| passages | 1,10 | 0,10 | 0,20 | 0,30 |
| panneaux de carrefour | 0,20 | 0,10 | 0,50 | 0,20 |
| parcelles | 3,10 | 2,50 | 10,10 | 7,70 |
| faune domestique | 0,20 | 0,00 | 0,20 | 0,10 |
| faune de pâture | 0,40 | 0,20 | 0,30 | 0,60 |
| repères de village | 0,20 | 0,10 | 0,10 | 0,20 |
| points d’intérêt | 11,30 | 10,60 | 15,20 | 10,90 |
| rochers | 8,30 | 7,10 | 24,40 | 26,60 |
| débris du biome | 2,00 | 1,60 | 8,30 | 10,40 |
| repères | 0,00 | 0,00 | 0,00 | 0,00 |
| sommets | 0,20 | 0,00 | 0,00 | 0,20 |
| côtes | 0,30 | 0,00 | 0,10 | 0,10 |
| arbres de crête | 0,10 | 0,00 | 0,10 | 0,00 |
| publication | 3,40 | 1,90 | 14,30 | 6,90 |

La première étape inclut la préparation de la couche et les rives routières : relief de rive, garde-corps, lampadaires et autres objets au bord des routes. Les POI comprennent leurs objets particuliers et commerces qui relèvent du mobilier. La publication applique les géométries linéaires, les instances, les lampes et les étiquettes. Un temps proche de zéro dans une famille sans objets mesure surtout un parcours qui n’a rien à poser ; il ne mesure pas une scène saturée de cette famille.

## 7. Ce qui bloque malgré le budget de 8 ms

| Étape | Plus long morceau au démarrage courant, ms | Plus long morceau des cinq reconstructions, ms | Plus long morceau aux déplacements courants, ms |
| --- | --- | --- | --- |
| Carte du sol | 257,80 | 261,90 | 562,70 |
| Routes | 576,50 | 150,70 | 587,30 |
| Bâtiments | 34,20 | 30,80 | 64,50 |
| Rues | 29,90 | 28,60 | 47,80 |
| Mobilier | 59,70 | 52,80 | 129,30 |

Le budget de 8 ms est un seuil contrôlé **entre** les étapes. Il n’interrompt pas une étape en cours. Un morceau de 250 ms occupe à lui seul l’équivalent de 15 intervalles de 16,67 ms ; cela explique un risque de gel visible même si le temps total est étalé. Ce calcul n’est pas une mesure de FPS. Les profils n’enregistrent pas une boucle de rendu concurrente pendant toutes les reconstructions.

## 8. Coût des changements de quartier

| Point | Temps global courant, ms | Temps global étendu, ms | Terrain courant, ms | Carte du sol courante, ms | Routes courantes, ms | Bâti courant, ms | Rues courantes, ms | Mobilier courant, ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Presqu’île | 2968,60 | 5789,70 | 772,60 | 392,20 | 328,60 | 161,90 | 127,10 | 80,00 |
| Fourvière | 4428,80 | 6629,60 | 806,30 | 689,00 | 922,80 | 141,60 | 223,30 | 185,00 |
| Croix-Rousse | 3494,30 | 6624,30 | 698,80 | 395,70 | 795,90 | 136,60 | 122,60 | 67,00 |
| Rhône | 3653,60 | 6022,90 | 667,50 | 379,90 | 472,10 | 174,90 | 176,40 | 152,60 |

Ces sauts comprennent le recentrage du terrain, les éventuelles nouvelles tuiles locales et les reconstructions. Ils sont plus exigeants qu’un simple appel à `advance` sur une scène immobile. Fourvière cumule un terrain en pente, une portée de détail plus large, des chemins/escalier et beaucoup de végétation.

## 9. Géométrie, appels de dessin et buffers

| Quartier | Triangles rendus courant / étendu | Appels de dessin courant / étendu | Buffers courant / étendu, Mo | Textures courant / étendu |
| --- | --- | --- | --- | --- |
| Presqu’île | 3 623 139 / 7 436 092 | 432 / 491 | 99,76 / 321,31 | 19 / 22 |
| Fourvière | 7 570 549 / 9 455 621 | 803 / 829 | 122,53 / 238,75 | 22 / 23 |
| Croix-Rousse | 2 711 198 / 7 584 478 | 341 / 416 | 114,34 / 389,14 | 22 / 24 |
| Rhône | 2 663 438 / 6 507 358 | 201 / 250 | 123,67 / 341,12 | 22 / 24 |

Ces vues regardent vers l’ouest (cap 270°), plongée 35°, recul 1 000 m, soleil calculé le 21 juin 2026 à 13:00 UTC. Elles sont prises immédiatement après la construction de chaque point. La caméra n’est pas celle d’un piéton : son champ, les ombres et les blocs éliminés hors champ changent les compteurs. Les comparaisons de coût graphique ne sont donc pas des estimations de FPS.

Répartition des buffers dans la Presqu’île — chaque buffer est compté une seule fois :

| Brique | Triangles instanciés possibles courants | Buffers courants, Mo | Triangles instanciés possibles étendus | Buffers étendus, Mo |
| --- | --- | --- | --- | --- |
| terrain-bubble | 663552 | 13,37 | 663552 | 13,37 |
| relief lointain | 122040 | 2,21 | 122040 | 2,21 |
| vegetation | 1690662 | 3,03 | 1694504 | 3,01 |
| routes | 46751 | 2,62 | 325593 | 19,38 |
| bridge | 12762 | 0,33 | 69770 | 2,12 |
| bâti | 330911 | 35,72 | 1321779 | 142,74 |
| rues | 298705 | 22,00 | 1328619 | 97,94 |
| gardens | 34185 | 3,69 | 135460 | 14,63 |
| furniture | 81352 | 0,99 | 440311 | 9,68 |
| ground-cover | 0 | 10,20 | 0 | 10,20 |
| crops | 0 | 3,20 | 0 | 3,20 |

Les triangles de cette dernière table sont la capacité active des objets instanciés et géométries, **avant** test de visibilité, distances et passes d’ombres. Ils ne doivent pas être comparés comme des triangles effectivement dessinés. Les buffers omettent textures, atlas, DEM, caches, tableaux JavaScript temporaires, matériaux et coûts internes WebGL. Des prototypes partagés sont attribués au premier objet rencontré : la somme totale est plus robuste que cette attribution fine.

L’herbe garde environ **10,20 Mo** de buffers même si aucune instance n’est active dans la Presqu’île. Les cultures gardent environ **3,20 Mo** avec zéro instance sur les quatre points. À Fourvière, les arbres représentent environ **4,9 millions de triangles instanciés possibles**, alors que leurs buffers restent de quelques Mo grâce à l’instanciation. À la Croix-Rousse étendue, **bâti et rues** occupent à eux seuls environ **290 Mo** de buffers. Les rôles CPU, géométrie rendue et mémoire ne se classent donc pas dans le même ordre.

## 10. Travail récurrent : ciel et vivant

Après vidage des files, 120 appels synchrones à `advance(1/60)` et `updateSky`, au même point du Rhône, sont chronométrés **sans `renderer.render`**. Cela isole la mise à jour JavaScript et bénéficie des caches d’une caméra fixe ; ce n’est ni 120 images réelles réparties sur deux secondes ni une mesure de FPS.

| Mise à jour | Total de 120 appels courant, ms | Total de 120 appels étendu, ms |
| --- | --- | --- |
| herbe : advance | 0,00 | 0,10 |
| herbe : update | 0,20 | 0,30 |
| arbres : advance | 0,00 | 0,00 |
| arbres : update | 0,00 | 0,00 |
| cultures : advance | 0,00 | 0,10 |
| cultures : update | 0,00 | 0,30 |
| oiseaux et ballon : advance | 0,30 | 0,50 |
| tracteurs : advance | 0,10 | 0,10 |
| spectateurs : advance | 0,00 | 0,40 |
| trains : advance | 0,10 | 0,00 |
| mobilier animé : advanceSignals | 0,20 | 0,70 |
| mobilier animé : advanceLamps | 0,20 | 1,80 |
| mobilier animé : advanceRotor | 0,00 | 0,00 |
| mobilier animé : advanceLighthouses | 0,10 | 0,00 |
| image complète : advance | 2,10 | 5,60 |
| ciel soleil brouillard : updateSky | 1,20 | 2,10 |

L’appel `advance` complet inclut ses sous-appels, ainsi que l’environnement. Le ciel/soleil/brouillard est remis à jour séparément. Les vagues, le vent des plantes et une partie des déformations se calculent dans les shaders : leurs temps GPU restent inconnus. La préparation des appuis GPU intervient au rendu et n’est pas isolée dans cette table.

Les oiseaux et ballons sont actifs. Les cultures, tracteurs, trains et spectateurs ne sont pas sollicités par une population importante ici. Aucune traversée de bête ni course avec spectateurs n’est déclenchée. Pour ces briques, les appels sans contenu établissent un coût de base, pas un coût de scène complexe. Les lanternes nocturnes, phares côtiers, neige, pluie, mer, parcelles agricoles et faune abondante demandent des cas dédiés ; Lyon ne constitue pas une couverture de tout le catalogue.

## 11. Interprétation et priorités

1. **Réduire les morceaux bloquants de la carte du sol et des largeurs routières.** Les pics de plusieurs centaines de millisecondes existent dans le scénario courant. Allonger les pauses ne les résout pas.
2. **Éviter le recalcul complet du terrain corrigé lorsque ses données pertinentes sont identiques.** Le compteur reste à environ 754 ms à chaud au centre. La maille relit eau et terrassements à ses sommets même quand les relevés DEM sont réutilisés ; un profil plus fin de ces requêtes est nécessaire avant de choisir une optimisation.
3. **Examiner le coût de géométrie des rues.** En scénario étendu, leur médiane CPU est proche de 478 ms, et leurs buffers proches de ceux du bâti. Bordures et maçonnerie méritent autant d’attention que les façades.
4. **Conserver l’analyse du budget de détail séparée du rendu.** Le budget actuel réduit fortement temps et mémoire, mais resserre aussi le pas de relève à 100–167 m. Le coût amorti en déplacement dépend de cette fréquence, pas seulement du coût d’une reconstruction.
5. **Mesurer le GPU sur les appareils cibles.** Les arbres de Fourvière dominent le volume de triangles ; leurs quelques Mo de buffers n’en font pas un rendu léger. Un téléphone, les ombres, les shaders et les transferts réels peuvent changer le classement.

Ces priorités sont des conclusions du relevé, pas des optimisations réalisées. Aucun thème, densité artistique ou rayon du moteur n’a été changé ; le scénario étendu utilise une option existante uniquement dans le banc.

## 12. Vérification visuelle et contrôles

Banc regardé : `demo/lab/performance.html`, scénario courant aux quatre points ci-dessus ; scénario étendu, vues de la Presqu’île, de Fourvière et cadrage proche du Rhône. Les deux scénarios sont rejoués sans réseau. Sur les vues courantes, les fleuves restent bas et continus, les pentes de Fourvière portent des arbres et des rues, et le bâti forme un disque restreint autour du point reconstruit. Sur les vues étendues, les quartiers bâtis couvrent une zone nettement plus grande ; le brouillard bleuit fortement les vues hautes. Dans le cadrage proche du Rhône, baies, toits, rues et une devanture sont lisibles. Ces observations décrivent les captures ; elles ne valident pas toutes les assises ni tous les franchissements.

Reste à contrôler dans la vraie démo : parcours continu et renouvellement du détail, raccords de tuiles en mouvement, appuis fins sur le relief réel, ponts/tunnels et voies ferrées à hauteur d’œil, commerces de nuit, météo, rendu GPU et mémoire après une longue session. Le jugement final sur le paysage reste celui de l’auteur.

Tests avant : **1 097 tests, 1 095 réussis, 2 échecs, 0 ignoré, 0 annulé**. Tests après : **1 097 tests, 1 095 réussis, 2 échecs, 0 ignoré, 0 annulé**. Les deux échecs préexistent : `roadCoverage.test.mjs` cherche `test/fixtures/junctions-nantes.json`, absent ; `roadTerrain.test.mjs` importe `lowestRoadDeckAt`, qui n’est pas exporté. Ils ont été laissés hors périmètre du rapport. Chargement de `src/index.js` et du module du banc réussi. Aucun test ajouté.

Trois avertissements `cliffLayer` « aucune falaise taillée » ont été capturés dans le scénario courant ; le scénario étendu n’en produit aucun. Ils sont conservés dans les mesures brutes. Aucune exception de page ou reconstruction partielle n’a été relevée.

Contrôles isolés complémentaires : terrain 192 × 192, 12 reconstructions, premier passage **40,36 ms**, médiane chaude **2,57 ms**, **73728 triangles**, **186629 lectures DEM** ; instances sur 40 déplacements, **47232 instances**, médiane **4,13 ms**, maximum **6,78 ms**, **3311219.2 octets d’attributs par mise à jour en moyenne**. Ces données synthétiques ne remplacent pas le relevé lyonnais et ne sont pas additionnées à ses couches.

## 13. Reproduire et retrouver les données

`scripts/benchmark-place.mjs <dossier> lyon courant` rejoue le scénario courant ; remplacer `courant` par `etendu` retire le budget de murs. Le script accepte `PLAYWRIGHT_MODULE` pour le module Playwright disponible sur la machine, `CHROMIUM_PATH` pour un Chrome installé, `PORT` pour le serveur local, et `SOFTWARE_RENDER=0` pour employer le rendu matériel. Le défaut emploie SwiftShader et ne doit pas servir à une comparaison de FPS.

Commande utilisée pour le scénario courant :

```sh
PORT=4295 SOFTWARE_RENDER=0 \
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
PLAYWRIGHT_MODULE="/Users/jb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs" \
node scripts/benchmark-place.mjs reports/lyon lyon courant
```

- [Mesures brutes courantes](/Users/jb/Sites/worldpaint/reports/lyon/mesures.json)
- [Mesures brutes étendues](/Users/jb/Sites/worldpaint/reports/lyon-etendu/mesures.json)
- [Capture Presqu’île courante](/Users/jb/Sites/worldpaint/reports/lyon/vue-0.png)
- [Capture Fourvière courante](/Users/jb/Sites/worldpaint/reports/lyon/vue-1.png)
- [Capture Presqu’île étendue](/Users/jb/Sites/worldpaint/reports/lyon-etendu/vue-0.png)
- [Cadrage proche étendu](/Users/jb/Sites/worldpaint/reports/lyon-etendu/rue.png)
- [Banc de mesure](/Users/jb/Sites/worldpaint/demo/lab/performance.html)
- [Instrumentation locale](/Users/jb/Sites/worldpaint/demo/lab/performanceReport.js)
- [Script de mesure](/Users/jb/Sites/worldpaint/scripts/benchmark-place.mjs)

Les empreintes SHA-256 des sources du moteur et du banc livrées sont conservées avec ce rapport pour identifier l’état de travail malgré les modifications non commitées.
