/*
 * parcels — ce qui se lit sur une parcelle : son contour (haie, muret,
 * clôture), ce qu'on y sème (bottes, tas de bois, bêtes), les rangs d'une
 * vigne ou d'un verger, la cour de ferme et les repères d'emprise urbaine.
 *
 * Une parcelle est prise à son **centroïde** : c'est autour de lui que le
 * mobilier se pose et c'est lui qui ancre tous les tirages, donc la même
 * parcelle rend le même décor quel que soit le chemin par lequel on y arrive.
 *
 * Le contour ne se coupe pas à l'emprise routière, il s'en écarte
 * (`pushOutsideCorridor`) : une limite de bocage longe une route sur toute sa
 * longueur, et la couper à chaque sondage l'effacerait entière.
 */

import { lngToTileX, latToTileY } from '../../core/tileMath.js';
import { boundaryForMatrix } from '../../core/regionInterpretation.js';
import { appendProfile, resamplePath } from '../ribbonGeometry.js';
import { HEDGE_SAMPLE_M, hedgeFacets } from '../hedgeGeometry.js';
import { pointInAreas, ringsOf } from '../settlement.js';
import { clipOutsideCorridor, pushOutsideCorridor } from '../roadCorridor.js';
import { BARBED_WIRE_HEIGHTS, GREENHOUSE_BASE_LENGTH_M } from '../furnitureKit.js';
import { WOOD_EDGE_REACH_M } from '../../terrain/groundClassMap.js';
import {
  spacedAlongPath,
  realBoundaryRuns,
  boundaryFurnitureFor,
  scatterFurnitureFor,
  contiguousRuns,
  ringAreaMeters,
  ringCentroid,
  scatterInRing,
  pointInRing,
  randomAt,
  positionSeed,
  ROW_CROPS,
  WOOD_PILE_EDGE_MIN,
  farmingWordFor,
} from '../furniturePlacement.js';
import {
  BOUNDARY_SAMPLE_M,
  BOUNDARY_MIN_LENGTH_M,
  FURNITURE_LIMITS,
  FURNITURE_RADIUS_M,
  FURNITURE_SINK_M,
} from './catalog.js';
import { placeHerd, placeForestGame, placeFauna } from './parcelFauna.js';
import { buildCemetery } from './cemetery.js';

/** Portée des rangs de vigne, de lavande et de verger, en mètres. */
export const ROW_CROP_RADIUS_M = 320;
/** Sel du facettage du feuillage de vigne (`hedgeGeometry.hedgeFacets`) : pas de `style` comme la haie, donc un sel dédié. */
const VINE_ROW_FACET_SALT = 733;
/** Sel du facettage du feuillage de lavande — distinct de celui de la vigne, sinon les deux rangs ondulent à l'identique. */
const LAVENDER_ROW_FACET_SALT = 829;
/**
 * Part des parcelles de vigne conduites sans échalas visible : le rang de
 * feuillage reste, mais aucun cep ne le domine — une conduite basse, sans
 * structure apparente, qu'on croise aussi souvent qu'un rang palissé.
 */
const VINE_UNSTAKED_SHARE = 0.3;
/** Sel du tirage qui décide si une parcelle de vigne porte des ceps visibles. */
const VINE_UNSTAKED_SALT = 761;

/**
 * Seuils de détection d'une cour de ferme — voir `looksLikeFarmstead`.
 * `landuse=farmyard` n'atteint pas les tuiles OpenFreeMap : l'indice qui
 * reste est indirect, une petite parcelle agricole qui porte à elle seule
 * une vraie grappe de bâtiments (`FabricIndex`).
 */
export const FARMSTEAD_MAX_HECTARES = 3;
/** Rayon dans lequel on cherche la grappe de bâtiments, en mètres. */
export const FARMSTEAD_CLUSTER_RADIUS_M = 80;
/** Bâtiments réels requis dans ce rayon — un seul ne fait pas une ferme. */
export const FARMSTEAD_CLUSTER_MIN_BUILDINGS = 2;
/**
 * Part des petits groupes de bâtiments qui remplissent les deux conditions de
 * `looksLikeFarmstead` (petite parcelle agricole, vraie grappe de bâtiments)
 * et sont malgré tout retenus comme une exploitation. Les deux conditions ne
 * suffisent pas à elles seules : la plupart de ces grappes sont quelques
 * maisons côte à côte, pas une ferme — ce tirage, propre au lieu, les
 * départage.
 */
export const FARMSTEAD_SHARE = 0.1;
/** Sel du tirage de `FARMSTEAD_SHARE`. */
const FARMSTEAD_SALT = 211;
/** Sel du tirage qui retire le mot d'assolement d'un champ retombé en labour, pour y reconnaître une serre. */
const GREENHOUSE_FIELD_SALT = 223;

/**
 * Longueur des tunnels de serre — voir `placeFarmstead`. En dessous du
 * minimum, le tunnel redevient le petit modèle de catalogue
 * (`GREENHOUSE_BASE_LENGTH_M`) ; au-delà du maximum, une voûte continue se
 * lirait comme un hangar sans fin.
 */
export const GREENHOUSE_MIN_LENGTH_M = 12;
export const GREENHOUSE_MAX_LENGTH_M = 60;
/** Écart centre à centre entre deux tunnels voisins, en mètres (largeur 4,2 m + une allée). */
export const GREENHOUSE_SPACING_M = 6;

/**
 * Contours et intérieurs des parcelles : haies, murets, clôtures, bottes de
 * foin, bosquets et bâtiments de ferme.
 */
export function buildParcels(layer, context, builtUp) {
  const { source, tiles, here, sampleElevation, buffers, placements } = context;
  const { origin, scale, zoom } = layer.bubble.frame;
  let boundaries = 0;
  let scattered = 0;
  let farmBuildings = 0;
  let urbanPlaced = 0;

  const handle = (geometry, properties, bounds) => {
    for (const ring of ringsOf(geometry)) {
      const local = ring.map(([lng, lat]) => ({
        x: (lngToTileX(lng, zoom) - origin.x) * scale,
        z: (latToTileY(lat, zoom) - origin.y) * scale,
      }));
      if (local.length < 4) continue;

      // Le mobilier de parcelle se pose **autour d'un centre** — bâtiments de
      // ferme, rangs de vigne, bottes de foin —, donc la distance au
      // centroïde est la bonne mesure. La culture, elle, ne passe plus par
      // ici : elle est peinte dans la carte des cultures, qui couvre 4 km et
      // ne connaît pas cette limite.
      const centre = ringCentroid(local);
      if (Math.hypot(centre.x - here.x, centre.z - here.z) > FURNITURE_RADIUS_M) continue;

      // Repères urbains : un par emprise reconnue — cimetière, zone
      // industrielle, stade, champ de foire. Avant le filtre « hors zone
      // habitée » ci-dessous, et pour cause : une zone industrielle **est**
      // elle-même une classe bâtie (`BUILT_UP_CLASSES`), donc son propre
      // centroïde tombe dans son propre périmètre — filtrée après coup, sa
      // cheminée ne se poserait jamais. Un seul repère par polygone, jamais
      // un semis : ce sont des équipements, pas de la végétation. Une petite
      // emprise mal classée (une chapelle de lotissement, un atelier isolé)
      // n'a pas la taille de ce qu'elle prétend être et ne reçoit rien.
      const urbanKind = urbanLanduseKind(properties.class);
      if (urbanKind && urbanPlaced < FURNITURE_LIMITS.urbanLandmarks && !layer._onRoad(centre.x, centre.z)) {
        const hectares = ringAreaMeters(local) / 10000;
        const minHectares = urbanKind === 'cemeteryCross' ? 0.15 : urbanKind === 'stadium' ? 0.3 : 0.4;
        if (hectares >= minHectares) {
          const placed = layer._place(placements, urbanKind, {
            x: centre.x,
            z: centre.z,
            yaw: randomAt(centre.x, centre.z, 191) * Math.PI * 2,
          });
          // La croix posée plus haut ne marquait le site que d'un seul
          // repère ; ce qui suit l'habille — mur, portail, tombes, robinet.
          if (placed && urbanKind === 'cemeteryCross') {
            buildCemetery(layer, context, local, centre);
          }
          urbanPlaced++;
        }
      }

      if (pointInAreas(builtUp, centre.x, centre.z)) continue;

      const steepness = layer._steepnessAt(centre.x, centre.z);
      const variant = randomAt(centre.x, centre.z, 7);
      // La culture n'est **pas tirée ici** : elle est lue dans la carte des
      // cultures, qui l'a tirée une fois pour toutes et que lisent aussi le
      // shader de terrain et `cropLayer`. Le mobilier s'en sert pour savoir
      // qu'un champ en culture ne se clôt pas et qu'on n'y sème pas de bottes
      // de foin — et il aurait été absurde qu'il en décide autrement que ce
      // qui pousse effectivement dessus.
      let crop = layer.groundClass?.cropAt?.(centre.x, centre.z) ?? null;

      // La serre n'a pas de case dans `CROP_KINDS` (déjà pleine) : un champ
      // qui y retombe en labour est retiré du tirage de l'assolement pour
      // savoir s'il s'agissait en réalité d'un maraîchage sous serre — seul
      // cas où le mobilier lit l'assolement au lieu de la seule carte des
      // cultures, faute d'une traduction pour le porter.
      if (crop === 'plough' && layer.region?.farming?.includes('greenhouse')) {
        const word = farmingWordFor(
          properties,
          randomAt(centre.x, centre.z, GREENHOUSE_FIELD_SALT),
          layer.region.farming
        );
        if (word === 'greenhouse') crop = 'greenhouse';
      }

      // Cour de ferme : les bâtiments d'exploitation, à la vraie place.
      // Voir `looksLikeFarmstead` — `landuse=farmyard` n'existe pas dans
      // cette donnée, l'indice est indirect — et `FARMSTEAD_SHARE`, qui
      // départage les grappes de bâtiments qui ne sont que des maisons.
      if (
        farmBuildings < FURNITURE_LIMITS.farmBuildings &&
        looksLikeFarmstead(layer, properties, local, centre) &&
        randomAt(centre.x, centre.z, FARMSTEAD_SALT) < FARMSTEAD_SHARE
      ) {
        farmBuildings += placeFarmstead(layer, placements, local, centre);
      }

      if (crop && ROW_CROPS.has(crop)) buildRows(layer, context, local, centre, crop, here);
      if (crop && crop !== 'orchard') placeTractor(layer, context, local, centre, crop, here);

      // Le budget de contours ne coupe **que** les contours : les parcelles
      // arrivent dans l'ordre des tuiles et non des distances, et un budget
      // qui arrêterait le parcours entier priverait de cour de ferme et de
      // rangs de vigne ce qui est sous les roues de l'observateur.
      const kind =
        boundaries < FURNITURE_LIMITS.boundaries
          ? boundaryFurnitureFor(properties, {
              steepness,
              variant,
              crop,
              boundary: boundaryForMatrix(layer.region?.matrix),
            })
          : null;
      if (kind) {
        boundaries += appendParcelBoundary(layer, buffers, placements, kind, ring, bounds, sampleElevation, here);
      }

      if (scattered < FURNITURE_LIMITS.scatter) {
        scattered += scatterInside(layer, placements, properties, local, centre, variant, steepness, crop);
      }
    }
  };

  source.forEachFeature('landcover', tiles, handle);
  source.forEachFeature('landuse', tiles, handle);
  layer.counts.boundaries = boundaries;
}

/**
 * Forme urbaine correspondant à une classe `landuse`, ou `null`.
 *
 * `cemetery` et `stadium` sont des classes `landuse` vérifiées dans ce
 * projet (`groundClassMap.surfaceFor` les peint déjà en herbe).
 * `industrial` l'est également. `fairground`, en revanche, est une
 * supposition — la même réserve que `poiItem` s'applique.
 */
export function urbanLanduseKind(klass) {
  if (klass === 'cemetery') return 'cemeteryCross';
  if (klass === 'industrial') return 'factoryChimney';
  if (klass === 'stadium') return 'stadium';
  if (klass === 'fairground') return 'ferrisWheel';
  return null;
}

/**
 * Pose un contour de parcelle, en n'en gardant que les tronçons réels.
 * @returns {number} nombre de tronçons posés.
 */
export function appendParcelBoundary(layer, buffers, placements, kind, ring, bounds, sampleElevation, here = null) {
  let placed = 0;

  for (const run of realBoundaryRuns(ring, bounds)) {
    const { origin, scale, zoom } = layer.bubble.frame;
    const local = run.map(([lng, lat]) => ({
      x: (lngToTileX(lng, zoom) - origin.x) * scale,
      z: (latToTileY(lat, zoom) - origin.y) * scale,
    }));

    const sampled = resamplePath(local, BOUNDARY_SAMPLE_M);
    if (sampled.length < 3) continue;
    if (sampled[sampled.length - 1].distance < BOUNDARY_MIN_LENGTH_M) continue;

    // Un contour de parcelle suit très souvent le bord d'une route sur toute
    // sa longueur — c'est la définition même du bocage. Le couper à chaque
    // sondage qui tombe dans l'emprise ne laisserait aucun tronçon dehors :
    // toute la haie disparaîtrait, faute d'un point réellement extérieur d'où
    // repartir. On la repousse donc au ras de l'emprise plutôt qu'on ne
    // l'interrompt — c'est elle qui trace le bocage, pas la route. Voie
    // ferrée comprise : un contour de parcelle longe un talus de chemin de
    // fer aussi souvent qu'une route.
    const pushed = pushOutsideCorridor(sampled, layer._infraIndex);
    if (pushed.length < 3) continue;

    // Le refoulement ne peut pas tout : là où deux chaussées se longent ou
    // se rejoignent en Y, les emprises se recouvrent et **aucune** position
    // libre n'existe. `pushOutsideCorridor` rend alors le point tel quel,
    // c'est-à-dire sur le bitume. Ce qui y reste est donc coupé — sur la
    // chaussée stricte, pas sur l'emprise : le refoulement s'occupe déjà de
    // l'accotement, et couper à l'emprise hacherait le bocage à chaque
    // courbe, faute des quinze centimètres de garde que le refoulement laisse.
    for (const path of clipOutsideCorridor(pushed, layer._infraIndex, 0, { minLength: BOUNDARY_MIN_LENGTH_M })) {
      // Un muret de pierre sèche est un balayage facetté ; une haie est un
      // alignement d'arbustes, et se bâtit comme tel.
      if (kind === 'hedge' || kind === 'lowHedge') {
        layer._appendHedgerow(buffers[kind], kind, path, sampleElevation, { here });
        placed++;
        continue;
      }

      if (kind === 'dryStoneWall') {
        layer._appendDryStoneWall(buffers[kind], path, sampleElevation);
        placed++;
        continue;
      }

      // Clôtures : des piquets instanciés, et — pour le barbelé — trois brins
      // tendus. Un grillage plein serait un mur ; ici on doit voir au travers.
      const wood = kind === 'woodFence';
      for (const post of spacedAlongPath(path, wood ? 2.6 : 3.4, { margin: 0.5 })) {
        layer._place(placements, wood ? 'fencePostWood' : 'fencePostConcrete', {
          x: post.x,
          z: post.z,
          yaw: Math.atan2(post.tx, post.tz),
        });
      }
      for (const height of wood ? [0.5, 0.95] : BARBED_WIRE_HEIGHTS) {
        appendProfile(buffers.wire, {
          path,
          profile: layer.specs.profiles.wire,
          sampleElevation,
          lift: height,
          closed: true,
        });
      }
      placed++;
    }
  }

  return placed;
}

/**
 * Rangs d'une parcelle plantée en lignes : vigne, lavande et verger.
 *
 * ## Ce qui fait lire un vignoble — ou un champ de lavande
 *
 * Ce n'est pas le pied isolé, c'est le **rang** — des lignes parallèles,
 * régulières, orientées toutes pareil, qui filent jusqu'au bout de la
 * parcelle. Le semer en vrac donnerait un buisson par-ci par-là ; le semer en
 * rangs donne un vignoble, ou une lavande, même avec la moitié moins de
 * géométrie. Une vigne y ajoute parfois un cep par pied (`vineStock`) ; une
 * lavande n'en a pas besoin, sa haie basse suffit à se faire reconnaître.
 *
 * La direction n'est pas tirée au sort : elle vient du **plus long côté** de
 * la parcelle, qui est ce que suit le planteur. Chaque rang est ensuite
 * découpé aux vraies limites du champ (`contiguousRuns` sur l'appartenance à
 * l'anneau), donc les rangs s'arrêtent où le champ s'arrête et non sur une
 * boîte englobante.
 */
export function buildRows(layer, context, ring, centre, crop, here) {
  if (Math.hypot(centre.x - here.x, centre.z - here.z) > ROW_CROP_RADIUS_M) return;
  if (layer.counts.rows >= FURNITURE_LIMITS.vineRows) return;

  const { buffers, placements, sampleElevation } = context;
  const angle = principalAngle(ring);
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  // Une parcelle de vigne conduite sans échalas l'est sur toute sa
  // longueur — pas rang par rang, ce qui ferait alterner cep et sans-cep dans
  // le même champ.
  const vineUnstaked = crop === 'vineyard' && randomAt(centre.x, centre.z, VINE_UNSTAKED_SALT) < VINE_UNSTAKED_SHARE;
  // Perpendiculaire : c'est le long d'elle que les rangs s'échelonnent.
  const spacing =
    crop === 'vineyard' ? 2.4 : crop === 'lavender' ? 1.4 : crop === 'greenhouse' ? GREENHOUSE_SPACING_M : 7;
  const step = crop === 'vineyard' ? 3 : crop === 'lavender' ? 4 : 6;

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of ring) {
    const u = (p.x - centre.x) * dirX + (p.z - centre.z) * dirZ;
    const v = -(p.x - centre.x) * dirZ + (p.z - centre.z) * dirX;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  if (!Number.isFinite(minU) || maxU - minU < spacing * 2) return;

  for (let v = minV + spacing * 0.5; v <= maxV && layer.counts.rows < FURNITURE_LIMITS.vineRows; v += spacing) {
    const samples = [];
    for (let u = minU; u <= maxU; u += step) {
      samples.push({
        x: centre.x + dirX * u - dirZ * v,
        z: centre.z + dirZ * u + dirX * v,
        distance: u - minU,
      });
    }
    for (const run of contiguousRuns(samples, (s) => pointInRing(ring, s.x, s.z), 3)) {
      const origin = run[0].distance;
      const rowPath = run.map((s) => ({ x: s.x, z: s.z, distance: s.distance - origin }));
      // Un rang est déjà découpé aux limites du champ ; il lui reste à
      // s'arrêter au bord de la route qui le traverse. Le pas des rangs (3 à
      // 6 m) est trop lâche pour repérer une voie communale : c'est la
      // découpe d'emprise, qui sonde au mètre, qui s'en charge.
      for (const path of layer._clipOffRoad(rowPath, { minLength: 0 })) {
        if (crop === 'vineyard') {
          // Rééchantillonné plus fin que le pas du rang (3 m) avant le
          // balayage : c'est ce même pas fin (`HEDGE_SAMPLE_M`, réemployé
          // ici faute d'un pas propre à la vigne) qui fixe l'espacement des
          // arêtes facettées, comme pour une haie.
          const fine = resamplePath(path, HEDGE_SAMPLE_M);
          const dense = fine.length >= 2 ? fine : path;
          const facets = hedgeFacets(dense, VINE_ROW_FACET_SALT);
          appendProfile(buffers.vineRow, {
            path: dense,
            profile: layer.specs.profiles.vineRow,
            sampleElevation,
            lift: -FURNITURE_SINK_M,
            closed: true,
            scaleUp: facets.up,
            scaleAcross: facets.across,
            lateralJitter: facets.lateral,
            smoothRadius: Math.round(6 / HEDGE_SAMPLE_M),
          });
          // Un rang sans échalas (`vineUnstaked`) n'est que ce feuillage : pas
          // de cep, pas de fil visible au-dessus.
          if (!vineUnstaked) {
            for (const stock of spacedAlongPath(path, 1.2, { margin: 0.4 })) {
              layer._place(placements, 'vineStock', { x: stock.x, z: stock.z, yaw: angle });
            }
          }
        } else if (crop === 'lavender') {
          // Même traitement que le rang de vigne, sur une haie plus basse et
          // plus étroite : c'est le rang qui fait reconnaître un champ de
          // lavande, pas un pied isolé — voir `lavenderRow`.
          const fine = resamplePath(path, HEDGE_SAMPLE_M);
          const dense = fine.length >= 2 ? fine : path;
          const facets = hedgeFacets(dense, LAVENDER_ROW_FACET_SALT);
          appendProfile(buffers.lavenderRow, {
            path: dense,
            profile: layer.specs.profiles.lavenderRow,
            sampleElevation,
            lift: -FURNITURE_SINK_M,
            closed: true,
            scaleUp: facets.up,
            scaleAcross: facets.across,
            lateralJitter: facets.lateral,
            smoothRadius: Math.round(4 / HEDGE_SAMPLE_M),
          });
        } else if (crop === 'greenhouse') {
          // Un tunnel par tronçon, pas un semis : la longueur réelle du
          // tronçon (déjà découpé aux limites du champ et de la route) fait
          // la longueur du tunnel, comme `greenhouseLengthFor` le fait pour
          // celui de `placeFarmstead`.
          const first = path[0];
          const last = path[path.length - 1];
          const runLength = Math.hypot(last.x - first.x, last.z - first.z);
          if (runLength >= GREENHOUSE_MIN_LENGTH_M) {
            const length = Math.min(GREENHOUSE_MAX_LENGTH_M, runLength);
            layer._place(placements, 'greenhouse', {
              x: (first.x + last.x) / 2,
              z: (first.z + last.z) / 2,
              yaw: angle,
              scaleZ: length / GREENHOUSE_BASE_LENGTH_M,
            });
          }
        } else {
          for (const tree of spacedAlongPath(path, 6, { margin: 1 })) {
            layer._place(placements, 'treeBroad', {
              x: tree.x,
              z: tree.z,
              yaw: randomAt(tree.x, tree.z, 67) * Math.PI * 2,
              // Un verger est planté d'arbres taillés bas et de taille égale :
              // c'est exactement ce qui le distingue d'un bois.
              scale: 0.55 + randomAt(tree.x, tree.z, 68) * 0.12,
            });
          }
        }
        layer.counts.rows++;
      }
    }
  }
}

/**
 * Direction du plus long côté d'un anneau, en radians.
 *
 * C'est la direction dans laquelle une parcelle est travaillée : les rangs, les
 * sillons et les andains la suivent. Un angle tiré au sort donnerait des
 * vignes en travers du coteau, ce qui n'existe pas.
 */
export function principalAngle(ring) {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length > best) {
      best = length;
      angle = Math.atan2(b.z - a.z, b.x - a.x);
    }
  }
  return angle;
}

/** Rayon dans lequel un tracteur est posé, en mètres. */
export const TRACTOR_RADIUS_M = 400;
/** Part des parcelles cultivées, assez grandes, qui reçoivent un tracteur au travail. */
export const TRACTOR_SHARE = 0.12;
const TRACTOR_SALT = 887;
/** Longueur maximale d'un passage, en mètres — un aller-retour, pas la traversée du champ. */
export const TRACTOR_PASS_MAX_M = 55;
/** Vitesse d'un tracteur au travail, en mètres par seconde. */
export const TRACTOR_SPEED_MIN_MS = 1.1;
export const TRACTOR_SPEED_MAX_MS = 1.8;

/**
 * Tracteur au travail dans un champ cultivé : un aller-retour le long du sens
 * du travail (`principalAngle`), coupé aux vraies limites du champ comme un
 * rang de vigne (`buildRows`) — jamais une ligne posée en travers d'une
 * parcelle en croissant ou en L.
 *
 * Posé sur toute culture sauf le verger : un tracteur y roulerait sous des
 * arbres qu'on ne verrait pas depuis la route, ce qui trahirait la scène plus
 * qu'il ne la confirmerait.
 *
 * Publié dans `layer.tractors` pour `tractorLayer`, qui le rejoue par image :
 * ce n'est plus du mobilier immobile, c'est ancré au sol comme une bête (voir
 * l'en-tête de `tractorLayer.js`), donc soumis au même déterminisme spatial —
 * la graine vient du centre de la parcelle, jamais de l'ordre de parcours.
 */
export function placeTractor(layer, context, ring, centre, crop, here) {
  if (!crop || crop === 'orchard') return;
  if (Math.hypot(centre.x - here.x, centre.z - here.z) > TRACTOR_RADIUS_M) return;
  if (!layer.tractors || layer.tractors.length >= FURNITURE_LIMITS.vehicles) return;
  if (randomAt(centre.x, centre.z, TRACTOR_SALT) >= TRACTOR_SHARE) return;

  const { sampleElevation } = context;
  const angle = principalAngle(ring);
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);

  let minU = Infinity;
  let maxU = -Infinity;
  for (const p of ring) {
    const u = (p.x - centre.x) * dirX + (p.z - centre.z) * dirZ;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
  }
  if (!Number.isFinite(minU) || maxU - minU < 16) return;

  const samples = [];
  for (let u = minU; u <= maxU; u += 4) {
    samples.push({ x: centre.x + dirX * u, z: centre.z + dirZ * u, u });
  }
  const runs = contiguousRuns(samples, (s) => pointInRing(ring, s.x, s.z), 3);
  if (runs.length === 0) return;
  // Le plus long passage possible, dans les vraies limites du champ.
  let best = runs[0];
  for (const run of runs) if (run.length > best.length) best = run;
  if (best.length < 5) return;

  const first = best[0];
  const last = best[best.length - 1];
  const span = Math.min(TRACTOR_PASS_MAX_M, last.u - first.u);
  // Centré dans le passage retenu plutôt que posé sur toute sa longueur — un
  // grand champ n'a pas besoin d'un aller-retour de trois cents mètres pour
  // qu'on croie au labour.
  const mid = (first.u + last.u) / 2;
  const startU = mid - span / 2;
  const endU = mid + span / 2;
  const start = { x: centre.x + dirX * startU, z: centre.z + dirZ * startU };
  const end = { x: centre.x + dirX * endU, z: centre.z + dirZ * endU };

  const a = { x: start.x, y: sampleElevation(start.x, start.z), z: start.z };
  const b = { x: end.x, y: sampleElevation(end.x, end.z), z: end.z };
  const headingForward = Math.atan2(b.x - a.x, b.z - a.z);
  const speed =
    TRACTOR_SPEED_MIN_MS + randomAt(centre.x, centre.z, TRACTOR_SALT + 1) * (TRACTOR_SPEED_MAX_MS - TRACTOR_SPEED_MIN_MS);
  const phase = randomAt(centre.x, centre.z, TRACTOR_SALT + 2) * 60;

  layer.tractors.push({ a, b, headingForward, speed, phase });
}

/** Sème l'intérieur d'une parcelle. @returns {number} objets posés. */
export function scatterInside(layer, placements, properties, ring, centre, variant, steepness = 0, crop = null) {
  const rule = scatterFurnitureFor(properties, { crop });
  if (!rule) return 0;

  const hectares = ringAreaMeters(ring) / 10000;
  if (hectares < 0.4) return 0;
  // Arrondi stochastique : sans lui,
  // `floor` renvoyait zéro pour **toute** parcelle sous le seuil d'un
  // exemplaire plein — pour un troupeau (1,1/ha), tout pré de moins de
  // 0,91 ha, c'est-à-dire l'essentiel du bocage. Un pré de 0,5 ha a une
  // espérance de 0,55 bête : avec un tirage ancré au lieu en jitter, il en
  // porte une un peu plus d'une fois sur deux, au lieu de jamais.
  const expected = hectares * rule.perHectare;
  const jitter = randomAt(centre.x, centre.z, 45);
  const count = Math.min(24, Math.floor(expected + jitter));
  if (count <= 0) return 0;

  const seed = positionSeed(centre.x, centre.z, 41);
  let placed = 0;

  if (rule.item === 'herd') return placeHerd(layer, ring, centre, variant, steepness, count);
  if (rule.item === 'woodland') {
    return (
      placeWoodPiles(layer, placements, ring, centre, count) +
      placeForestGame(layer, ring, centre, variant, hectares)
    );
  }

  // Rondes ou parallélépipédiques, mais pas les deux dans le même champ : une
  // moissonneuse ne change pas de presse au milieu d'une parcelle. Les bottes
  // s'alignent en outre sur le sens du travail de la parcelle, comme les
  // andains qu'elles suivent.
  const item = variant < 0.6 ? 'hayBaleRound' : 'hayBaleSquare';
  const heading = principalAngle(ring);
  // Une route qui traverse le champ n'y interdit pas la moisson : elle
  // interdit d'en poser une botte sur la chaussée. Le semis n'est pas
  // redistribué pour autant — on retire, on ne recompose pas, sinon la même
  // parcelle changerait de bottes à chaque reconstruction.
  for (const spot of layer._filterOffInfra(scatterInRing(ring, count, seed))) {
    layer._place(placements, item, {
      x: spot.x,
      z: spot.z,
      yaw: heading + (spot.variant - 0.5) * 0.25,
    });
    placed++;
  }
  return placed;
}

/**
 * Range du bois de coupe en lisière.
 *
 * Un tas de bois ne se fait pas au milieu d'un massif : il est empilé au
 * bord, là où le tracteur passe. Le semis est celui de toutes les parcelles,
 * et c'est l'ourlet (`groundClass.woodEdgeAt`) qui en écarte l'essentiel — un
 * massif compact en porte donc proportionnellement moins qu'un bosquet.
 *
 * Sans carte de classes, personne ne sait où est le bord : rien ne se pose,
 * ce qui vaut mieux qu'un tas de bois au hasard en plein bois.
 */
export function placeWoodPiles(layer, placements, ring, centre, count) {
  const groundClass = layer.groundClass;
  if (!groundClass?.woodEdgeAt) return 0;

  const seed = positionSeed(centre.x, centre.z, 71);
  let placed = 0;
  // Ni sur la chaussée ni sur le ballast, comme les bottes et le bétail.
  for (const spot of layer._filterOffInfra(scatterInRing(ring, count, seed))) {
    if (groundClass.woodEdgeAt(spot.x, spot.z) < WOOD_PILE_EDGE_MIN) continue;
    layer._place(placements, 'woodPile', {
      x: spot.x,
      z: spot.z,
      yaw: woodEdgeYaw(layer, spot.x, spot.z, spot.variant),
    });
    placed++;
  }
  return placed;
}

/**
 * Cap d'un tas de bois : le long de la lisière, comme il est empilé le long
 * du chemin qui le dessert. La direction de l'ourlet est la perpendiculaire
 * au gradient de boisé, mesuré sur le même voisinage que `woodEdgeAt`.
 *
 * `yaw` fait tourner l'objet autour de Y, et les rondins de `woodPile` sont
 * couchés selon Z : amener +Z sur une direction (dx, dz) demande
 * `π/2 − atan2(dz, dx)`. Sans pente lisible — un tirage tombé dans une
 * clairière parfaitement ronde —, un cap tiré au lieu vaut mieux qu'un cap
 * nul, qui alignerait toutes les piles sur l'axe des X.
 */
export function woodEdgeYaw(layer, x, z, jitter = 0) {
  const wood = (dx, dz) => layer.groundClass?.woodAt?.(x + dx, z + dz) ?? 0;
  const r = WOOD_EDGE_REACH_M;
  const gx = wood(r, 0) - wood(-r, 0);
  const gz = wood(0, r) - wood(0, -r);
  if (gx === 0 && gz === 0) return jitter * Math.PI * 2;
  // Bord = perpendiculaire au gradient, donc la direction (−gz, gx).
  return Math.PI / 2 - Math.atan2(gx, -gz);
}

/**
 * Vrai si une parcelle agricole a la forme d'une cour de ferme — voir
 * `FARMSTEAD_MAX_HECTARES` pour pourquoi ce n'est qu'un indice indirect.
 *
 * Deux conditions, et les deux sont nécessaires :
 *
 * 1. **une petite parcelle**, agricole ou pâture — pas les cinquante
 *    hectares d'openfield qu'elle borde. Au-delà du plafond, le centroïde
 *    n'a plus de raison de tomber près d'un bâtiment : ce n'est plus la cour
 *    de la ferme, c'est un de ses champs ;
 * 2. **une vraie grappe de bâtiments** relevée par `FabricIndex`, à portée
 *    du centroïde. Une maison isolée en pleine campagne est un pavillon, pas
 *    une exploitation ; deux bâtiments groupés hors d'un périmètre habité en
 *    sont une.
 *
 * Sans `FabricIndex` (`fabric` absent de `rebuild`), personne ne sait
 * combien de bâtiments compte le voisinage : cette exploitation ne se pose
 * pas, ce qui est le bon repli — même raison que `buildVillageLandmarks`.
 *
 * Fonction pure à ceci près qu'elle lit `layer._fabric`, posé par `rebuild`
 * pour la durée de la reconstruction.
 */
export function looksLikeFarmstead(layer, properties, local, centre) {
  if (!layer._fabric) return false;

  const klass = properties.class;
  const subclass = properties.subclass;
  const isFarmland = klass === 'farmland';
  const isPasture = klass === 'grass' && (subclass === 'meadow' || subclass === 'grassland');
  if (!isFarmland && !isPasture) return false;

  if (ringAreaMeters(local) / 10000 > FARMSTEAD_MAX_HECTARES) return false;

  return (
    layer._fabric.countWithin(centre.x, centre.z, FARMSTEAD_CLUSTER_RADIUS_M, FARMSTEAD_CLUSTER_MIN_BUILDINGS) >=
    FARMSTEAD_CLUSTER_MIN_BUILDINGS
  );
}

/** Écart latéral testé par `greenhouseAnchorFor`, en mètres — un cran de plus que l'écartement des tunnels (`GREENHOUSE_SPACING_M`), pour que le rang déplacé ne recouvre pas la position d'origine. */
const GREENHOUSE_RELOCATE_STEP_M = GREENHOUSE_SPACING_M * 2;
/** Nombre de crans testés de chaque côté avant de renoncer. */
const GREENHOUSE_RELOCATE_TRIES = 5;

/**
 * Point d'ancrage du rang de serres, écarté d'une culture en cours si
 * nécessaire — voir `placeFarmstead`.
 *
 * L'ancrage par défaut (`base`, à côté du hangar) porte presque toujours un
 * pré ou une jachère. Sur une parcelle en culture (blé, maïs...), planter un
 * tunnel en pleine culture ne se lirait pas comme du maraîchage : on cherche
 * alors, perpendiculairement à l'axe de la ferme (`perpX`/`perpZ`, le même
 * axe que les tunnels), le premier point sans culture qui reste dans la
 * parcelle.
 *
 * Sans carte de cultures (`groundClass` absent, comme dans les tests qui
 * posent une ferme hors reconstruction), l'ancrage par défaut est rendu tel
 * quel — on ne sait pas qu'il faudrait le déplacer.
 *
 * N'est tentée que sur une petite parcelle (`FARMSTEAD_MAX_HECTARES`, le même
 * plafond que `looksLikeFarmstead`) : au-delà, une culture rencontrée ici n'a
 * aucune raison de border un pré proche, et deviner un décalage vaudrait
 * moins que ne poser aucune serre.
 *
 * @returns {{x:number,z:number}|null} `null` si aucun point sans culture n'a
 *          été trouvé — renoncer plutôt que planter en pleine culture.
 */
export function greenhouseAnchorFor(layer, ring, base, perpX, perpZ) {
  const groundClass = layer.groundClass;
  if (!groundClass?.cropAt) return base;
  if (!groundClass.cropAt(base.x, base.z)) return base;

  if (ringAreaMeters(ring) / 10000 > FARMSTEAD_MAX_HECTARES) return null;

  for (let i = 1; i <= GREENHOUSE_RELOCATE_TRIES; i++) {
    for (const sign of [1, -1]) {
      const x = base.x + perpX * GREENHOUSE_RELOCATE_STEP_M * i * sign;
      const z = base.z + perpZ * GREENHOUSE_RELOCATE_STEP_M * i * sign;
      if (!pointInRing(ring, x, z)) continue;
      if (!groundClass.cropAt(x, z)) return { x, z };
    }
  }
  return null;
}

/**
 * Pose une exploitation : grange, hangar, un ou deux silos — et ce qui la
 * rend habitée : une cheminée qui fume, du linge qui sèche, des poules.
 *
 * Ces trois-là ne sont pas du décor gratuit. Une ferme sans eux est un
 * assemblage de volumes ; avec eux, on la lit comme un lieu où quelqu'un vit,
 * et c'est le plus grand écart de réalisme pour le moins de triangles de tout
 * le catalogue.
 */
export function placeFarmstead(layer, placements, ring, centre) {
  const yaw = randomAt(centre.x, centre.z, 13) * Math.PI * 2;
  const draw = randomAt(centre.x, centre.z, 17);

  const barn = layer._place(placements, 'barn', { x: centre.x, z: centre.z, yaw });
  const offX = Math.cos(yaw) * 24;
  const offZ = Math.sin(yaw) * 24;
  layer._place(placements, 'hangar', { x: centre.x + offX, z: centre.z + offZ, yaw: yaw + 0.3 });

  const silos = draw < 0.5 ? 1 : 2;
  for (let i = 0; i < silos; i++) {
    layer._place(placements, 'silo', {
      x: centre.x - offZ * 0.5 + i * 6.2,
      z: centre.z + offX * 0.5,
      yaw,
    });
  }

  // Serres : un maraîchage plutôt qu'une exploitation céréalière, sur un
  // tirage propre à la ferme — indépendant de celui des silos, pour qu'une
  // exploitation ne cumule pas systématiquement les deux. Le tirage est
  // délibérément généreux : une exploitation elle-même reste rare
  // (`looksLikeFarmstead`), inutile d'empiler une seconde rareté dessus.
  if (randomAt(centre.x, centre.z, 31) < 0.4) {
    // Un rang, dans le sens de la ferme (même axe que la grange et le
    // hangar) — pas un semis : un maraîchage réel aligne ses tunnels côte à
    // côte, tous parallèles à l'allée qui les dessert. Chaque tunnel court
    // sur la longueur réelle de la parcelle plutôt que sur la cote fixe du
    // modèle : voir `greenhouseLengthFor`.
    const perpX = -Math.sin(yaw);
    const perpZ = Math.cos(yaw);
    const base = { x: centre.x + offX * 1.6, z: centre.z + offZ * 1.6 };
    // Un tunnel planté en pleine culture ne se lirait pas comme du maraîchage :
    // voir `greenhouseAnchorFor`.
    const anchor = greenhouseAnchorFor(layer, ring, base, perpX, perpZ);
    if (anchor) {
      const rowCount = randomAt(centre.x, centre.z, 37) < 0.55 ? 2 : 3;
      const length = greenhouseLengthFor(ring, centre, yaw);
      const scaleZ = length / GREENHOUSE_BASE_LENGTH_M;

      for (let i = 0; i < rowCount; i++) {
        const lateral = (i - (rowCount - 1) / 2) * GREENHOUSE_SPACING_M;
        layer._place(placements, 'greenhouse', {
          x: anchor.x + perpX * lateral,
          z: anchor.z + perpZ * lateral,
          yaw,
          scaleZ,
        });
      }
    }
  }

  // Fil à linge, au vent, derrière la grange.
  const lineX = centre.x - offZ * 0.42;
  const lineZ = centre.z + offX * 0.42;
  layer._place(placements, 'laundryLine', { x: lineX, z: lineZ, yaw: yaw + Math.PI / 2 });

  // Poules dans la cour : elles ne s'éloignent jamais beaucoup du bâtiment.
  const hens = 4 + Math.floor(randomAt(centre.x, centre.z, 19) * 5);
  for (let i = 0; i < hens; i++) {
    const angle = randomAt(centre.x + i * 3.1, centre.z, 23) * Math.PI * 2;
    const radius = 6 + randomAt(centre.x, centre.z + i * 3.1, 29) * 7;
    placeFauna(layer, 'chicken', {
      x: centre.x + Math.cos(angle) * radius,
      z: centre.z + Math.sin(angle) * radius,
      scale: 0.9 + randomAt(centre.x, centre.z + i * 5.3, 31) * 0.25,
    });
  }

  return 1;
}

/**
 * Longueur de tunnel de serre qui tient dans la parcelle, dans le sens de
 * la ferme (`yaw`, le même axe que la grange et le hangar) — voir
 * `placeFarmstead`.
 *
 * Projection des sommets de l'anneau sur cet axe : l'écart entre le plus
 * loin en avant et le plus loin en arrière du centroïde est ce que la
 * parcelle offre réellement comme longueur, quelle que soit sa forme.
 * Bornée par `GREENHOUSE_MIN_LENGTH_M`/`GREENHOUSE_MAX_LENGTH_M` — voir
 * leur commentaire pour pourquoi les deux bouts sont utiles.
 *
 * Fonction pure.
 */
export function greenhouseLengthFor(ring, centre, yaw) {
  const dirX = Math.cos(yaw);
  const dirZ = Math.sin(yaw);
  let min = Infinity;
  let max = -Infinity;
  for (const p of ring) {
    const proj = (p.x - centre.x) * dirX + (p.z - centre.z) * dirZ;
    if (proj < min) min = proj;
    if (proj > max) max = proj;
  }
  if (!(max > min)) return GREENHOUSE_MIN_LENGTH_M;
  return Math.min(GREENHOUSE_MAX_LENGTH_M, Math.max(GREENHOUSE_MIN_LENGTH_M, max - min));
}
