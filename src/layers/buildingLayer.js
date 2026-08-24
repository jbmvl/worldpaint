/*
 * buildingLayer — le bâti, extrudé depuis les tuiles vectorielles.
 * ------------------------------------------------------------------
 * Traverser un village qui n'existe qu'en photo était le manque le plus
 * visible.
 *
 * Les empreintes viennent de la couche `building` des tuiles vectorielles,
 * chargées par `vectorTileSource` **pour la bulle** — et non par interrogation
 * d'une carte 2D voisine, qui ne rendrait que ce que sa propre fenêtre a
 * chargé. La portée du décor ne dépend ainsi que du décor.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { buildingStyleAt } from './townStyle.js';
import { orientedBox, roofTriangles, roofRise, ringArea } from './roofGeometry.js';
import { defaultTheme } from '../themes/default.js';

/** Couche vectorielle portant les empreintes. */
export const BUILDING_SOURCE_LAYER = 'building';

/**
 * Rayon autour de l'observateur au-delà duquel on ignore un bâtiment, en mètres.
 * La bulle porte à ~2 km ; au-delà de ce rayon, le brouillard a déjà fondu le
 * décor dans l'horizon.
 */
export const BUILDING_RADIUS_M = 1500;
/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const BUILDING_REBUILD_M = 200;
/** Hauteur retenue quand la donnée n'en porte aucune. */
export const BUILDING_DEFAULT_HEIGHT = 7;
/** Hauteur d'un niveau, quand seule `building:levels` est connue. */
export const BUILDING_LEVEL_HEIGHT = 3.2;
/** Plafond de sécurité : au-delà, la donnée est suspecte. */
export const BUILDING_MAX_HEIGHT = 120;
/**
 * Nombre maximal de bâtiments retenus par reconstruction.
 *
 * Le plafond ne protège pas le rendu — quinze cents empreintes font quelques
 * dizaines de milliers de sommets, ce qui n'est rien — mais le temps de
 * reconstruction. Il s'applique **après tri par distance** : appliqué dans
 * l'ordre d'arrivée, c'est-à-dire dans l'ordre des tuiles, il dépensait tout le
 * budget sur le coin nord-ouest de la bulle et laissait un trou juste à côté 
 * de l'observateur.
 */
export const BUILDING_MAX_COUNT = 1500;

/**
 * Fenêtres allumées : portée, et plafond de panneaux.
 *
 * Une nuit sans fenêtre allumée est le moment où le décor cesse d'être crédible :
 * on traverse un village entier de blocs éteints. C'est aussi le seul éclairage
 * qui ne coûte rien — pas de lumière, pas d'ombre, juste des panneaux émissifs
 * qu'on n'allume que la nuit.
 *
 * La portée est bien plus courte que celle du bâti : à cinq cents mètres, une
 * fenêtre fait un quart de pixel, et il en faudrait des dizaines de milliers
 * pour couvrir toute la bulle.
 */
export const WINDOW_RADIUS_M = 420;
export const WINDOW_MAX_COUNT = 2600;

/** Tirage déterministe dans [0, 1[ attaché à un lieu et à un rang. Pure. */
export function windowDraw(x, z, salt) {
  let h = (Math.round(x * 4) * 73856093) ^ (Math.round(z * 4) * 19349663) ^ ((salt | 0) * 83492791);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Grille de fenêtres d'un pan de mur : rangs et niveaux effectivement posables.
 *
 * Fonction pure, et séparée parce que c'est le seul endroit où une erreur
 * d'arithmétique produirait des fenêtres à cheval sur l'arête d'un mur ou
 * flottant au-dessus de la gouttière.
 *
 * @param {number} length Longueur du pan, en mètres.
 * @param {number} height Hauteur du bâtiment, en mètres.
 * @returns {{columns:number, levels:number, spacing:number}}
 */
export function windowGrid(length, height, windows = defaultTheme.windows) {
  const spacing = windows.widthM * 2.6;
  // Une marge d'un demi-entraxe à chaque bout : une fenêtre n'est jamais au ras
  // de l'angle du mur.
  const columns = Math.floor((length - spacing) / spacing);
  const levels = Math.floor((height - windows.sillM - windows.heightM) / windows.levelM) + 1;
  return { columns: Math.max(0, columns), levels: Math.max(0, levels), spacing };
}

/**
 * Hauteur d'un bâtiment d'après ses attributs, en mètres.
 * Fonction pure : les schémas de tuiles varient d'un fournisseur à l'autre, et
 * c'est exactement le genre d'endroit où une régression passe inaperçue.
 */
export function buildingHeight(properties = {}) {
  const candidates = [
    properties.render_height,
    properties.height,
    properties['building:height'],
  ];
  for (const raw of candidates) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return Math.min(value, BUILDING_MAX_HEIGHT);
  }

  const levels = Number(properties.render_levels ?? properties.levels ?? properties['building:levels']);
  if (Number.isFinite(levels) && levels > 0) {
    return Math.min(levels * BUILDING_LEVEL_HEIGHT, BUILDING_MAX_HEIGHT);
  }
  return BUILDING_DEFAULT_HEIGHT;
}

/** Hauteur du dessous du bâtiment (passages couverts, `min_height`). */
export function buildingMinHeight(properties = {}) {
  const value = Number(properties.render_min_height ?? properties.min_height ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.min(value, BUILDING_MAX_HEIGHT) : 0;
}

/**
 * Aire algébrique d'un anneau (formule du lacet). Le signe donne le sens de
 * parcours, dont dépend l'orientation des murs.
 * @param {Array<[number, number]>} ring
 */
export function ringSignedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

/** Centre approximatif d'un anneau, en moyenne de ses sommets. */
export function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  // Le dernier point répète le premier dans un anneau GeoJSON fermé.
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1
    : ring.length;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

/** Extrait les anneaux extérieurs d'une géométrie GeoJSON de bâtiment. */
export function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.slice(0, 1);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((polygon) => polygon[0]).filter(Boolean);
  return [];
}

export class BuildingLayer {
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
    this.mesh = null;
    this.geometry = null;
    this._anchor = null;
    this._frame = null;
    this.count = 0;
    this.windowCount = 0;

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });

    // Fenêtres allumées : un matériau à part, non éclairé et additif, dont
    // l'opacité suit l'heure. Un `MeshBasicMaterial` suffit — une fenêtre
    // allumée émet sa lumière, elle n'en reçoit pas.
    this.windowMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Le brouillard s'applique : une fenêtre à trois cents mètres dans la
      // brume doit s'y noyer comme le mur qui la porte.
      fog: true,
    });
    this.windowMaterial.name = 'building-windows';
    this.windowMesh = null;
    this.windowGeometry = null;
  }

  /** Vrai si l'observateur s'est assez éloigné pour justifier une reconstruction. */
  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= BUILDING_REBUILD_M;
  }

  /**
   * Reconstruit le bâti depuis les tuiles déjà décodées.
   * @param {Object} source Instance `VectorTileSource`.
   * @param {Array} tiles   Tuiles à parcourir.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   * @returns {boolean} vrai si des bâtiments ont été produits.
   */
  rebuild(source, tiles, here) {
    if (this.disposed || !this.bubble?.frame || !source) return false;
    this._build(source, tiles, here);
    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
    return this.count > 0;
  }

  _build(source, tiles, here) {
    const { THREE, bubble } = this;
    const frame = bubble.frame;
    const { origin, scale, zoom } = frame;

    const positions = [];
    const normals = [];
    const colors = [];
    const windows = { positions: [], normals: [], colors: [] };
    // Les empreintes sont découpées par les tuiles : une même bâtisse revient
    // d'une tuile à l'autre. On dédoublonne sur un centre au demi-mètre, croisé
    // avec le nombre de sommets — deux bâtisses voisines peuvent partager un
    // centre arrondi, pas une silhouette.
    const seen = new Set();
    const candidates = [];

    source.forEachFeature(BUILDING_SOURCE_LAYER, tiles, (geometry, properties) => {
      for (const ring of outerRings(geometry)) {
        if (!Array.isArray(ring) || ring.length < 4) continue;

        const [cLng, cLat] = ringCentroid(ring);
        const x = (lngToTileX(cLng, zoom) - origin.x) * scale;
        const z = (latToTileY(cLat, zoom) - origin.y) * scale;
        const distance = Math.hypot(x - here.x, z - here.z);
        if (distance > BUILDING_RADIUS_M) continue;

        const key = `${Math.round(x * 2)},${Math.round(z * 2)},${ring.length}`;
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({ ring, properties, distance });
      }
    });

    // Le tri est ce qui rend le plafond acceptable : ce qui saute est toujours
    // le plus lointain, jamais ce qui est sous les yeux.
    candidates.sort((a, b) => a.distance - b.distance);
    if (candidates.length > BUILDING_MAX_COUNT) {
      console.info(
        `[buildingLayer] ${candidates.length} empreintes dans ${BUILDING_RADIUS_M} m, ` +
          `plafonnées à ${BUILDING_MAX_COUNT} — les plus lointaines sont écartées`
      );
      candidates.length = BUILDING_MAX_COUNT;
    }

    let built = 0;
    for (const candidate of candidates) {
      // Les fenêtres ne sont posées que sur les bâtiments proches : au-delà,
      // elles ne font plus un pixel et il en faudrait des dizaines de milliers.
      const lit = candidate.distance <= WINDOW_RADIUS_M && windows.positions.length / 9 < WINDOW_MAX_COUNT;
      if (
        this._appendBuilding(
          candidate.ring,
          candidate.properties,
          positions,
          normals,
          colors,
          lit ? windows : null
        )
      ) {
        built++;
      }
    }

    this.count = built;
    this.windowCount = windows.positions.length / 9;
    this._applyWindows(windows);
    if (positions.length === 0) {
      this._clearMesh();
      return;
    }

    const geometryBuffer = new THREE.BufferGeometry();
    geometryBuffer.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometryBuffer.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometryBuffer.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometryBuffer.computeBoundingSphere();

    if (this.mesh) {
      this.geometry.dispose();
      this.mesh.geometry = geometryBuffer;
    } else {
      const mesh = new THREE.Mesh(geometryBuffer, this.material);
      mesh.name = 'buildings';
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      this.scene.add(mesh);
      this.mesh = mesh;
    }
    this.geometry = geometryBuffer;
  }

  /**
   * @param {Object|null} windows Accumulateur des fenêtres allumées, ou `null`
   *        pour un bâtiment trop lointain pour en mériter.
   * @returns {boolean} vrai si le bâtiment a produit de la géométrie.
   */
  _appendBuilding(ring, properties, positions, normals, colors, windows = null) {
    const { THREE, bubble } = this;
    const { origin, scale, zoom } = bubble.frame;

    // Anneau en mètres locaux, sans le point de fermeture répété.
    const points = [];
    const closed =
      ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    const last = closed ? ring.length - 1 : ring.length;
    for (let i = 0; i < last; i++) {
      const [lng, lat] = ring[i];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
      points.push(new THREE.Vector2((lngToTileX(lng, zoom) - origin.x) * scale, (latToTileY(lat, zoom) - origin.y) * scale));
    }
    if (points.length < 3) return false;

    // Assise : le point le plus bas de l'empreinte. Sur une pente, poser le
    // bâtiment à l'altitude de son centre le ferait flotter d'un côté.
    let base = Infinity;
    for (const p of points) {
      const ground = bubble.surfaceElevationAtLocal(p.x, p.y) * bubble.verticalScale;
      if (ground < base) base = ground;
    }
    if (!Number.isFinite(base)) return false;

    const height = buildingHeight(properties);
    const minHeight = buildingMinHeight(properties);
    const bottom = base + minHeight - 0.6; // un peu enterré : pas de jour sous les murs
    const top = base + height;

    // Sens de parcours : il détermine de quel côté regardent les murs.
    const area = ringSignedArea(points.map((p) => [p.x, p.y]));
    const ordered = area < 0 ? points.slice().reverse() : points;

    // Couleur et forme du toit : celles du **bourg**, avec une variation par
    // maison. Voir `townStyle` — les tuiles ne portent ni matériau ni forme de
    // toit, mais la vraie régularité du bâti n'est pas à l'échelle de la maison,
    // elle est à celle du pays.
    const footprint = ordered.map((p) => ({ x: p.x, z: p.y }));
    const box = orientedBox(footprint);
    const ground = ringArea(footprint);
    const style = buildingStyleAt(
      footprint[0].x,
      footprint[0].z,
      { area: ground, height },
      this.theme.towns
    );
    const wallColor = style.wall;
    const roofColor = style.roof;

    // Un toit pentu prend sa hauteur **sur** le bâtiment, pas au-dessus : sinon
    // toutes les maisons grandissent d'un étage et le village change d'échelle.
    // L'égout descend donc de la hauteur du comble, dans la limite du
    // raisonnable — un bâtiment d'un seul niveau n'a pas de murs négatifs.
    const shape = box && box.fill >= 0.62 ? style.shape : 'flat';
    const rise = shape === 'flat' ? 0 : roofRise(box.short, this.theme.roofs);
    const eaves = Math.max(bottom + 2.4, top - rise);

    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i];
      const b = ordered[(i + 1) % ordered.length];
      let nx = b.y - a.y;
      let nz = -(b.x - a.x);
      const length = Math.hypot(nx, nz) || 1;
      nx /= length;
      nz /= length;

      // Enroulement choisi pour que la face avant regarde vers l'extérieur :
      // notre plan (x, z) est de chiralité opposée au plan (x, y) usuel, donc
      // l'ordre « naturel » donnerait des murs visibles seulement de l'intérieur.
      const quad = [
        [a.x, bottom, a.y],
        [b.x, eaves, b.y],
        [b.x, bottom, b.y],
        [a.x, bottom, a.y],
        [a.x, eaves, a.y],
        [b.x, eaves, b.y],
      ];
      // Soubassement plus sombre : c'est le seul « pattern » que porte le mur, et
      // il suffit à ancrer la maison au sol. Un pan de crépi rigoureusement
      // uniforme du trottoir à la gouttière n'existe pas.
      const plinth = wallColor.map((c) => c * 0.82);
      for (const [x, y, z] of quad) {
        positions.push(x, y, z);
        normals.push(nx, 0, nz);
        colors.push(...(y <= bottom + 0.01 ? plinth : wallColor));
      }

      if (windows) this._appendWindows(windows, a, b, nx, nz, base, eaves - base, minHeight);
    }

    if (shape === 'flat') {
      // Toit-terrasse : triangulation par oreilles, fournie par three. Une
      // empreinte dégénérée la fait échouer — un bâtiment sans toit vaut mieux
      // qu'une scène sans bâtiments.
      let faces = [];
      try {
        faces = THREE.ShapeUtils.triangulateShape(ordered, []) || [];
      } catch (e) {
        faces = [];
      }
      // Ordre inversé pour la même raison que les murs : la toiture doit
      // regarder le ciel.
      for (const [i0, i1, i2] of faces) {
        for (const index of [i0, i2, i1]) {
          const p = ordered[index];
          positions.push(p.x, eaves, p.y);
          normals.push(0, 1, 0);
          colors.push(...roofColor);
        }
      }
      return true;
    }

    // Comble : faîtière, croupe ou pyramide, bâti sur le rectangle englobant
    // orienté de l'empreinte (voir `roofGeometry`).
    const roof = roofTriangles(box, eaves, shape, this.theme.roofs);
    for (let i = 0; i < roof.positions.length; i += 3) {
      positions.push(roof.positions[i], roof.positions[i + 1], roof.positions[i + 2]);
      normals.push(roof.normals[i], roof.normals[i + 1], roof.normals[i + 2]);
      colors.push(...roofColor);
    }

    return true;
  }

  /**
   * Pose les fenêtres allumées d'un pan de mur.
   *
   * Les panneaux sont décollés du mur de deux centimètres : coplanaires, ils se
   * disputeraient le pixel avec lui et clignoteraient. Le décalage est trop
   * petit pour se voir, et il est porté par la normale du mur, donc il reste
   * correct quelle que soit son orientation.
   *
   * Quelle fenêtre est allumée ne dépend **que de sa position au sol et de son
   * rang** : le village garde donc les mêmes fenêtres allumées d'une
   * reconstruction à l'autre, là où un tirage libre les ferait clignoter tous
   * les 200 mètres parcourus.
   */
  _appendWindows(windows, a, b, nx, nz, base, height, minHeight) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const storeys = height - minHeight;
    const look = this.theme.windows;
    if (length < 3 || storeys < look.sillM + look.heightM) return;

    const grid = windowGrid(length, storeys, look);
    if (grid.columns === 0 || grid.levels === 0) return;

    // Vecteur unitaire le long du mur, et sa normale déjà fournie.
    const ux = (b.x - a.x) / length;
    const uz = (b.y - a.y) / length;
    const halfW = look.widthM / 2;
    const lift = 0.02;

    for (let c = 0; c < grid.columns; c++) {
      const along = grid.spacing * (c + 1);
      const cx = a.x + ux * along + nx * lift;
      const cz = a.y + uz * along + nz * lift;

      for (let level = 0; level < grid.levels; level++) {
        if (windows.positions.length / 9 >= WINDOW_MAX_COUNT) return;
        if (windowDraw(cx, cz, level + 1) > look.litShare) continue;

        const bottom = base + minHeight + look.sillM + level * look.levelM;
        const top = bottom + look.heightM;
        // Teinte de l'ampoule : du blanc froid au jaune franc, tirée par
        // fenêtre. Toutes de la même couleur, un village ressemble à un écran.
        const warmth = windowDraw(cx, cz, level + 41);
        const color = [0.95, 0.78 + warmth * 0.16, 0.42 + warmth * 0.3];

        const left = { x: cx - ux * halfW, z: cz - uz * halfW };
        const right = { x: cx + ux * halfW, z: cz + uz * halfW };
        const quad = [
          [left.x, bottom, left.z],
          [right.x, top, right.z],
          [right.x, bottom, right.z],
          [left.x, bottom, left.z],
          [left.x, top, left.z],
          [right.x, top, right.z],
        ];
        for (const [x, y, z] of quad) {
          windows.positions.push(x, y, z);
          windows.normals.push(nx, 0, nz);
          windows.colors.push(...color);
        }
      }
    }
  }

  /** (Ré)alimente le maillage des fenêtres allumées. */
  _applyWindows(windows) {
    const { THREE } = this;

    if (windows.positions.length === 0) {
      this._clearWindows();
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(windows.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(windows.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(windows.colors, 3));
    geometry.computeBoundingSphere();

    if (this.windowMesh) {
      this.windowGeometry?.dispose();
      this.windowMesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.windowMaterial);
      mesh.name = 'building-windows';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      // Après les murs : un panneau additif sans écriture de profondeur doit
      // être dessiné une fois le mur en place.
      mesh.renderOrder = 6;
      mesh.visible = this.windowMaterial.opacity > 0.01;
      this.scene.add(mesh);
      this.windowMesh = mesh;
    }
    this.windowGeometry = geometry;
  }

  /**
   * Allume les fenêtres.
   * @param {number} mix 0 en plein jour, 1 en pleine nuit.
   */
  setNight(mix) {
    const value = Math.min(1, Math.max(0, Number(mix) || 0));
    this.windowMaterial.opacity = value;
    if (this.windowMesh) this.windowMesh.visible = value > 0.01;
  }

  _clearWindows() {
    if (!this.windowMesh) return;
    this.scene.remove(this.windowMesh);
    this.windowGeometry?.dispose();
    this.windowMesh = null;
    this.windowGeometry = null;
  }

  _clearMesh() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.geometry?.dispose();
    this.mesh = null;
    this.geometry = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._clearMesh();
    this._clearWindows();
    this.material.dispose();
    this.windowMaterial.dispose();
  }
}
