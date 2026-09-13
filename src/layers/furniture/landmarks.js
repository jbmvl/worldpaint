/*
 * landmarks — les repères : ce qu'un bourg porte (moulin, château d'eau), les
 * pierres d'un sol minéral, et ce qui donne à l'horizon son échelle verticale
 * (éoliennes, pylônes, antennes de sommet, phares, arbres de crête).
 *
 * Deux origines, et elles ne se valent pas. Ce qui est **lu** dans la donnée —
 * un sommet, un trait de côte, un périmètre habité — est à sa vraie place. Ce
 * qui est **semé** sur une grille — éolienne, pylône, pierre, arbre de crête —
 * ne prétend pas l'être : la grille est ancrée au monde et non à l'observateur,
 * de sorte qu'un repère ne bouge pas d'une reconstruction à l'autre, et ne
 * s'efface pas non plus quand on s'en approche.
 */

import { lngToTileX, latToTileY } from '../../core/tileMath.js';
import { resamplePath } from '../ribbonGeometry.js';
import { WATER_SOURCE_LAYER } from '../../terrain/groundClassMap.js';
import { pointInAreas } from '../settlement.js';
import { rockKindFor, ringCentroid, randomAt } from '../furniturePlacement.js';
import { FURNITURE_LIMITS, FURNITURE_RADIUS_M } from './catalog.js';

/**
 * Seuils de taille d'un bourg, en bâtiments comptés autour de son centroïde
 * (`FabricIndex.countWithin`) — voir `buildVillageLandmarks`.
 */
export const VILLAGE_HAMLET_MAX_BUILDINGS = 20;
export const VILLAGE_TOWN_MAX_BUILDINGS = 150;

/** Portée des seuls repères d'horizon — ils n'existent que pour la profondeur. */
export const LANDMARK_RADIUS_M = 2400;
/**
 * Dégagement autour d'une éolienne ou d'un pylône, en mètres : aucun bâtiment
 * à moins de ça.
 *
 * Ces objets n'existent pas dans la donnée — ils sont posés sur une grille, là
 * où le relief est haut. Rien ne dit donc qu'ils tombent sur du vide, et c'est
 * ce que cette distance vérifie. Elle a remplacé une distance **à
 * l'observateur** (420 m), qui protégeait la même chose de la mauvaise
 * manière : en effaçant le repère au moment où on l'atteignait.
 */
export const LANDMARK_CLEARANCE_M = 55;
/** Même chose pour l'arbre de crête, qui tient moins de place. */
export const RIDGE_TREE_CLEARANCE_M = 25;

/** Portée des cailloux et blocs rocheux, en mètres. */
export const ROCK_RADIUS_M = 220;
/** Pas de la grille de semis des pierres, en mètres. */
export const ROCK_CELL_M = 14;

/**
 * Un repère par périmètre habité, choisi selon la taille du bourg :
 *
 * - **hameau isolé** (moins de vingt bâtiments) — moulin à vent ou moulin à
 *   eau : le genre d'ouvrage qu'on ne trouve précisément que là où il n'y a
 *   pas grand-chose d'autre ;
 * - **ville moyenne** (vingt à cent cinquante bâtiments) — un château d'eau,
 *   qui dessert justement ce format de commune. Un hameau de dix maisons
 *   n'en a pas les moyens, une vraie ville en a d'autres, plus imposants et
 *   non modélisés ici.
 *
 * Il se pose **au bord** du périmètre, jamais dedans. Sans `FabricIndex`
 * (`fabric` absent de `rebuild`), personne ne sait combien de bâtiments
 * compte le périmètre, et ce mobilier ne se pose pas — le bon repli, plutôt
 * que d'en semer un partout par défaut.
 */
export function buildVillageLandmarks(layer, context, builtUp) {
  const { here, placements } = context;
  if (!layer._fabric || !builtUp) return;

  for (const ring of builtUp) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const centre = ringCentroid(ring);
    if (Math.hypot(centre.x - here.x, centre.z - here.z) > FURNITURE_RADIUS_M) continue;

    let reach = 0;
    for (const p of ring) reach = Math.max(reach, Math.hypot(p.x - centre.x, p.z - centre.z));
    // Un périmètre minuscule n'est pas un bourg — un fond de jardin
    // `landuse=residential` isolé, par exemple.
    if (reach < 20) continue;

    // Comptés jusqu'à cent cinquante : au-delà, ni le hameau isolé ni la
    // ville moyenne ne décrivent plus ce périmètre, et aucun des deux
    // repères n'y a sa place.
    const count = layer._fabric.countWithin(centre.x, centre.z, reach + 40, VILLAGE_TOWN_MAX_BUILDINGS);
    if (count === 0) continue;

    // Un seul repère par bourg, et pas dans tous les bourgs : sur le
    // tirage propre au lieu, la plupart n'en portent aucun.
    const draw = randomAt(centre.x, centre.z, 151);
    let item = null;
    if (count < VILLAGE_HAMLET_MAX_BUILDINGS) {
      if (draw < 0.1) item = 'windmill';
      else if (draw < 0.16) item = 'watermill';
    } else if (count < VILLAGE_TOWN_MAX_BUILDINGS) {
      if (draw < 0.3) item = 'waterTower';
    }
    if (!item) continue;

    const angle = randomAt(centre.x, centre.z, 153) * Math.PI * 2;
    const x = centre.x + Math.cos(angle) * reach * 1.25;
    const z = centre.z + Math.sin(angle) * reach * 1.25;
    // Le point tiré peut retomber dans le périmètre bâti voisin d'un hameau
    // à l'autre, ou sur la route qui le dessert : dans les deux cas, on
    // laisse tomber plutôt que de le replacer, pour ne pas déplacer le
    // repère d'une reconstruction à l'autre.
    if (pointInAreas(builtUp, x, z)) continue;
    if (layer._onRoad(x, z)) continue;

    layer._place(placements, item, { x, z, yaw: randomAt(x, z, 157) * Math.PI * 2 });
  }
}

/**
 * Cailloux, blocs et affleurements, là où le sol est minéral.
 *
 * ## Pourquoi une grille et pas des parcelles
 *
 * Parce qu'il n'y a pas de parcelle : un éboulis n'est pas un polygone
 * `landcover=rock` bien découpé, c'est une **matière** qui apparaît à partir
 * d'une certaine altitude et d'une certaine pente. La carte de classes la
 * donne au pixel près, et la pente vient du MNT — d'où un semis sur grille
 * fixe, ancrée au monde et non à l'observateur, exactement comme les repères
 * d'horizon.
 *
 * Chaque maille consomme le **même nombre de tirages** quel que soit son
 * résultat : sans ça, une pierre changerait de place dès qu'une voisine
 * apparaît ou disparaît.
 */
export function buildRocks(layer, context, builtUp) {
  const { here, placements } = context;
  const step = ROCK_CELL_M;
  const startX = Math.floor((here.x - ROCK_RADIUS_M) / step) * step;
  const startZ = Math.floor((here.z - ROCK_RADIUS_M) / step) * step;
  let placed = 0;

  for (let z = startZ; z <= here.z + ROCK_RADIUS_M && placed < FURNITURE_LIMITS.rocks; z += step) {
    for (let x = startX; x <= here.x + ROCK_RADIUS_M && placed < FURNITURE_LIMITS.rocks; x += step) {
      const px = x + (randomAt(x, z, 101) - 0.5) * step * 0.9;
      const pz = z + (randomAt(x, z, 103) - 0.5) * step * 0.9;
      if (Math.hypot(px - here.x, pz - here.z) > ROCK_RADIUS_M) continue;
      if (pointInAreas(builtUp, px, pz)) continue;
      // Un bloc erratique au milieu de la chaussée est le plus visible de
      // tous les défauts d'emprise : il est opaque et il est haut.
      if (layer._onRoad(px, pz)) continue;

      const sample = layer.groundClass?.sampleAt?.(px, pz);
      // Sans carte de classes, on ne devine pas un éboulis : la pente seule
      // mettrait des rochers sur toutes les prairies de montagne.
      if (!sample) continue;
      const kind = rockKindFor({
        bare: sample.bare,
        steepness: layer._steepnessAt(px, pz),
        variant: randomAt(px, pz, 107),
      });
      if (!kind) continue;

      layer._place(placements, kind.item, {
        x: px,
        z: pz,
        yaw: randomAt(px, pz, 109) * Math.PI * 2,
        scale: kind.scale,
      });
      placed++;
    }
  }
  layer.counts.rocks = placed;
}

// --- Repères d'horizon ---------------------------------------------------

/**
 * Éoliennes et pylônes, au loin.
 *
 * Ils ne sont pas dans les tuiles — `power=tower` et `generator:source=wind`
 * n'y survivent pas —, et ils ne prétendent donc pas être à leur vraie place.
 * Ils ont une autre fonction : donner à l'horizon une échelle verticale. Sans
 * eux, un brouillard sur un relief nu ne dit pas si la crête est à un
 * kilomètre ou à dix.
 *
 * Trois garde-fous rendent leur présence acceptable : ils ne se posent que
 * sur des points hauts (une éolienne ne s'installe pas au fond d'un vallon),
 * jamais dans une zone bâtie, et leur tirage dépend uniquement de la position
 * au sol — donc ils ne bougent pas d'une reconstruction à l'autre.
 */
export function buildLandmarks(layer, context, builtUp) {
  const { here, placements } = context;
  const radius = Math.min(LANDMARK_RADIUS_M, layer.bubble.radiusMeters || LANDMARK_RADIUS_M);
  const step = 320;
  let placed = 0;
  // Reconstituée à chaque reconstruction ; `setWindDirection` la relit donc
  // pour orienter les éoliennes fraîchement posées, pas celles d'avant.
  layer._turbines = [];

  // Grille ancrée sur le monde, pas sur l'observateur : les mailles visitées
  // changent, les tirages de chaque maille non.
  const startX = Math.floor((here.x - radius) / step) * step;
  const startZ = Math.floor((here.z - radius) / step) * step;

  for (let z = startZ; z <= here.z + radius && placed < FURNITURE_LIMITS.landmarks; z += step) {
    for (let x = startX; x <= here.x + radius && placed < FURNITURE_LIMITS.landmarks; x += step) {
      const draw = randomAt(x, z, 91);
      if (draw > 0.14) continue;

      // Décalage dans la maille : une grille régulière se lit comme une grille.
      const px = x + (randomAt(x, z, 92) - 0.5) * step * 0.8;
      const pz = z + (randomAt(x, z, 93) - 0.5) * step * 0.8;
      if (Math.hypot(px - here.x, pz - here.z) > radius) continue;
      if (pointInAreas(builtUp, px, pz)) continue;
      // Ni sur une chaussée, ni au fond d'un jardin. Jamais une distance
      // minimale à l'observateur : un repère qu'on voit à deux kilomètres et
      // qui s'efface quand on arrive dessus n'en est plus un.
      if (layer._onRoad(px, pz)) continue;
      if (layer._fabric?.countWithin(px, pz, LANDMARK_CLEARANCE_M, 1) > 0) continue;
      if (!isHighPoint(layer, px, pz)) continue;

      const item = draw < 0.08 ? 'windTurbine' : 'pylon';
      // Une éolienne s'oriente face au vent, pas au hasard de sa position ;
      // un pylône, lui, n'a pas de face — le tirage précédent lui reste.
      const yaw = item === 'windTurbine' ? layer._turbineYaw() : randomAt(px, pz, 94) * Math.PI * 2;
      const entry = layer._place(placements, item, { x: px, z: pz, yaw });
      if (item === 'windTurbine' && entry) layer._turbines.push(entry);
      placed++;
    }
  }
  layer.counts.landmarks = placed;
}

/**
 * Arbre isolé de ligne de crête : un repère de hauteur, à défaut d'une
 * vraie détection de crête.
 *
 * Rien dans le MNT ni dans les tuiles ne dit « ceci est une ligne de
 * crête ». La détection retenue est une approximation assumée : un point
 * haut par rapport à ses abords immédiats (`isHighPoint`, déjà utilisé
 * pour poser éoliennes et pylônes) et dégagé (`_openGround`). Un vrai calcul
 * suivrait la ligne de partage des eaux dans le MNT, ce qui reste à faire ;
 * ceci pose un arbre là où le relief est visiblement haut, pas
 * nécessairement sur l'arête exacte.
 */
export function buildRidgeTrees(layer, context, builtUp) {
  const { here, placements } = context;
  const radius = Math.min(LANDMARK_RADIUS_M, layer.bubble.radiusMeters || LANDMARK_RADIUS_M);
  const step = 140;
  let placed = 0;

  const startX = Math.floor((here.x - radius) / step) * step;
  const startZ = Math.floor((here.z - radius) / step) * step;

  for (let z = startZ; z <= here.z + radius && placed < FURNITURE_LIMITS.ridgeTrees; z += step) {
    for (let x = startX; x <= here.x + radius && placed < FURNITURE_LIMITS.ridgeTrees; x += step) {
      // Rare : un arbre de crête toutes les vingt à trente mailles environ,
      // jamais un par maille — sans quoi la grille se verrait.
      if (randomAt(x, z, 181) > 0.035) continue;

      const px = x + (randomAt(x, z, 182) - 0.5) * step * 0.8;
      const pz = z + (randomAt(x, z, 183) - 0.5) * step * 0.8;
      if (Math.hypot(px - here.x, pz - here.z) > radius) continue;
      if (pointInAreas(builtUp, px, pz)) continue;
      // Même chose que pour les éoliennes : l'emprise routière et le bâti
      // disent déjà où l'arbre ne va pas, sans distance à l'observateur.
      if (layer._onRoad(px, pz)) continue;
      if (layer._fabric?.countWithin(px, pz, RIDGE_TREE_CLEARANCE_M, 1) > 0) continue;
      if (!layer._openGround(px, pz)) continue;
      if (!isHighPoint(layer, px, pz)) continue;

      const conifer = randomAt(px, pz, 184) < 0.35;
      layer._place(placements, conifer ? 'treeConifer' : 'treeBroad', {
        x: px,
        z: pz,
        yaw: randomAt(px, pz, 185) * Math.PI * 2,
        scale: 0.9 + randomAt(px, pz, 186) * 0.5,
      });
      placed++;
    }
  }
}

/** Vrai si le point domine ses alentours immédiats — une crête, pas un fond. */
export function isHighPoint(layer, x, z) {
  const here = layer.bubble.surfaceElevationAtLocal(x, z, 0);
  if (!Number.isFinite(here)) return false;
  let higher = 0;
  for (const [dx, dz] of [[-140, 0], [140, 0], [0, -140], [0, 140]]) {
    if (layer.bubble.surfaceElevationAtLocal(x + dx, z + dz, 0) > here + 4) higher++;
  }
  return higher === 0;
}

/**
 * Antennes de sommet : posées sur les vrais sommets relevés dans les tuiles
 * (`mountain_peak`), et non devinés sur une grille comme les éoliennes et
 * les pylônes de `buildLandmarks` — ceux-ci n'ont aucune existence dans la
 * donnée, un sommet en a une : on le lit, on ne l'invente pas.
 */
export function buildPeakLandmarks(layer, context, builtUp) {
  const { source, tiles, here, placements } = context;
  const { origin, scale, zoom } = layer.bubble.frame;
  let placed = 0;

  source.forEachFeature('mountain_peak', tiles, (geometry, properties) => {
    if (placed >= FURNITURE_LIMITS.peakLandmarks) return;
    if (geometry.type !== 'Point') return;
    const [lng, lat] = geometry.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const x = (lngToTileX(lng, zoom) - origin.x) * scale;
    const z = (latToTileY(lat, zoom) - origin.y) * scale;
    if (Math.hypot(x - here.x, z - here.z) > LANDMARK_RADIUS_M) return;
    if (pointInAreas(builtUp, x, z)) return;

    // Un sommet sur trois environ, tiré sur sa position : les équiper tous
    // ferait une forêt de mâts, ce qu'aucune ligne de crête ne porte.
    if (randomAt(x, z, 131) > 0.35) return;

    layer._place(placements, 'radioMast', { x, z, yaw: randomAt(x, z, 133) * Math.PI * 2 });
    placed++;
  });
}

/**
 * Phares : posés sur le trait de côte réel, jamais devinés — seule une
 * nappe `water` de classe `ocean` en fait un, une rivière ou un lac n'en
 * portent pas.
 *
 * Le contour d'une nappe `ocean` n'a pas d'orientation garantie (elle peut
 * sortir de plusieurs tuiles recousues dans n'importe quel sens), donc le
 * côté « terre » n'est pas supposé à partir de l'enroulement : il est
 * **mesuré**, en comparant l'altitude de part et d'autre du tracé et en
 * gardant le côté le plus haut.
 */
export function buildCoastalLandmarks(layer, context, builtUp) {
  const { source, tiles, here, placements, sampleElevation } = context;
  const { origin, scale, zoom } = layer.bubble.frame;
  const toLocal = (ring) =>
    ring.map(([lng, lat]) => ({
      x: (lngToTileX(lng, zoom) - origin.x) * scale,
      z: (latToTileY(lat, zoom) - origin.y) * scale,
    }));
  let placed = 0;

  source.forEachFeature(WATER_SOURCE_LAYER, tiles, (geometry, properties) => {
    if (placed >= FURNITURE_LIMITS.coastLandmarks) return;
    if (properties.class !== 'ocean') return;

    const rings =
      geometry.type === 'Polygon'
        ? [geometry.coordinates[0]]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates.map((r) => r[0]).filter(Boolean)
          : [];

    for (const ring of rings) {
      if (placed >= FURNITURE_LIMITS.coastLandmarks) break;
      if (!Array.isArray(ring) || ring.length < 3) continue;

      const path = resamplePath(toLocal(ring), 60);
      if (path.length < 3) continue;

      for (let i = 1; i < path.length - 1 && placed < FURNITURE_LIMITS.coastLandmarks; i++) {
        const p = path[i];
        if (Math.hypot(p.x - here.x, p.z - here.z) > LANDMARK_RADIUS_M) continue;

        // Un point de trait de côte sur quarante environ : un phare tous
        // les deux kilomètres et demi, pas un tous les soixante mètres.
        if (randomAt(p.x, p.z, 141) > 0.025) continue;

        const prev = path[i - 1];
        const next = path[i + 1];
        let tx = next.x - prev.x;
        let tz = next.z - prev.z;
        const len = Math.hypot(tx, tz) || 1;
        tx /= len;
        tz /= len;
        const nx = tz;
        const nz = -tx;
        const reach = 9;
        const a = sampleElevation(p.x + nx * reach, p.z + nz * reach);
        const b = sampleElevation(p.x - nx * reach, p.z - nz * reach);
        const land =
          (Number.isFinite(a) ? a : -Infinity) > (Number.isFinite(b) ? b : -Infinity)
            ? { x: p.x + nx * reach, z: p.z + nz * reach, h: a }
            : { x: p.x - nx * reach, z: p.z - nz * reach, h: b };
        // Le seuil écarte un candidat encore sous l'eau — bruit de tuile ou
        // presqu'île trop étroite pour porter quoi que ce soit.
        if (!Number.isFinite(land.h) || land.h < 0.6) continue;
        if (pointInAreas(builtUp, land.x, land.z)) continue;

        layer._place(placements, 'lighthouse', { x: land.x, z: land.z, yaw: randomAt(p.x, p.z, 143) * Math.PI * 2 });
        placed++;
      }
    }
  });
}

