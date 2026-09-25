/*
 * cliffLayer — les falaises relevées : `natural=cliff` d'OpenStreetMap, servi
 * par OpenMapTiles dans la couche `mountain_peak` (classe `cliff`, une
 * polyligne) à partir du zoom 13.
 *
 * Elle publie deux choses et en dessine une troisième :
 *
 * 1. **la marche** (`CliffIndex`), que `terrainBubble` interroge pour
 *    comprimer en paroi la rampe sur laquelle le MNT étale une falaise — une
 *    falaise de mer de quatre-vingts mètres s'y lit sur une centaine de mètres
 *    de pente douce (`terrain/cliffCut`) ;
 * 2. **la bande de roche** (`bands`), que `groundClassMap` peint en `rock` :
 *    l'arase et le pied sont minéraux eux aussi ;
 * 3. **la nappe de paroi**, une grille de quadrilatères plaquée sur la marche.
 *
 * ## Pourquoi la paroi a besoin de ses propres polygones
 *
 * Le terrain est un champ de hauteurs : une face verticale y tient dans **un
 * seul quadrilatère**, quelle que soit la finesse de la maille, et ne porte
 * aucune rangée de sommets entre son pied et son arase. À Saumur, la paroi
 * mesure 0,69 quad de large pour quarante mètres de haut. Le grain du sol
 * (`terrain/lowPolyGrain`) déplace des sommets : sans sommet, il ne rend
 * qu'une valeur par colonne, donc des cannelures verticales.
 *
 * La nappe n'existe que pour ça — porter les sommets que le champ de hauteurs
 * ne peut pas avoir. Elle est **subdivisée dans les deux sens** et rendue avec
 * le matériau du terrain : c'est donc le grain du sol, et lui seul, qui la
 * creuse et l'ombre à plat. Rien n'est déplacé ici.
 *
 * Ce n'est pas le retour de l'ancienne paroi balayée : celle-là portait un
 * profil fermé à six colonnes, son propre grain et son propre matériau. Ici,
 * une grille et rien d'autre.
 *
 * Une chaussée au sol qui franchit le trait l'interrompt (`cliffGaps`) : une
 * route qui monte d'un pied de falaise à son arase passe par une brèche, sur la
 * pente que le MNT donne à cet endroit, et non contre une paroi verticale. La
 * marche s'estompe au bout d'un trait (`CLIFF_FADE_M`) au lieu de se prolonger
 * au-delà.
 *
 * Le haut et le bas ne sont pas déduits du sens de tracé. La convention OSM
 * met le haut à gauche, mais elle est diversement respectée et le découpage en
 * tuiles ne garantit pas le sens : le MNT tranche, en lisant l'altitude des
 * deux côtés. Il est de toute façon lu là pour les cotes.
 */

import { resamplePath, pathFrames, smoothColumns } from './ribbonGeometry.js';
import { cliffProfileAt } from '../terrain/cliffCut.js';
import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { cellKey } from './roadGraph.js';
import { collectRoadLines } from './roadNetwork.js';
import { WORK_NONE, LEVEL_GROUND } from './roadWorks.js';
import { ROAD_CUT_M, ROAD_CUT_BLEND_M } from '../terrain/roadCut.js';
import {
  cliffElevationAt,
  cliffFaceWidth,
  CLIFF_PROBE_M,
  CLIFF_MIN_HEIGHT_M,
} from '../terrain/cliffCut.js';

/** Couche source : les falaises y voisinent les crêtes et les arêtes. */
export const CLIFF_SOURCE_LAYER = 'mountain_peak';

/**
 * Pas du tracé, en mètres. C'est lui qui fixe l'espacement des arêtes du
 * grain (`facetJitter`) : resserré, la paroi se hérisse ; relâché, elle
 * redevient un plan.
 */
const CLIFF_SAMPLE_M = 7;

/** Au-delà, une falaise ne se lit plus : inutile de la tailler. */
const CLIFF_RADIUS_M = 1400;

/** Déplacement de l'observateur qui justifie une reconstruction. */
const CLIFF_REBUILD_M = 160;

/**
 * Longueur sur laquelle la marche s'estompe au-delà du bout d'un trait, en
 * mètres. Sans elle, la marche se prolongeait autour du bout jusqu'à la portée
 * de son raccord : une brèche ouverte pour une route n'en aurait rien dégagé.
 */
export const CLIFF_FADE_M = 12;

/**
 * Portions d'un trait de falaise qu'une chaussée au sol franchit, en abscisses
 * curvilignes. Chaque brèche couvre la chaussée, son emprise et son raccord,
 * plus l'estompe de la marche : c'est là que la route doit trouver le MNT nu.
 * Un pont ou un tunnel ne l'ouvrent pas — la falaise reste sous l'un, au-dessus
 * de l'autre.
 *
 * Fonction pure.
 *
 * @param {Array<{x:number,z:number,distance:number}>} path Trait ré-échantillonné.
 * @param {Array<{points:Array, halfWidth:number, works?:number, level?:number}>} lines
 * @returns {Array<[number, number]>} intervalles `[début, fin]`.
 */
export function cliffGaps(path, lines) {
  const gaps = [];
  for (const line of lines || []) {
    if ((line.works ?? WORK_NONE) !== WORK_NONE || (line.level ?? LEVEL_GROUND) !== LEVEL_GROUND) continue;
    const half = line.halfWidth + ROAD_CUT_M + ROAD_CUT_BLEND_M + CLIFF_FADE_M;
    const points = line.points;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      for (let j = 0; j < points.length - 1; j++) {
        const t = crossingAt(a, b, points[j], points[j + 1]);
        if (t == null) continue;
        const at = a.distance + (b.distance - a.distance) * t;
        gaps.push([at - half, at + half]);
      }
    }
  }
  return gaps;
}

/** Paramètre sur `ab` du point où `ab` coupe `cd`, ou `null`. */
function crossingAt(a, b, c, d) {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const qx = c.x - a.x;
  const qz = c.z - a.z;
  const t = (qx * sz - qz * sx) / denom;
  const u = (qx * rz - qz * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** Un trait privé de ses brèches : les morceaux d'au moins deux points. */
export function splitAtGaps(path, gaps) {
  if (!gaps.length) return [path];
  const pieces = [];
  let current = [];
  for (const point of path) {
    if (gaps.some(([from, to]) => point.distance >= from && point.distance <= to)) {
      if (current.length >= 2) pieces.push(current);
      current = [];
    } else current.push(point);
  }
  if (current.length >= 2) pieces.push(current);
  return pieces;
}

/** Lissage du MNT avant usage : une cote ne doit pas porter son bruit métrique. */
const CLIFF_SMOOTH_RADIUS = 2;

/**
 * Débord de la bande de roche de part et d'autre de la paroi, en mètres. Le
 * pied et l'arase sont de la roche eux aussi : une bande calée pile sur la
 * paroi laisserait l'herbe courir jusqu'au bord de la rupture.
 */
const CLIFF_ROCK_MARGIN_M = 2.5;

/**
 * Côté d'une maille de la nappe de paroi, en mètres. Il faut au moins deux
 * mailles par cellule de grain pour que le bruit se lise comme des aspérités
 * et non comme un plan qui ondule ; la roche a une cellule de six mètres.
 */
const CLIFF_FACE_CELL_M = 3;

/**
 * Plafond de sommets de la nappe. Un coteau de plusieurs kilomètres en
 * demanderait des centaines de milliers ; passé ce seuil, on cesse d'en
 * ajouter plutôt que de faire ramer la vue.
 */
const CLIFF_FACE_MAX_VERTICES = 60000;

/**
 * Côté d'une cellule de l'index, en mètres. Plus large que celui des
 * chaussées (12 m) : une falaise porte jusqu'à `face + blend` de son trait,
 * soit quelques dizaines de mètres, et une cellule trop fine ferait figurer le
 * même segment dans des centaines de seaux.
 */
const CLIFF_CELL_M = 32;

/**
 * Index des falaises taillées : répond « à quelle distance du trait, et entre
 * quelles cotes » en un point du sol.
 *
 * Grille uniforme, comme `RoadIndex`. Le maillage du terrain interroge cet
 * index cinq fois par sommet — l'altitude, puis quatre lectures pour le
 * gradient —, soit près de deux cent mille fois par tuile d'anneau 0. Un
 * parcours exhaustif y coûtait des secondes par tuile dès qu'un coteau
 * s'étirait sur quelques kilomètres, et la vue se figeait.
 */
export class CliffIndex {
  /** @param {Array} segments Voir `CliffLayer._buildCliff`. */
  constructor(segments) {
    this.segments = segments;
    this.reach = 0;
    for (const s of segments) this.reach = Math.max(this.reach, s.face + s.blend);

    this.minX = Infinity;
    this.minZ = Infinity;
    this.maxX = -Infinity;
    this.maxZ = -Infinity;
    /** @type {Map<number, number[]>} indices de segments par cellule. */
    this.buckets = new Map();

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const reach = s.face + s.blend;
      const bx = s.ax + s.tx * s.length;
      const bz = s.az + s.tz * s.length;
      const loX = Math.min(s.ax, bx) - reach;
      const hiX = Math.max(s.ax, bx) + reach;
      const loZ = Math.min(s.az, bz) - reach;
      const hiZ = Math.max(s.az, bz) + reach;

      this.minX = Math.min(this.minX, loX);
      this.maxX = Math.max(this.maxX, hiX);
      this.minZ = Math.min(this.minZ, loZ);
      this.maxZ = Math.max(this.maxZ, hiZ);

      for (let cx = Math.floor(loX / CLIFF_CELL_M); cx <= Math.floor(hiX / CLIFF_CELL_M); cx++) {
        for (let cz = Math.floor(loZ / CLIFF_CELL_M); cz <= Math.floor(hiZ / CLIFF_CELL_M); cz++) {
          const key = cellKey(cx, cz);
          const bucket = this.buckets.get(key);
          if (bucket) bucket.push(i);
          else this.buckets.set(key, [i]);
        }
      }
    }
  }

  get size() {
    return this.segments.length;
  }

  /**
   * Vrai si une falaise peut toucher ce rectangle. Sert au maillage à écarter
   * d'un coup une tuile entière, plutôt que cellule par cellule.
   */
  touches(minX, minZ, maxX, maxZ) {
    return minX <= this.maxX && maxX >= this.minX && minZ <= this.maxZ && maxZ >= this.minZ;
  }

  /**
   * Le segment le plus proche du point, et la position du point par rapport à
   * lui. `null` si aucun n'est à portée.
   *
   * @returns {{foot:number, crest:number, face:number, blend:number, across:number}|null}
   *          `across` est compté positif vers le haut de la falaise.
   */
  query(x, z) {
    const k = this._scan(x, z);
    if (k < 0) return null;
    const s = this.segments[k];
    return {
      foot: s.footA + (s.footB - s.footA) * this._t,
      crest: s.crestA + (s.crestB - s.crestA) * this._t,
      face: s.face,
      blend: s.blend,
      across: this._across,
    };
  }

  /**
   * Le segment retenu, ou `-1`. Laisse l'abscisse et la distance en travers
   * dans `_t` et `_across`.
   *
   * Rien n'est alloué ici et les distances restent au carré : le maillage
   * appelle cette boucle près de deux cent mille fois par tuile, une racine et
   * un objet par candidat s'y voient.
   */
  _scan(x, z) {
    const bucket = this.buckets.get(
      cellKey(Math.floor(x / CLIFF_CELL_M), Math.floor(z / CLIFF_CELL_M))
    );
    if (!bucket) return -1;

    let found = -1;
    let bestSquared = Infinity;

    for (let k = 0; k < bucket.length; k++) {
      const i = bucket[k];
      const s = this.segments[i];
      const dx = x - s.ax;
      const dz = z - s.az;
      const along = dx * s.tx + dz * s.tz;
      const across = dx * s.nx + dz * s.nz;
      // Distance au segment : en travers dans sa longueur, au bout au-delà.
      const overshoot = along < 0 ? -along : along > s.length ? along - s.length : 0;
      const squared = across * across + overshoot * overshoot;
      if (squared >= bestSquared) continue;

      const reach = s.face + s.blend;
      if (squared > reach * reach) continue;

      bestSquared = squared;
      found = i;
      this._across = across;
      this._overshoot = overshoot;
      // Au-delà d'un bout **libre** du trait, et là seulement : entre deux
      // segments d'un même trait, le coude extérieur déborde aussi.
      this._open = (along < 0 && s.openStart) || (along > s.length && s.openEnd) ? overshoot : 0;
      // Abscisse curviligne, bornée aux extrémités.
      this._t = s.length > 0 ? (along < 0 ? 0 : along > s.length ? 1 : along / s.length) : 0;
    }

    return found;
  }

  /**
   * Vrai si le point tombe sur la paroi d'une falaise, ou à `margin` mètres
   * de son pied ou de son arase : là, le relief est celui de la falaise.
   */
  faceNear(x, z, margin = 1) {
    const k = this._scan(x, z);
    if (k < 0) return false;
    const s = this.segments[k];
    return this._overshoot <= margin && this._across >= -margin && this._across <= s.face + margin;
  }

  /** Altitude du terrain au point, falaise comprise. */
  elevationAt(x, z, raw) {
    const k = this._scan(x, z);
    if (k < 0) return raw;
    const s = this.segments[k];
    const t = this._t;
    const open = this._open;
    if (open >= CLIFF_FADE_M) return raw;
    const stepped = cliffElevationAt(
      raw,
      s.footA + (s.footB - s.footA) * t,
      s.crestA + (s.crestB - s.crestA) * t,
      this._across,
      s.face,
      s.blend
    );
    if (!(open > 0)) return stepped;
    const w = 1 - cliffProfileAt(open / CLIFF_FADE_M);
    return raw + (stepped - raw) * w;
  }
}

export class CliffLayer {
  /**
   * @param {Object} options
   * @param {Object} options.bubble La bulle de terrain : elle fournit le MNT
   *        brut et reçoit la marche (`setCliffCut`).
   * @param {Object} options.theme  Fournit l'aplomb de la paroi
   *        (`terrain.cliff`) : une valeur de forme, donc du thème.
   */
  constructor({ THREE, scene, bubble, theme }) {
    this.THREE = THREE;
    this.bubble = bubble;
    this.spec = theme.terrain.cliff;
    /** Profils de chaussée : leur largeur fait celle d'une brèche. */
    this.roads = theme.roads;

    this.group = new THREE.Group();
    this.group.name = 'cliffs';
    scene.add(this.group);
    this.scene = scene;
    this.mesh = null;

    /** Marche publiée au terrain (`CliffIndex`), ou `null`. */
    this.index = null;
    /**
     * Bandes à peindre en roche : un axe en mètres locaux et sa largeur.
     * Lues par `groundClassMap`, qui ne sait rien de la géométrie d'une
     * falaise et n'a qu'un trait à tracer.
     * @type {Array<{path: Array<{x:number,z:number}>, width: number}>}
     */
    this.bands = [];
    this.count = 0;
    this.disposed = false;
    this._anchor = null;
    this._frame = null;
  }

  /** Vrai si l'observateur s'est assez éloigné pour justifier une reconstruction. */
  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= CLIFF_REBUILD_M;
  }

  /**
   * Relit les falaises depuis les tuiles déjà décodées et republie la marche.
   * @returns {boolean} vrai si au moins un trait a été taillé.
   */
  rebuild(source, tiles, here) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    const segments = [];
    const bands = [];
    const face = { positions: [], normals: [], indices: [] };

    // Compté à chaque étape : une falaise absente à l'écran peut l'être parce
    // que la couche source est vide, parce qu'aucun trait n'est classé
    // `cliff`, ou parce que le MNT ne voit pas de dénivelée là où OSM en
    // annonce une. Les trois se corrigent ailleurs, d'où le décompte.
    const seen = { features: 0, cliffs: 0, paths: 0, tooFlat: 0 };
    const traced = this._collectPaths(source, tiles, here, seen);
    const lines = traced.length ? collectRoadLines(source, tiles, this.bubble.frame, this.roads) : [];
    const paths = traced.flatMap((path) => splitAtGaps(path, cliffGaps(path, lines)));
    const signature = JSON.stringify([paths, this.bubble.verticalScale, this.bubble.elevation?.revision]);
    if (this._frame === this.bubble.frame && this._signature === signature && this.bubble.elevation?.revision != null) {
      this._anchor = { x: here.x, z: here.z };
      return false;
    }
    this._signature = signature;
    for (const line of paths) {
      this._buildCliff(line, segments, bands, face, seen);
    }
    this.seen = seen;
    if (segments.length === 0 && seen.features > 0) {
      console.warn('[cliffLayer] aucune falaise taillée', JSON.stringify(seen));
    }

    this.count = segments.length;
    this.bands = bands;
    this.index = segments.length ? new CliffIndex(segments) : null;
    this.bubble.setCliffCut(this.index);
    this._applyFace(face);

    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
    return segments.length > 0;
  }

  /** Les tracés de falaise à portée, en mètres locaux et rééchantillonnés. */
  _collectPaths(source, tiles, here, seen) {
    const { origin, scale, zoom } = this.bubble.frame;
    const paths = [];

    source.forEachFeature(CLIFF_SOURCE_LAYER, tiles, (geometry, properties) => {
      seen.features++;
      // `mountain_peak` porte aussi les sommets (points) et les crêtes : seule
      // la falaise casse le terrain.
      if (properties.class !== 'cliff') return;
      seen.cliffs++;

      const lines =
        geometry.type === 'LineString'
          ? [geometry.coordinates]
          : geometry.type === 'MultiLineString'
            ? geometry.coordinates
            : [];

      for (const line of lines) {
        if (!Array.isArray(line) || line.length < 2) continue;
        const local = [];
        for (const [lng, lat] of line) {
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
          local.push({
            x: (lngToTileX(lng, zoom) - origin.x) * scale,
            z: (latToTileY(lat, zoom) - origin.y) * scale,
          });
        }
        if (local.length < 2) continue;
        if (!local.some((p) => Math.hypot(p.x - here.x, p.z - here.z) <= CLIFF_RADIUS_M)) continue;

        const path = resamplePath(local, CLIFF_SAMPLE_M);
        if (path.length >= 2) {
          paths.push(path);
          seen.paths++;
        }
      }
    });

    return paths;
  }

  /** Cotes lues dans le MNT, segments de marche et bande de roche. */
  _buildCliff(path, segments, bands, face, seen) {
    const rows = path.length;
    const frames = pathFrames(path);
    const raw = (x, z) => this.bubble.rawSurfaceElevationAtLocal(x, z, 0);

    const sideAt = (r, distance) => {
      const px = frames[r * 4 + 2];
      const pz = frames[r * 4 + 3];
      return [
        raw(path[r].x + px * distance, path[r].z + pz * distance),
        raw(path[r].x - px * distance, path[r].z - pz * distance),
      ];
    };

    // Largeur de la rampe sur laquelle le MNT a étalé la falaise : on sonde de
    // plus en plus loin et on retient la plus courte distance qui capte
    // l'essentiel de la chute. Au-delà, on n'aplatirait que du versant.
    let bestDrop = 0;
    const drops = CLIFF_PROBE_M.map((d) => {
      let total = 0;
      for (let r = 0; r < rows; r++) {
        const [l, rt] = sideAt(r, d);
        total += Math.abs(l - rt);
      }
      const mean = total / rows;
      bestDrop = Math.max(bestDrop, mean);
      return mean;
    });
    const probeAt = drops.findIndex((d) => d >= bestDrop * 0.95);
    const blend = CLIFF_PROBE_M[probeAt < 0 ? 0 : probeAt];

    const left = new Float32Array(rows);
    const right = new Float32Array(rows);
    for (let r = 0; r < rows; r++) {
      const [l, rt] = sideAt(r, blend);
      left[r] = l;
      right[r] = rt;
    }
    smoothColumns(left, rows, 1, CLIFF_SMOOTH_RADIUS);
    smoothColumns(right, rows, 1, CLIFF_SMOOTH_RADIUS);

    // Quel côté domine, sur toute la longueur : un trait qui changerait de
    // sens en cours de route se tordrait. La somme tranche une fois.
    let bias = 0;
    for (let r = 0; r < rows; r++) bias += left[r] - right[r];
    const side = bias >= 0 ? 1 : -1;

    const crest = new Float32Array(rows);
    const foot = new Float32Array(rows);
    let tallest = 0;
    for (let r = 0; r < rows; r++) {
      crest[r] = side > 0 ? left[r] : right[r];
      foot[r] = side > 0 ? right[r] : left[r];
      tallest = Math.max(tallest, crest[r] - foot[r]);
    }
    if (tallest < CLIFF_MIN_HEIGHT_M) {
      seen.tooFlat++;
      return;
    }

    // Une largeur unique par trait : la paroi doit garder son aplomb sur toute
    // sa longueur, et l'index interpole les cotes, pas la géométrie.
    const faceWidth = cliffFaceWidth(tallest, this.spec);

    for (let r = 0; r < rows - 1; r++) {
      const ax = path[r].x;
      const az = path[r].z;
      const dx = path[r + 1].x - ax;
      const dz = path[r + 1].z - az;
      const length = Math.hypot(dx, dz);
      if (length < 1e-3) continue;
      const tx = dx / length;
      const tz = dz / length;
      segments.push({
        ax,
        az,
        tx,
        tz,
        // Normale orientée vers le haut de la falaise.
        nx: tz * side,
        nz: -tx * side,
        length,
        footA: foot[r],
        footB: foot[r + 1],
        crestA: crest[r],
        crestB: crest[r + 1],
        face: faceWidth,
        blend,
        openStart: r === 0,
        openEnd: r === rows - 2,
      });
    }

    // L'axe de la bande de roche : la paroi va du trait à `face` vers le haut,
    // la bande se centre donc à mi-paroi et non sur le trait.
    const centre = [];
    for (let r = 0; r < rows; r++) {
      centre.push({
        x: path[r].x + frames[r * 4 + 2] * side * (faceWidth / 2),
        z: path[r].z + frames[r * 4 + 3] * side * (faceWidth / 2),
      });
    }
    bands.push({ path: centre, width: faceWidth + 2 * CLIFF_ROCK_MARGIN_M });
    this._appendFaceSheet(path, frames, foot, crest, faceWidth, side, tallest, face);
  }

  /**
   * La nappe de paroi : une grille plaquée sur la marche, subdivisée assez
   * finement pour que le grain du sol ait des sommets à déplacer. Rien n'est
   * déplacé ici — le shader du terrain s'en charge, et lui seul.
   */
  _appendFaceSheet(path, frames, foot, crest, faceWidth, side, tallest, out) {
    const rows = Math.max(2, Math.ceil(tallest / CLIFF_FACE_CELL_M) + 1);
    const sub = Math.max(1, Math.round(CLIFF_SAMPLE_M / CLIFF_FACE_CELL_M));
    const columns = (path.length - 1) * sub + 1;
    if (out.positions.length / 3 + columns * rows > CLIFF_FACE_MAX_VERTICES) return;

    const scale = this.bubble.verticalScale;
    const start = out.positions.length / 3;

    for (let c = 0; c < columns; c++) {
      // Position et cotes interpolées entre deux points du tracé : la nappe
      // est plus fine que lui, sans quoi le bruit n'aurait qu'un échantillon
      // par maille et se lirait encore comme un plan.
      const g = c / sub;
      const i = Math.min(path.length - 2, Math.floor(g));
      const u = g - i;
      const px = path[i].x + (path[i + 1].x - path[i].x) * u;
      const pz = path[i].z + (path[i + 1].z - path[i].z) * u;
      const nx = (frames[i * 4 + 2] + (frames[(i + 1) * 4 + 2] - frames[i * 4 + 2]) * u) * side;
      const nz = (frames[i * 4 + 3] + (frames[(i + 1) * 4 + 3] - frames[i * 4 + 3]) * u) * side;
      const len = Math.hypot(nx, nz) || 1;
      const ux = nx / len;
      const uz = nz / len;
      const low = foot[i] + (foot[i + 1] - foot[i]) * u;
      const high = crest[i] + (crest[i + 1] - crest[i]) * u;

      for (let r = 0; r < rows; r++) {
        const t = r / (rows - 1);
        const across = faceWidth * t;
        out.positions.push(
          px + ux * across,
          (low + (high - low) * cliffProfileAt(t)) * scale,
          pz + uz * across
        );
        // La paroi regarde le vide, donc l'opposé du haut de la falaise. Une
        // normale horizontale : c'est elle qui fait dire au shader que c'est
        // de la roche, et qui choisit le plan du bruit.
        out.normals.push(-ux, 0, -uz);
      }
    }

    for (let c = 0; c < columns - 1; c++) {
      for (let r = 0; r < rows - 1; r++) {
        const a = start + c * rows + r;
        const b = a + rows;
        const d = a + 1;
        const e = b + 1;
        // L'enroulement suit le côté : la nappe doit présenter sa face au vide.
        if (side > 0) out.indices.push(a, b, d, d, b, e);
        else out.indices.push(a, d, b, b, d, e);
      }
    }
  }

  _applyFace(buffer) {
    const { THREE } = this;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (!buffer.indices.length) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffer.normals, 3));
    geometry.setIndex(buffer.indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.bubble.materials.material);
    mesh.name = 'cliff-face';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.mesh = mesh;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.index = null;
    this.bands = [];
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.scene.remove(this.group);
    // Sinon un changement d'observateur laisse des marches sans rien dessus.
    this.bubble?.setCliffCut?.(null);
  }
}
