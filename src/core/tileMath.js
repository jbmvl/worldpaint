/*
 * tileMath — géométrie Web Mercator pour la bulle 3D de l'observateur.
 * Fonctions pures, testables sous Node (`npm test`).
 *
 * La scène vit dans un repère métrique local centré sur l'observateur :
 *   x → est, y → altitude, z → sud (convention three.js, -z = nord)
 * Mercator étant conforme, il suffit de multiplier les coordonnées de tuile
 * fractionnaires par le facteur d'échelle de la latitude d'origine pour
 * obtenir des mètres justes (erreur < 0,1 % sur quelques km), et deux tuiles
 * voisines partagent exactement la même frontière.
 */

export const EARTH_RADIUS = 6378137;
export const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS; // 40 075 016,686 m

/** Latitude maximale représentable en Web Mercator (±85,051129°). */
export const MERCATOR_MAX_LAT = 85.0511287798;

const DEG = Math.PI / 180;

const clampLat = (lat) => Math.min(MERCATOR_MAX_LAT, Math.max(-MERCATOR_MAX_LAT, lat));

/** Longitude → abscisse de tuile fractionnaire au zoom `z`. */
export function lngToTileX(lng, z) {
  return ((lng + 180) / 360) * Math.pow(2, z);
}

/** Latitude → ordonnée de tuile fractionnaire au zoom `z`. */
export function latToTileY(lat, z) {
  const rad = clampLat(lat) * DEG;
  const merc = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  return ((1 - merc / Math.PI) / 2) * Math.pow(2, z);
}

/** Abscisse de tuile fractionnaire → longitude. */
export function tileXToLng(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}

/** Ordonnée de tuile fractionnaire → latitude. */
export function tileYToLat(y, z) {
  const n = Math.PI * (1 - (2 * y) / Math.pow(2, z));
  return Math.atan(Math.sinh(n)) / DEG;
}

/** Coordonnées de tuile fractionnaires `{x, y}` d'un point géographique. */
export function lngLatToTile(lng, lat, z) {
  return { x: lngToTileX(lng, z), y: latToTileY(lat, z) };
}

/**
 * Taille au sol d'une tuile entière, en mètres, à la latitude donnée.
 * C'est le facteur d'échelle du repère local : 1 unité de tuile = S mètres.
 */
export function tileSizeMeters(z, lat) {
  return (EARTH_CIRCUMFERENCE * Math.cos(clampLat(lat) * DEG)) / Math.pow(2, z);
}

/**
 * Crée un repère local métrique ancré sur (originLng, originLat) au zoom `z`.
 * Retourne un objet figé exposant les conversions dans les deux sens.
 */
export function createLocalFrame(originLng, originLat, z) {
  const origin = lngLatToTile(originLng, originLat, z);
  const scale = tileSizeMeters(z, originLat);

  /** Point géographique → mètres locaux `{x: est, z: sud}`. */
  const toLocal = (lng, lat) => {
    const t = lngLatToTile(lng, lat, z);
    return { x: (t.x - origin.x) * scale, z: (t.y - origin.y) * scale };
  };

  /** Coordonnées de tuile fractionnaires → mètres locaux. */
  const tileToLocal = (tx, ty) => ({
    x: (tx - origin.x) * scale,
    z: (ty - origin.y) * scale,
  });

  /** Mètres locaux → point géographique `{lng, lat}`. */
  const toLngLat = (x, zMeters) => ({
    lng: tileXToLng(origin.x + x / scale, z),
    lat: tileYToLat(origin.y + zMeters / scale, z),
  });

  return Object.freeze({
    zoom: z,
    origin,
    originLng,
    originLat,
    scale,
    toLocal,
    tileToLocal,
    toLngLat,
  });
}

/**
 * Décode un pixel Terrarium (Mapzen / AWS elevation-tiles-prod) en mètres.
 * Format : altitude = (R * 256 + G + B / 256) - 32768.
 */
export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Décode un pixel Terrain-RGB (Mapbox / MapTiler) en mètres.
 * Format : altitude = -10000 + (R * 256² + G * 256 + B) * 0,1.
 */
export function decodeTerrainRgb(r, g, b) {
  return -10000 + (r * 65536 + g * 256 + b) * 0.1;
}

/**
 * Liste les tuiles d'un bloc carré de `size` tuiles de côté centré sur
 * (centerX, centerY). `size` impair place le centre pile au milieu.
 * Les tuiles sont retournées triées par distance croissante au centre, pour
 * que le chargement serve d'abord ce que l'observateur a sous les roues.
 */
export function tilesAround(centerX, centerY, size, z) {
  const half = Math.floor(size / 2);
  const cx = Math.floor(centerX);
  const cy = Math.floor(centerY);
  const max = Math.pow(2, z);
  const out = [];

  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      // Hors des pôles : on ne boucle pas en y (pas de tuile au-delà).
      if (y < 0 || y >= max) continue;
      // En x, le monde est cyclique.
      const wrappedX = ((x % max) + max) % max;
      out.push({ x: wrappedX, y, z, ring: Math.max(Math.abs(dx), Math.abs(dy)) });
    }
  }

  out.sort((a, b) => a.ring - b.ring);
  return out;
}

/** Clé de cache canonique d'une tuile. */
export function tileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

/**
 * Substitue `{z}` `{x}` `{y}` dans un gabarit d'URL de tuile.
 * Gère aussi `{-y}` (schéma TMS) et `{s}` (sous-domaines, si `subdomains`).
 */
export function fillTileUrl(template, z, x, y, subdomains = null) {
  let url = template
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y))
    .replace(/\{-y\}/g, String(Math.pow(2, z) - 1 - y));

  if (subdomains && subdomains.length) {
    const pick = subdomains[Math.abs(x + y) % subdomains.length];
    url = url.replace(/\{s\}/g, pick);
  }
  return url;
}

/**
 * Cap (0 = nord, sens horaire, degrés) → angle de rotation three.js autour de
 * l'axe Y, en radians. Dans notre repère l'objet « au repos » regarde -z
 * (le nord) ; tourner vers l'est = rotation négative autour de Y.
 */
export function bearingToYaw(bearingDeg) {
  return -bearingDeg * DEG;
}

/**
 * Interpole deux caps en prenant le plus court chemin angulaire.
 * `factor` ∈ [0,1] : 0 garde `current`, 1 saute sur `target`.
 */
export function lerpBearing(current, target, factor) {
  let diff = target - current;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return current + diff * factor;
}
