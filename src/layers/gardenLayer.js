/*
 * gardenLayer — le jardin autour d'une maison.
 * ---------------------------------------------
 * Le bâti sortait posé à même l'herbe : une maison, puis le pré, sans rien
 * entre les deux. C'est le défaut qu'on ne nomme pas mais qu'on voit — une
 * maison de village n'a pas de bord flou, elle a une **limite**, et cette
 * limite est presque toujours une clôture basse avec quelque chose qui pousse
 * derrière.
 *
 * ## Ce que cette couche n'invente pas
 *
 * Elle n'invente aucune maison : elle reçoit celles que `buildingLayer` a
 * classées comme telles (`townStyle.isHouse`), avec leur rectangle englobant
 * orienté — le même que celui qui porte leur toit. Le jardin est donc **cadré
 * sur la maison**, pas tiré au hasard à côté d'elle, et il tourne avec elle.
 *
 * ## Ce qu'elle refuse
 *
 * Une maison mitoyenne n'a pas de jardin devant : dans un centre-bourg, poser
 * une clôture autour de chaque façade donnerait une grille de barrières
 * traversant les murs des voisines. Le voisinage est donc mesuré (`isDetached`)
 * et seules les maisons **détachées** en reçoivent un — ce qui est exactement
 * la règle du réel, et ce qui fait qu'un centre ancien reste dense et qu'un
 * hameau s'aère.
 *
 * ## Le coût
 *
 * Un piquet est un pentagone : un quadrilatère et sa pointe, trois triangles.
 * Une clôture de quarante mètres en compte une centaine, et tout est fusionné
 * dans un seul maillage refait avec le bâti. Le matériau est `DoubleSide` :
 * une planche de treize centimètres n'a pas d'épaisseur qui vaille la peine
 * d'être modélisée, mais elle se voit des deux côtés.
 *
 * Tirages **ancrés au lieu** : un jardin garde sa clôture, sa porte et ses
 * buissons d'une reconstruction à l'autre.
 */

import { randomAt } from './furniturePlacement.js';
import { pushPanel } from './buildingLayer.js';
import { srgb } from '../core/color.js';
import { defaultTheme } from '../themes/default.js';
import { inCorridor } from './roadCorridor.js';

/** Portée des jardins, en mètres. Au-delà, un piquet ne fait pas un pixel. */
export const GARDEN_RADIUS_M = 170;
/** Nombre maximal de jardins par reconstruction. */
export const GARDEN_MAX = 40;
/** Part des maisons détachées qui reçoivent un jardin clos. */
export const GARDEN_SHARE = 0.62;
/** Recul de la clôture par rapport au mur, en mètres : tiré dans cet écart. */
export const GARDEN_MARGIN_M = [2.4, 6.5];
/** Écart libre exigé autour de la clôture pour qu'une maison soit détachée. */
export const GARDEN_CLEAR_M = 2.5;

/** Piquets : écartement, largeur de planche, hauteur, pointe. En mètres. */
export const PICKET_SPACING_M = 0.42;
export const PICKET_WIDTH_M = 0.13;
export const PICKET_HEIGHT_M = 0.78;
export const PICKET_CAP_M = 0.13;
/** Lisse horizontale : sa cote et son épaisseur, en mètres. */
export const RAIL_Y_M = 0.46;
export const RAIL_HEIGHT_M = 0.09;
/** Portillon : la trouée laissée dans la clôture, en mètres. */
export const GATE_WIDTH_M = 1.15;
/** Enfoncement des piquets : ils ne flottent pas sur l'herbe. */
export const PICKET_SINK_M = 0.06;

/** Buissons par jardin, et leur taille en mètres. */
export const BUSH_MIN = 2;
export const BUSH_MAX = 5;
export const BUSH_RADIUS_M = [0.45, 0.95];

/**
 * Tons de clôture.
 *
 * Le blanc domine, et c'est juste : une clôture de jardin est peinte, et la
 * peinture la moins chère est la blanche. Les autres tons existent, plus rares.
 *
 * Fixes plutôt que thématiques : contrairement au mur ou au volet, une planche
 * de clôture ne suit pas la région — la peinture bon marché est la même
 * partout.
 */
export const FENCE_TONES = [
  srgb('#e9e5da'),
  srgb('#e9e5da'),
  srgb('#dcd4c1'),
  srgb('#b7c1b2'),
  srgb('#8b7659'),
];

/**
 * Vrai si une maison est assez isolée pour mériter un jardin clos.
 *
 * Le test est fait sur le **rectangle de la clôture**, pas sur celui de la
 * maison : ce qui gêne n'est pas qu'une voisine soit proche du mur, c'est
 * qu'elle tombe dans le jardin. Un voisin dont le centre tombe dans le
 * rectangle élargi de la marge de dégagement disqualifie le jardin.
 *
 * Fonction pure.
 *
 * @param {{x:number, z:number, box:Object}} house
 * @param {Array<{x:number, z:number}>} neighbours Toutes les maisons, la
 *        maison testée comprise — elle s'ignore elle-même.
 * @param {number} margin Recul de la clôture, en mètres.
 * @returns {boolean}
 */
export function isDetached(house, neighbours, margin) {
  const { box } = house;
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const long = box.long + margin + GARDEN_CLEAR_M;
  const short = box.short + margin + GARDEN_CLEAR_M;

  for (const other of neighbours) {
    if (other === house) continue;
    const dx = other.x - box.cx;
    const dz = other.z - box.cz;
    // Coordonnées du voisin dans le repère du jardin.
    const u = dx * cos + dz * sin;
    const v = -dx * sin + dz * cos;
    if (Math.abs(u) <= long && Math.abs(v) <= short) return false;
  }
  return true;
}

/**
 * Positions des piquets le long d'un côté, portillon compris.
 *
 * Les piquets sont répartis **régulièrement** entre les deux angles plutôt que
 * posés à pas fixe depuis l'un d'eux : un dernier intervalle bâtard à l'angle
 * est ce qui trahit une clôture engendrée. Le pas réel s'écarte donc un peu du
 * pas demandé, et c'est voulu.
 *
 * Fonction pure.
 *
 * @param {number} length  Longueur du côté, en mètres.
 * @param {number} spacing Écartement souhaité, en mètres.
 * @param {number|null} gate Position du portillon le long du côté, ou `null`.
 * @returns {Array<{along:number, gap:boolean}>} `gap` marque le piquet après
 *          lequel la lisse s'interrompt — c'est l'ouverture du portillon.
 */
export function picketOffsets(length, spacing = PICKET_SPACING_M, gate = null) {
  const count = Math.floor(length / spacing);
  if (count < 2) return [];

  const step = length / count;
  const out = [];
  for (let i = 0; i <= count; i++) {
    const along = i * step;
    if (gate !== null && Math.abs(along - gate) < GATE_WIDTH_M / 2) continue;
    out.push({ along, gap: false });
  }
  // Marquer la trouée : le dernier piquet avant elle ne porte pas de lisse.
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i + 1].along - out[i].along > step * 1.5) out[i].gap = true;
  }
  return out;
}

/** Pas de sondage de la clôture, en mètres, quand on cherche si elle tient. */
export const GARDEN_PROBE_M = 0.5;
/** Reculs essayés, du plus généreux au plus serré, avant de renoncer. */
export const GARDEN_MARGIN_TRIES = 4;

/**
 * Le plus grand recul de clôture qui tienne hors d'un obstacle, ou `null`.
 *
 * Une maison de centre-bourg est parfois à moins de deux mètres du trottoir :
 * son jardin, dessiné au recul tiré, poserait sa clôture au milieu de la
 * chaussée. Plutôt que de la supprimer d'emblée — un village entier sans
 * clôture est un village plus pauvre, pas un village plus juste — on resserre :
 * le recul est essayé de sa valeur tirée jusqu'au minimum de la fourchette, et
 * ce n'est que si même le plus serré ne passe pas qu'il n'y a pas de jardin.
 *
 * `clear(x, z)` dit si un point est libre. La fonction reste donc **pure** et
 * ne connaît pas les routes : c'est l'appelant qui branche l'emprise.
 *
 * @param {Object} box Rectangle orienté de la maison.
 * @param {number} margin Recul tiré, en mètres.
 * @param {Function} clear `(x, z) => boolean`.
 * @param {number} [floor] Recul minimal acceptable, en mètres.
 * @returns {number|null} le recul retenu, ou `null` si aucun ne tient.
 */
export function fittedGardenMargin(box, margin, clear, floor = GARDEN_MARGIN_M[0]) {
  if (typeof clear !== 'function') return margin;

  for (let i = 0; i < GARDEN_MARGIN_TRIES; i++) {
    const tried = margin + ((floor - margin) * i) / (GARDEN_MARGIN_TRIES - 1);
    if (gardenOutlineClear(box, tried, clear)) return tried;
  }
  return null;
}

/**
 * Vrai si toute la clôture d'un jardin tombe sur du terrain libre.
 *
 * Le tracé est sondé, pas seulement ses quatre angles : une rue qui coupe un
 * côté en son milieu laisse les quatre angles au large. Fonction pure.
 */
export function gardenOutlineClear(box, margin, clear, step = GARDEN_PROBE_M) {
  const corners = gardenCorners(box, margin);
  for (let side = 0; side < 4; side++) {
    const a = corners[side];
    const b = corners[(side + 1) % 4];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const count = Math.max(1, Math.ceil(length / Math.max(step, 0.05)));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      if (!clear(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
  }
  return true;
}

/** Les quatre angles du jardin, dans l'ordre du parcours. Fonction pure. */
export function gardenCorners(box, margin) {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const long = box.long + margin;
  const short = box.short + margin;
  const at = (u, v) => ({ x: box.cx + u * cos - v * sin, z: box.cz + u * sin + v * cos });
  return [at(-long, -short), at(long, -short), at(long, short), at(-long, short)];
}

/** Interpolation de deux couleurs linéaires. Fonction pure. */
function blend(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Pousse un panneau vertical dont les deux bouts ne sont pas à la même cote.
 *
 * `pushPanel` suppose un panneau d'aplomb, ce qui est le cas d'un mur et d'un
 * piquet ; ce n'est pas celui d'une lisse, qui relie deux piquets plantés sur
 * une pente et doit la suivre. À l'horizontale, elle sortirait du sol d'un bout
 * et s'y enfoncerait de l'autre au premier dénivelé.
 */
function pushSlopedPanel(buffer, a, b, thickness, nx, nz, color) {
  const corners = [
    [a.x, a.bottom, a.z],
    [b.x, b.bottom + thickness, b.z],
    [b.x, b.bottom, b.z],
    [a.x, a.bottom, a.z],
    [a.x, a.bottom + thickness, a.z],
    [b.x, b.bottom + thickness, b.z],
  ];
  for (const [x, y, z] of corners) {
    buffer.positions.push(x, y, z);
    buffer.normals.push(nx, 0, nz);
    buffer.colors.push(color[0], color[1], color[2]);
  }
}

/** Pousse un triangle et sa normale de face dans un accumulateur. */
function pushTriangle(buffer, a, b, c, color, normal = null) {
  let nx = normal ? normal[0] : 0;
  let ny = normal ? normal[1] : 0;
  let nz = normal ? normal[2] : 0;
  if (!normal) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    nx = uy * vz - uz * vy;
    ny = uz * vx - ux * vz;
    nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-9) return;
    nx /= length;
    ny /= length;
    nz /= length;
  }
  for (const p of [a, b, c]) {
    buffer.positions.push(p[0], p[1], p[2]);
    buffer.normals.push(nx, ny, nz);
    buffer.colors.push(color[0], color[1], color[2]);
  }
}

/**
 * Pousse un buisson : une masse facettée, irrégulière, posée au sol.
 *
 * Deux couronnes et une pointe suffisent — un buisson de jardin fait un mètre,
 * et personne n'en compte les facettes. Ce qui compte est qu'aucun ne soit
 * identique au voisin : les rayons sont bruités par sommet, donc deux buissons
 * de même taille n'ont pas la même silhouette.
 *
 * @param {Object} options
 * @param {Object} [options.colors] Feuillage du thème (`theme.furniture.colors`).
 */
export function appendBush(buffer, { x, y, z, radius, height, seed = 1, sides = 7, colors = defaultTheme.furniture.colors }) {
  const base = blend(colors.leafDeep, colors.leafBlue, randomAt(x, z, seed + 3));
  const crown = blend(colors.leafOlive, colors.leafSpring, randomAt(x, z, seed + 5));

  const ring = (r, h, jitterSalt) => {
    const points = [];
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      const noise = 0.78 + randomAt(x + Math.cos(angle) * r, z + Math.sin(angle) * r, jitterSalt) * 0.44;
      points.push([x + Math.cos(angle) * r * noise, y + h, z + Math.sin(angle) * r * noise]);
    }
    return points;
  };

  const low = ring(radius, height * 0.22, seed + 11);
  const mid = ring(radius * 0.74, height * 0.68, seed + 13);
  const apex = [x, y + height, z];
  const midColor = blend(base, crown, 0.55);

  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    // Le sens de parcours est choisi pour que la normale de face sorte du
    // buisson ; le matériau est de toute façon `DoubleSide`, mais une normale
    // rentrante donnerait un buisson éclairé à contre-jour.
    pushTriangle(buffer, low[i], mid[j], low[j], base);
    pushTriangle(buffer, low[i], mid[i], mid[j], midColor);
    pushTriangle(buffer, mid[i], apex, mid[j], crown);
  }
}

export class GardenLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   * @param {Object} [options.roads] Instance `RoadNetwork`. Un jardin ne
   *        déborde pas sur la rue : sa clôture doit tenir entre la maison et
   *        l'emprise routière, faute de quoi il n'y a pas de jardin.
   * @param {Object} [options.theme] Direction artistique.
   */
  constructor({ THREE, scene, bubble, roads = null, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.roads = roads;
    this.disposed = false;
    this.mesh = null;
    this.geometry = null;
    this.count = 0;

    // `DoubleSide` : une planche de clôture n'a pas d'épaisseur, et un buisson
    // dont on voit l'intérieur par une facette mal orientée est pire qu'un
    // buisson à deux faces.
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    this.material.name = 'gardens';
  }

  /**
   * Refait les jardins à partir des maisons publiées par `buildingLayer`.
   *
   * @param {Array} houses Maisons, avec leur rectangle orienté et leur assise.
   * @param {{x:number, z:number}} here Position locale du coureur.
   * @param {Object|null} [pavement] Bande revêtue publiée par `streetLayer` :
   *        une clôture ne traverse pas un trottoir.
   * @returns {boolean} vrai si des jardins ont été posés.
   */
  rebuild(houses, here, pavement = null) {
    if (this.disposed || !this.bubble?.frame) return false;

    const buffer = { positions: [], normals: [], colors: [] };
    let built = 0;

    // Les plus proches d'abord : si le plafond mord, ce qui saute est au bord
    // de la portée, là où une clôture ne fait déjà plus qu'un trait.
    const near = (houses || [])
      .map((house) => ({ house, distance: Math.hypot(house.x - here.x, house.z - here.z) }))
      .filter((entry) => entry.distance <= GARDEN_RADIUS_M)
      .sort((a, b) => a.distance - b.distance);

    const neighbours = houses || [];
    // L'emprise routière, posée une fois pour toute la reconstruction. Les
    // jardins ne lisent pas le réseau : ils ne posent qu'une question, « ce
    // point est-il libre ».
    const index = this.roads?.index || null;
    // Le trottoir compte autant que la chaussée : une clôture qui traverse le
    // passage est le même défaut, et c'est la clôture qui cède, jamais la rue.
    const clear = (x, z) => !inCorridor(index, x, z) && !pavement?.covers(x, z, 0);

    for (const { house } of near) {
      if (built >= GARDEN_MAX) break;
      if (randomAt(house.x, house.z, 211) >= GARDEN_SHARE) continue;

      const drawn =
        GARDEN_MARGIN_M[0] + randomAt(house.x, house.z, 217) * (GARDEN_MARGIN_M[1] - GARDEN_MARGIN_M[0]);
      // La clôture doit tenir entre la maison et la rue. Resserrée si besoin,
      // abandonnée si même le recul minimal mord sur la voirie : un jardin qui
      // déborde sur la rue est pire que pas de jardin du tout. Le rabattement
      // passe **avant** le test de voisinage : c'est le recul réellement posé
      // qui doit tenir libre, pas celui qu'on avait tiré.
      const margin = fittedGardenMargin(house.box, drawn, clear);
      if (margin == null) continue;
      if (!isDetached(house, neighbours, margin)) continue;

      this._appendGarden(buffer, house, margin);
      built++;
    }

    this.count = built;
    this._apply(buffer);
    return built > 0;
  }

  /** Un jardin : sa clôture, son portillon, ses buissons. */
  _appendGarden(buffer, house, margin) {
    const { bubble } = this;
    const ground = (x, z) => bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;
    const tone = FENCE_TONES[Math.floor(randomAt(house.x, house.z, 223) * FENCE_TONES.length)];
    // La lisse est un peu plus sombre que les planches : elle est derrière.
    const railTone = tone.map((c) => c * 0.88);

    const corners = gardenCorners(house.box, margin);
    // Le portillon est sur **un** côté, tiré une fois pour tout le jardin : une
    // clôture percée aux quatre côtés n'est plus une clôture.
    const gateSide = Math.floor(randomAt(house.x, house.z, 229) * 4);

    for (let side = 0; side < 4; side++) {
      const a = corners[side];
      const b = corners[(side + 1) % 4];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < GATE_WIDTH_M * 2) continue;

      const ux = dx / length;
      const uz = dz / length;
      // Normale du côté : elle sert à orienter la planche, qui est dans le plan
      // de la clôture, donc sa normale est perpendiculaire au côté.
      const nx = uz;
      const nz = -ux;

      const gate =
        side === gateSide
          ? GATE_WIDTH_M + randomAt(a.x, a.z, 233) * Math.max(0, length - GATE_WIDTH_M * 2)
          : null;

      const pickets = picketOffsets(length, PICKET_SPACING_M, gate);
      let previous = null;
      for (const picket of pickets) {
        const px = a.x + ux * picket.along;
        const pz = a.z + uz * picket.along;
        const foot = ground(px, pz) - PICKET_SINK_M;
        this._appendPicket(buffer, { px, pz, ux, uz, nx, nz, foot, tone });

        // La lisse relie deux piquets voisins en suivant le sol : à l'horizontale
        // elle flotterait dès la moindre pente, et une clôture qui flotte est
        // exactement ce qui trahit un décor plaqué.
        if (previous && !previous.gap) {
          pushSlopedPanel(
            buffer,
            { x: previous.x, z: previous.z, bottom: previous.foot + RAIL_Y_M },
            { x: px, z: pz, bottom: foot + RAIL_Y_M },
            RAIL_HEIGHT_M,
            nx,
            nz,
            railTone
          );
        }
        previous = { x: px, z: pz, foot, gap: picket.gap };
      }
    }

    this._appendBushes(buffer, house, margin);
  }

  /** Une planche : un rectangle et sa pointe. */
  _appendPicket(buffer, { px, pz, ux, uz, nx, nz, foot, tone }) {
    const half = PICKET_WIDTH_M / 2;
    const left = { x: px - ux * half, y: pz - uz * half };
    const right = { x: px + ux * half, y: pz + uz * half };
    const top = foot + PICKET_HEIGHT_M;
    pushPanel(buffer, left, right, foot, top, nx, nz, tone, tone);
    pushTriangle(
      buffer,
      [left.x, top, left.y],
      [px, top + PICKET_CAP_M, pz],
      [right.x, top, right.y],
      tone,
      [nx, 0, nz]
    );
  }

  /**
   * Les buissons du jardin.
   *
   * Ils ne sont pas semés au hasard dans l'enclos : ils sont posés **le long de
   * la clôture**, en retrait des angles, ce qui est là où on les plante. Semés
   * en vrac, ils tomberaient au milieu de la pelouse et contre la maison.
   */
  _appendBushes(buffer, house, margin) {
    const { bubble } = this;
    const ground = (x, z) => bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale;
    const { box } = house;
    const cos = Math.cos(box.angle);
    const sin = Math.sin(box.angle);
    const long = box.long + margin;
    const short = box.short + margin;
    const inset = 1.1;

    // Huit emplacements : les quatre angles et les quatre milieux de côté, tous
    // en retrait de la clôture.
    const spots = [
      [-(long - inset), -(short - inset)],
      [long - inset, -(short - inset)],
      [long - inset, short - inset],
      [-(long - inset), short - inset],
      [0, -(short - inset)],
      [0, short - inset],
      [-(long - inset), 0],
      [long - inset, 0],
    ];

    const wanted = BUSH_MIN + Math.floor(randomAt(house.x, house.z, 239) * (BUSH_MAX - BUSH_MIN + 1));
    let placed = 0;
    for (let i = 0; i < spots.length && placed < wanted; i++) {
      const [u, v] = spots[i];
      // Rien contre le mur : l'emplacement doit être hors de l'emprise bâtie.
      if (Math.abs(u) < box.long + 0.9 && Math.abs(v) < box.short + 0.9) continue;

      const x = box.cx + u * cos - v * sin;
      const z = box.cz + u * sin + v * cos;
      if (randomAt(x, z, 241) < 0.25) continue;
      // La clôture, elle, a déjà été ajustée à l'emprise ; le buisson est en
      // retrait d'un mètre, mais un angle de jardin peut encore mordre sur un
      // trottoir en biais. Le test coûte une lecture d'index.
      if (inCorridor(this.roads?.index || null, x, z)) continue;

      const radius =
        BUSH_RADIUS_M[0] + randomAt(x, z, 251) * (BUSH_RADIUS_M[1] - BUSH_RADIUS_M[0]);
      appendBush(buffer, {
        x,
        y: ground(x, z) - 0.1,
        z,
        radius,
        height: radius * (1.15 + randomAt(x, z, 257) * 0.7),
        seed: 260 + i,
        colors: this.theme.furniture.colors,
      });
      placed++;
    }
  }

  /** (Ré)alimente le maillage fusionné. */
  _apply(buffer) {
    const { THREE } = this;
    if (buffer.positions.length === 0) {
      this._clearMesh();
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffer.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffer.colors, 3));
    geometry.computeBoundingSphere();

    if (this.mesh) {
      this.geometry.dispose();
      this.mesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = 'gardens';
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      this.scene.add(mesh);
      this.mesh = mesh;
    }
    this.geometry = geometry;
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
    this.material.dispose();
  }
}
