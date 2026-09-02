/*
 * railwayLayer — les voies ferrées.
 * ----------------------------------
 * Un ballast et deux rails, balayés le long des tronçons de la couche
 * `transportation` dont `class` vaut `rail` — la même couche que lit
 * `roadNetwork`, qui les ignore déjà silencieusement (`ROAD_CLASSES` n'a pas
 * d'entrée `rail`) : les deux couches ne se marchent donc jamais dessus, sans
 * qu'aucune des deux ait besoin de le savoir.
 *
 * ## Le ballast est une chaussée comme une autre
 *
 * Il a d'abord été un balayage à section colorée (`appendProfile`), comme une
 * haie ou un muret. Résultat : une bande plate à quelques teintes de gris, sans
 * grain — exactement le défaut qu'a déjà résolu `createRoadCanvas` pour les
 * chaussées. Le ballast est donc maintenant un **ruban texturé** comme elles
 * (`appendRibbon` + la même fabrique de canevas, avec un revêtement `ballast`
 * ajouté au thème), et non une pièce à part réinventant son propre grain.
 * Les rails, eux, restent une section colorée : ce sont deux fils d'acier fins,
 * pas une surface, et une texture n'y ajouterait rien à cette échelle.
 *
 * ## L'emprise ferroviaire est un corridor, comme celle de la route
 *
 * `roadCorridor` documente l'emprise routière comme *la* frontière partagée du
 * paysage — mais elle n'était, jusqu'ici, construite que sur des chaussées.
 * Une voie ferrée est le même genre d'objet : rien n'a le droit d'y pousser ni
 * de s'y poser. Cette couche publie donc son propre index (`RoadIndex`,
 * réutilisée telle quelle — `streetLayer` le fait déjà pour sa bande revêtue),
 * que `worldComposer` transmet au mobilier au même titre que celui des routes.
 *
 * ## Ce qui manque encore, et pourquoi c'est assumé
 *
 * Contrairement à une chaussée, la voie **n'entaille pas le terrain** : pas de
 * plate-forme dressée de niveau (`levelRow`), pas de déblai ni de remblai, pas
 * de mur. Le ballast suit le MNT tel quel, échantillonné point par point comme
 * un cours d'eau linéaire (`waterLayer._appendWaterways`). C'est une
 * simplification, pas un oubli : lui donner les mêmes ouvrages que
 * `roadNetwork` — plate-forme, murs de soutènement, ponts, passages à niveau —
 * est un chantier à part entière, qui reste à faire.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import {
  resamplePath,
  createProfileBuffer,
  appendProfile,
  createRibbonBuffer,
  appendRibbon,
  pathFrames,
  toColoredGeometry,
  toGeometry,
} from './ribbonGeometry.js';
import { createRoadCanvas, ROAD_TEXTURE_LENGTH } from '../materials/proceduralTextures.js';
import { RoadIndex, ROAD_INDEX_MARGIN_M } from './roadGraph.js';
import { defaultTheme } from '../themes/default.js';

/** Couche source des tuiles vectorielles — celle des chaussées aussi. */
export const RAILWAY_SOURCE_LAYER = 'transportation';
/** Portée maximale autour de l'observateur, en mètres. */
export const RAILWAY_RADIUS_M = 900;
/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const RAILWAY_REBUILD_M = 250;
/** Pas de ré-échantillonnage le long d'une voie, en mètres. */
export const RAILWAY_SAMPLE_M = 6;
/** Graine du canevas de ballast — propre à cette pièce, comme chaque profil routier. */
const RAILWAY_TEXTURE_SEED = 6203;

/** Demi-écartement des rails, en mètres — proche de la voie normale (1,435 m). */
export const RAILWAY_GAUGE_HALF_M = 0.72;
/** Demi-largeur du ballast, rails compris — c'est aussi la demi-largeur du corridor. */
export const RAILWAY_BALLAST_HALF_M = 1.75;

/** Section balayée d'un seul rail : un fil d'acier en léger relief. Fonction pure du nuancier. */
export function railProfileFor(C = defaultTheme.furniture.colors) {
  return [
    { across: -0.07, up: 0.1, color: C.rock },
    { across: -0.03, up: 0.22, color: C.steelDark },
    { across: 0.03, up: 0.22, color: C.steelDark },
    { across: 0.07, up: 0.1, color: C.rock },
  ];
}

export class RailwayLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   */
  constructor({ THREE, scene, bubble, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.disposed = false;
    this.railProfile = railProfileFor(theme.furniture.colors);

    // Ballast : texturé comme une chaussée, avec le même canevas de grain
    // (`createRoadCanvas`) et un revêtement propre (`ballast`, dans
    // `ROAD_SURFACES` du thème). Aucun accotement, aucune ligne peinte : ce ne
    // sont pas des options de ce profil.
    const canvas = createRoadCanvas(
      { width: RAILWAY_BALLAST_HALF_M * 2, texture: 64, surface: 'ballast' },
      RAILWAY_TEXTURE_SEED,
      theme.roads
    );
    this.ballastTexture = new THREE.CanvasTexture(canvas);
    this.ballastTexture.colorSpace = THREE.SRGBColorSpace;
    this.ballastTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.ballastTexture.wrapT = THREE.RepeatWrapping;
    this.ballastTexture.anisotropy = 8;
    this.ballastMaterial = new THREE.MeshLambertMaterial({
      map: this.ballastTexture,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.ballastMaterial.name = 'railway-ballast';

    this.railMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.railMaterial.name = 'railway-rail';

    this.group = new THREE.Group();
    this.group.name = 'railway';
    scene.add(this.group);

    this.ballastMesh = null;
    this.ballastGeometry = null;
    this.railMesh = null;
    this.railGeometry = null;
    this.count = 0;
    this._anchor = null;
    this._frame = null;

    /**
     * Emprise ferroviaire, au même format que celle des routes
     * (`RoadIndex`) : c'est elle que `worldComposer` transmet au mobilier
     * pour qu'aucun objet ne se pose sur la voie, exactement comme il le fait
     * déjà pour la chaussée.
     * @type {Object|null}
     */
    this.index = null;
  }

  /** Vrai si l'observateur s'est assez éloigné pour justifier une reconstruction. */
  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= RAILWAY_REBUILD_M;
  }

  /**
   * Reconstruit la voie depuis les tuiles déjà décodées.
   * @returns {boolean} vrai si quelque chose a été posé.
   */
  rebuild(source, tiles, here) {
    if (this.disposed || !this.bubble?.frame || !source) return false;

    const radius = Math.min(RAILWAY_RADIUS_M, this.bubble.radiusMeters || RAILWAY_RADIUS_M);
    const { origin, scale, zoom } = this.bubble.frame;
    const sampleElevation = (x, z) => this.bubble.surfaceElevationAtLocal(x, z, 0) * this.bubble.verticalScale;

    const ballastBuffer = createRibbonBuffer();
    const railBuffer = createProfileBuffer();
    /** @type {Array<{path: Array, halfWidth: number}>} pour l'index de corridor. */
    const segments = [];

    source.forEachFeature(RAILWAY_SOURCE_LAYER, tiles, (geometry, properties) => {
      if (properties.class !== 'rail') return;
      // Un tunnel n'a rien à faire en surface ; un pont ferroviaire, en
      // l'absence de tablier modélisé, se contente de suivre le terrain comme
      // le reste de la voie — moins juste, mais jamais invisible.
      if (properties.brunnel === 'tunnel') return;

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
        if (!local.some((p) => Math.hypot(p.x - here.x, p.z - here.z) <= radius)) continue;

        const path = resamplePath(local, RAILWAY_SAMPLE_M);
        if (path.length < 2) continue;

        appendRibbon(ballastBuffer, {
          path,
          halfWidth: RAILWAY_BALLAST_HALF_M,
          sampleElevation,
          textureLength: ROAD_TEXTURE_LENGTH,
          // Le ballast suit le terrain point par point : voir l'en-tête du
          // fichier sur ce que cette simplification laisse de côté.
          level: false,
        });

        const frames = pathFrames(path);
        for (const side of [-1, 1]) {
          const rail = path.map((p, r) => ({
            x: p.x + frames[r * 4 + 2] * side * RAILWAY_GAUGE_HALF_M,
            z: p.z + frames[r * 4 + 3] * side * RAILWAY_GAUGE_HALF_M,
          }));
          appendProfile(railBuffer, {
            path: rail,
            profile: this.railProfile,
            sampleElevation,
            closed: true,
          });
        }

        segments.push({ path, halfWidth: RAILWAY_BALLAST_HALF_M });
      }
    });

    this._apply(ballastBuffer, railBuffer);
    // Marge généreuse à la construction : c'est un plafond, la marge réelle
    // se choisit à chaque interrogation (voir `RoadIndex.query`).
    this.index = segments.length > 0 ? new RoadIndex(segments, { margin: ROAD_INDEX_MARGIN_M }) : null;
    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
    return this.count > 0;
  }

  _apply(ballastBuffer, railBuffer) {
    const { THREE } = this;

    const ballastGeometry = toGeometry(THREE, ballastBuffer);
    const railGeometry = toColoredGeometry(THREE, railBuffer);
    this.count = ballastBuffer.indices.length / 3;

    if (!ballastGeometry) {
      if (this.ballastMesh) {
        this.group.remove(this.ballastMesh);
        this.ballastMesh.geometry.dispose();
        this.ballastMesh = null;
      }
      this.ballastGeometry = null;
    } else if (this.ballastMesh) {
      this.ballastMesh.geometry.dispose();
      this.ballastMesh.geometry = ballastGeometry;
      this.ballastGeometry = ballastGeometry;
    } else {
      this.ballastMesh = new THREE.Mesh(ballastGeometry, this.ballastMaterial);
      this.ballastMesh.name = 'railway';
      this.ballastMesh.matrixAutoUpdate = false;
      this.ballastMesh.updateMatrix();
      this.group.add(this.ballastMesh);
      this.ballastGeometry = ballastGeometry;
    }

    if (!railGeometry) {
      if (this.railMesh) {
        this.group.remove(this.railMesh);
        this.railMesh.geometry.dispose();
        this.railMesh = null;
      }
      this.railGeometry = null;
    } else if (this.railMesh) {
      this.railMesh.geometry.dispose();
      this.railMesh.geometry = railGeometry;
      this.railGeometry = railGeometry;
    } else {
      this.railMesh = new THREE.Mesh(railGeometry, this.railMaterial);
      this.railMesh.name = 'railway';
      this.railMesh.matrixAutoUpdate = false;
      this.railMesh.updateMatrix();
      this.group.add(this.railMesh);
      this.railGeometry = railGeometry;
    }
  }

  dispose() {
    this.disposed = true;
    this.ballastMesh?.geometry.dispose();
    this.railMesh?.geometry.dispose();
    this.ballastMaterial.dispose();
    this.railMaterial.dispose();
    this.ballastTexture.dispose();
    this.scene.remove(this.group);
    this.ballastMesh = null;
    this.railMesh = null;
    this.ballastGeometry = null;
    this.railGeometry = null;
  }
}
