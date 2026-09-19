/*
 * cliffLayer — les falaises relevées : `natural=cliff` d'OpenStreetMap, servi
 * par OpenMapTiles dans la couche `mountain_peak` (classe `cliff`, une
 * polyligne) à partir du zoom 13.
 *
 * Deux gestes, et le premier commande le second :
 *
 * 1. **la marche.** Le MNT étale une falaise en rampe — une falaise de mer de
 *    quatre-vingts mètres se lit sur une centaine de mètres de pente douce. La
 *    couche publie un index (`CliffIndex`) que `terrainBubble` interroge pour
 *    comprimer cette rampe en marche (`terrain/cliffCut`). Sans lui, une paroi
 *    verticale posée sur la rampe flotterait au-dessus ou s'y enterrerait ;
 * 2. **la paroi.** La roche est balayée le long du trait (`appendRockCut`,
 *    celui-là même qui sert la falaise du déblai), grainée ligne par ligne
 *    (`facetJitter`) et ombrée à plat : c'est ce grain qui fait lire une
 *    falaise plutôt qu'un plan incliné.
 *
 * Le haut et le bas ne sont pas déduits du sens de tracé. La convention OSM
 * met le haut à gauche, mais elle est diversement respectée et le découpage en
 * tuiles ne garantit pas le sens : le MNT tranche, en lisant l'altitude des
 * deux côtés. Il est de toute façon lu là pour les cotes.
 */

import {
  appendRockCut,
  createProfileBuffer,
  toColoredGeometry,
  resamplePath,
  pathFrames,
  smoothColumns,
} from './ribbonGeometry.js';
import { facetJitter } from './facetJitter.js';
import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { cellKey } from './roadGraph.js';
import { furnitureSpecsFor } from './furnitureKit.js';
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

/** Graine du grain de la paroi. */
const CLIFF_SEED = 9311;

/** Lissage du MNT avant usage : la silhouette a son grain, pas celui du relevé. */
const CLIFF_SMOOTH_RADIUS = 2;

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
      // Abscisse curviligne, bornée aux extrémités.
      this._t = s.length > 0 ? (along < 0 ? 0 : along > s.length ? 1 : along / s.length) : 0;
    }

    return found;
  }

  /** Altitude du terrain au point, falaise comprise. */
  elevationAt(x, z, raw) {
    const k = this._scan(x, z);
    if (k < 0) return raw;
    const s = this.segments[k];
    const t = this._t;
    return cliffElevationAt(
      raw,
      s.footA + (s.footB - s.footA) * t,
      s.crestA + (s.crestB - s.crestA) * t,
      this._across,
      s.face,
      s.blend
    );
  }
}

export class CliffLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble  La bulle de terrain : elle fournit le MNT
   *        brut et reçoit l'index (`setCliffCut`).
   * @param {Object} options.theme
   */
  constructor({ THREE, scene, bubble, material, theme }) {
    this.THREE = THREE;
    this.scene = scene;
    this.bubble = bubble;
    this.material = material;
    this.spec = furnitureSpecsFor(theme.furniture.colors).cliff;

    this.group = new THREE.Group();
    this.group.name = 'cliffs';
    scene.add(this.group);

    this.mesh = null;
    this.index = null;
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
   * Reconstruit les falaises depuis les tuiles déjà décodées.
   * @returns {boolean} vrai si au moins un trait a été taillé.
   */
  rebuild(source, tiles, here) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    const segments = [];
    const buffer = createProfileBuffer();

    // Compté à chaque étape : une falaise absente à l'écran peut l'être parce
    // que la couche source est vide, parce qu'aucun trait n'est classé
    // `cliff`, ou parce que le MNT ne voit pas de dénivelée là où OSM en
    // annonce une. Les trois se corrigent ailleurs, d'où le décompte.
    const seen = { features: 0, cliffs: 0, paths: 0, tooFlat: 0 };
    for (const line of this._collectPaths(source, tiles, here, seen)) {
      this._buildCliff(line, segments, buffer, seen);
    }
    this.seen = seen;
    if (segments.length === 0 && seen.features > 0) {
      console.warn('[cliffLayer] aucune falaise taillée', JSON.stringify(seen));
    }

    this.count = segments.length;
    this.index = segments.length ? new CliffIndex(segments) : null;
    // L'index avant la géométrie : c'est lui qui commande la marche du
    // terrain, et la paroi se pose sur cette marche.
    this.bubble.setCliffCut(this.index);
    this._apply(buffer);

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

  /** Taille un tracé : cotes lues dans le MNT, segments publiés, paroi balayée. */
  _buildCliff(path, segments, buffer, seen) {
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
    const face = cliffFaceWidth(tallest, this.spec);

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
        face,
        blend,
      });
    }

    // Le sol derrière l'arase, à mi-dos et au bout du dos : c'est là que la
    // roche va se perdre. Lu au plus haut du naturel et de l'arase, comme le
    // fera la marche elle-même — sinon le dos plongerait dans le terrain que
    // celle-ci vient de relever.
    const capReach = this.spec.capReach;
    const behind = { mid: new Float32Array(rows), far: new Float32Array(rows) };
    for (let r = 0; r < rows; r++) {
      const px = frames[r * 4 + 2] * side;
      const pz = frames[r * 4 + 3] * side;
      const at = (d) => Math.max(raw(path[r].x + px * d, path[r].z + pz * d), crest[r]);
      behind.mid[r] = at(face + capReach * this.spec.shelfAt);
      behind.far[r] = at(face + capReach);
    }
    smoothColumns(behind.mid, rows, 1, CLIFF_SMOOTH_RADIUS);
    smoothColumns(behind.far, rows, 1, CLIFF_SMOOTH_RADIUS);

    this._appendFace(path, foot, crest, face, side, buffer, behind);
  }

  /**
   * La roche, balayée du pied à l'arase et grainée ligne par ligne.
   *
   * Le dessus ne se referme pas sur une table plate : comme la falaise du
   * déblai, il va chercher le sol derrière l'arase et s'y perd. Une bande
   * horizontale à cote constante se lit comme un mur posé là, quel que soit
   * son grain.
   */
  _appendFace(path, foot, crest, face, side, buffer, behind) {
    const rows = path.length;
    const spec = this.spec;
    const scale = this.bubble.verticalScale;
    const grain = facetJitter(path, CLIFF_SEED, spec.grain);

    const base = new Float32Array(rows);
    const top = new Float32Array(rows);
    const reach = new Float32Array(rows);
    const cap = new Float32Array(rows);
    const shelf = new Float32Array(rows);
    const breakUp = new Float32Array(rows);
    const breakOut = new Float32Array(rows);
    const footOut = new Float32Array(rows);
    const capOut = new Float32Array(rows);

    for (let r = 0; r < rows; r++) {
      // Pied enfoncé : sous le trait, le terrain suit le naturel s'il descend
      // plus bas que le pied lu, et une semelle posée pile à la cote
      // laisserait voir le dessous de la paroi.
      base[r] = (foot[r] - spec.bury) * scale;
      // Arase dentelée vers le haut seulement : vers le bas, la roche
      // passerait sous le terrain qu'elle est censée couvrir.
      top[r] = (crest[r] + grain.crest[r]) * scale;
      reach[r] = face * grain.reach[r];
      breakUp[r] = spec.breakUp * grain.breakUp[r];
      breakOut[r] = spec.breakOut * grain.breakOut[r];
      footOut[r] = grain.foot[r];
      capOut[r] = grain.capOut[r];

      // Le raccord se pose sur le sol qui est derrière, relevé du débord :
      // la maille du terrain coupe ce sol en droites qui peuvent dépasser, et
      // une arase pile au niveau laisserait l'herbe passer par-dessus.
      cap[r] = (behind.far[r] + spec.crown) * scale;
      // La banquette se tient entre le sol à mi-dos et la ligne qui joint
      // l'arase au raccord : à zéro elle épouse le sol, à un elle tend la
      // roche par-dessus. Entre les deux, le dessus ondule au lieu d'être une
      // table.
      const ramp = behind.mid[r] * scale;
      const straight = top[r] + (cap[r] - top[r]) * spec.shelfAt;
      const bank = Math.min(1, Math.max(0, spec.bank * grain.bank[r]));
      shelf[r] = ramp + (Math.max(straight, ramp) - ramp) * bank;
    }

    appendRockCut(buffer, {
      path,
      base,
      crest: top,
      shelf,
      cap,
      reach,
      capReach: spec.capReach,
      capOut,
      shelfAt: spec.shelfAt,
      breakUp,
      breakOut,
      footOut,
      side,
      colorFoot: spec.colorFoot,
      colorBreak: spec.colorBreak,
      colorTop: spec.colorTop,
    });
  }

  _apply(buffer) {
    const { THREE } = this;
    // Ombrage à plat : sans lui les arêtes du grain sont moyennées et la
    // paroi redevient lisse (voir `FLAT_SHADED_LINEAR_KINDS`).
    const geometry = toColoredGeometry(THREE, buffer, { flat: true });

    if (!geometry) {
      if (this.mesh) {
        this.group.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh = null;
      }
      return;
    }

    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
      return;
    }

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = 'cliff-face';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.mesh = mesh;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.index = null;
    // Sinon un changement d'observateur laisse des marches sans paroi.
    this.bubble?.setCliffCut?.(null);
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.scene.remove(this.group);
  }
}
