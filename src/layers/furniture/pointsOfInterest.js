/*
 * pointsOfInterest — les seuls objets de mobilier que le schéma OpenMapTiles
 * porte nommément : arrêts de bus, fontaines, lavoirs, et les grandes
 * structures visibles de loin (monument, château, tour).
 *
 * Ils sont donc à leur vraie place, à ceci près qu'un arrêt de bus est très
 * souvent porté par le tracé de la route elle-même : on le repousse au bord
 * plutôt que de le retirer, et on l'oriente vers la chaussée la plus proche.
 *
 * Église, commerce et hôpital n'en sont plus : c'est
 * `buildingLayer.buildingPersonalityFor` qui donne sa silhouette au bâtiment
 * qui existe réellement à cet endroit, au lieu d'en poser un second dessus.
 */

import { lngToTileX, latToTileY } from '../../core/tileMath.js';
import { pushPointOutsideCorridor, CORRIDOR_MARGIN_M } from '../roadCorridor.js';
import { roadsideYaw, randomAt } from '../furniturePlacement.js';
import { FURNITURE_RADIUS_M } from './catalog.js';

/**
 * Dégagement d'un point d'intérêt au-delà de l'emprise routière, en mètres.
 *
 * Un abribus fait 1,7 m de profondeur, un lavoir 3 m, et c'est leur **centre**
 * que la donnée situe : sorti de l'emprise au ras, l'objet y laisse la moitié
 * de lui-même. Un mètre et demi couvre le plus encombrant.
 */
export const POI_CLEARANCE_M = 1.6;

/**
 * Ce que la couche `poi` sait donner : arrêts de bus, fontaines, lavoirs.
 *
 * Ce sont les seuls objets de mobilier que le schéma OpenMapTiles porte
 * nommément. Ils sont donc à leur vraie place — et il n'y en a pas d'autres à
 * y chercher : ni lampadaire, ni panneau, ni borne ne survivent à la
 * génération des tuiles.
 */
export function buildPointsOfInterest(layer, context, roadSegments) {
  const { source, tiles, here, placements } = context;
  const { origin, scale, zoom } = layer.bubble.frame;

  source.forEachFeature('poi', tiles, (geometry, properties) => {
    if (geometry.type !== 'Point') return;
    const [lng, lat] = geometry.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const x = (lngToTileX(lng, zoom) - origin.x) * scale;
    const z = (latToTileY(lat, zoom) - origin.y) * scale;
    if (Math.hypot(x - here.x, z - here.z) > FURNITURE_RADIUS_M) return;

    const item = poiItem(properties);
    if (!item) return;

    // Écarté de la chaussée. Un arrêt de bus est très souvent porté par le
    // tracé de la route elle-même (`stop_position` sur la voie), et l'abribus
    // se posait alors au milieu du bitume. Le retirer ferait disparaître un
    // objet qui existe vraiment : on le repousse au bord, place qui est la
    // sienne. Le dégagement compte la demi-profondeur de l'abri, sans quoi
    // c'est son origine qui sort de l'emprise et son dos qui y reste.
    const at = pushPointOutsideCorridor(
      x,
      z,
      layer._infraIndex,
      CORRIDOR_MARGIN_M + POI_CLEARANCE_M
    );
    // Orienté vers la chaussée la plus proche : un abribus qui tourne le dos
    // à la route est le genre de détail qui saute aux yeux. Le cap se prend à
    // la place définitive, pas à celle que la donnée annonçait.
    const yaw = facingRoad(layer, at.x, at.z, roadSegments);
    layer._place(placements, item, { x: at.x, z: at.z, yaw });
  });
}

/**
 * Forme du catalogue correspondant à un point d'intérêt, ou `null`.
 *
 * Église, mosquée, hôpital, boulangerie, commerce et centre commercial n'en
 * sont pas : un modèle posé à leurs coordonnées tombe **à côté** du vrai
 * bâtiment, qui finit par le recouvrir. C'est
 * `buildingLayer.buildingPersonalityFor` qui les traite, en donnant sa
 * silhouette au bâtiment réellement présent.
 *
 * Château, monument et tour restent ici : ce sont de grandes structures
 * visibles de loin, pas des bâtiments qu'une empreinte ordinaire recouvre.
 *
 * ## Ce qui est vérifié, et ce qui ne l'est pas
 *
 * Les trois premières lignes sont éprouvées : elles tournaient déjà avant ce
 * chantier. Le reste suit le schéma OpenMapTiles habituel (`poi.yaml`) tel
 * qu'on peut le reconstituer sans accès aux tuiles réellement servies par ce
 * projet — à vérifier, une fois posé sur un vrai monument ou un vrai
 * château, avant de considérer ce dispatch comme acquis.
 */
export function poiItem(properties = {}) {
  const klass = properties.class;
  const subclass = properties.subclass;
  if (klass === 'bus' || subclass === 'bus_stop' || subclass === 'bus_station') return 'busShelter';
  if (subclass === 'drinking_water' || subclass === 'water_point' || subclass === 'fountain') return 'fountain';
  if (subclass === 'wash_house' || subclass === 'watermill') return 'lavoir';
  if (klass === 'monument' || subclass === 'monument' || subclass === 'memorial') return 'monument';
  if (klass === 'castle' || subclass === 'castle') return 'castle';
  if (klass === 'tower' || subclass === 'tower' || subclass === 'observation_tower') return 'tower';
  if (subclass === 'theme_park') return 'ferrisWheel';
  return null;
}

/**
 * Cap tourné vers la chaussée la plus proche, **perpendiculairement**.
 *
 * Deux points, dont le second est celui qui se voit :
 *
 * 1. on vise la chaussée **en travers**, et non le point de la polyligne le
 *    plus proche : un abribus est parallèle à la route qu'il borde, c'est la
 *    perpendiculaire locale qui l'oriente ;
 * 2. le balayage grossier (un échantillon sur quatre, soit vingt mètres) ne
 *    sert **qu'à trouver la bonne chaussée**, jamais à donner le cap : pour un
 *    arrêt posé à cinq mètres de la route, un écart longitudinal de dix mètres
 *    ferait tourner l'abribus de soixante degrés. Le cap vient d'un
 *    affinement local.
 *
 * Sans route à portée, on retombe sur un cap tiré du lieu — stable d'une
 * reconstruction à l'autre, ce qui est la seule chose qui compte alors.
 */
export function facingRoad(layer, x, z, roadSegments) {
  let best = Infinity;
  let bestSegment = null;
  let bestRow = 0;

  for (const segment of roadSegments) {
    const path = segment.path;
    for (let r = 0; r < path.length; r += 4) {
      const d = (path[r].x - x) ** 2 + (path[r].z - z) ** 2;
      if (d < best) {
        best = d;
        bestSegment = segment;
        bestRow = r;
      }
    }
  }

  if (!bestSegment) return randomAt(x, z, 5) * Math.PI * 2;

  const path = bestSegment.path;
  const from = Math.max(0, bestRow - 4);
  const to = Math.min(path.length - 1, bestRow + 4);
  for (let r = from; r <= to; r++) {
    const d = (path[r].x - x) ** 2 + (path[r].z - z) ** 2;
    if (d < best) {
      best = d;
      bestRow = r;
    }
  }

  // Tangente locale, prise par différence centrée comme partout ailleurs.
  const prev = path[Math.max(0, bestRow - 1)];
  const next = path[Math.min(path.length - 1, bestRow + 1)];
  let tx = next.x - prev.x;
  let tz = next.z - prev.z;
  const length = Math.hypot(tx, tz) || 1;
  tx /= length;
  tz /= length;

  // De quel côté de la marche l'objet se trouve : c'est le signe de sa
  // projection sur la perpendiculaire gauche `(tz, -tx)`.
  const at = path[bestRow];
  const offset = (x - at.x) * tz - (z - at.z) * tx;
  return roadsideYaw(tx, tz, offset, 'road');
}

