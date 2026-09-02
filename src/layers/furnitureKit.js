/*
 * furnitureKit — le mobilier, modelé en code.
 * -------------------------------------------
 * Un catalogue de petits volumes : lampadaire, poteau, pylône, antenne relais,
 * éolienne, phare, panneau, borne, abribus, botte de foin, tas de bois,
 * fontaine, lavoir, grange, silo, hangar, serre, moulin à vent, moulin à eau,
 * château d'eau, piquets de clôture, bosquet, feu tricolore — les édifices
 * urbains (église, mosquée, hôpital, commerce, monument, château, tour,
 * cimetière, cheminée d'usine, grande roue, stade) — et ce qui donne de la vie
 * au décor : vaches, moutons, chèvres, chevaux, poules, fil à linge.
 *
 * **Pourquoi pas des modèles importés.** C'est la question qui se pose en
 * premier, et elle mérite une réponse écrite. Trois raisons, dans l'ordre où
 * elles pèsent :
 *
 * 1. *L'échelle de la scène.* Ce décor est vu depuis une caméra de poursuite à
 *    seize mètres, en mouvement, sur un terrain photographique. À cette
 *    distance, la silhouette et la couleur font tout le travail ; les arêtes
 *    biseautées d'un modèle soigné ne se voient pas. Le même raisonnement a
 *    déjà décidé de la forme des arbres (`vegetationLayer`).
 * 2. *Le nombre.* Un kilomètre de départementale, ce sont des centaines de
 *    piquets et de bornes. Ce qui compte n'est pas le coût d'un objet mais
 *    celui de mille, donc l'instanciation — et une géométrie unique, partagée,
 *    est ce qui l'autorise.
 * 3. *Le poids.* three.js pèse déjà 190 Ko compressés qu'on prend soin de
 *    charger à la demande. Un lot de modèles glTF pour quinze objets, plus le
 *    `GLTFLoader`, doublerait le coût d'entrée du mode cinéma pour un gain
 *    invisible à seize mètres.
 *
 * Tout est donc bâti à partir de trois primitives — boîte, cylindre, plan —
 * assemblées par `Kit`, en triangles non indexés et à facettes franches. Les
 * facettes ne sont pas un pis-aller : sur des volumes de cette taille, elles
 * accrochent la lumière et donnent la lecture du volume mieux qu'un lissage.
 *
 * Repère de chaque objet : origine **au pied**, +Y vers le haut, +Z vers
 * l'avant, mètres réels. La couche de placement n'a donc qu'à poser et
 * pivoter.
 */

import { srgb } from '../core/color.js';
import { defaultTheme } from '../themes/default.js';

/** Nuancier de repli : appeler une pièce du catalogue sans thème reste légal. */
const DEFAULT_COLORS = defaultTheme.furniture.colors;

/** Revers gris des panneaux de signalisation, quand rien n'est précisé. */

/** Nom de l'attribut de sommet qui marque les pales d'éolienne. */
export const ROTOR_SPIN_ATTRIBUTE = 'aSpin';

/**
 * Hauteur du moyeu de l'éolienne, en mètres — aussi le pivot de rotation des
 * pales (voir `createFurnitureRotorMaterial`). Exportée pour que les deux
 * restent d'accord sans qu'on recopie la valeur.
 */
export const WIND_TURBINE_HUB_M = 78;

/**
 * Suite déterministe dans [0, 1[, pour les formes irrégulières du catalogue.
 *
 * Elle n'a rien à voir avec les tirages de placement (`furniturePlacement`) :
 * ici la graine est **fixée par la pièce**, donc toutes les instances d'un même
 * rocher partagent exactement la même silhouette. C'est ce qui permet de garder
 * une géométrie unique et de ne varier que l'échelle et la rotation.
 */
function seededUnit(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Contour régulier à `sides` côtés, dans le plan (x, y).
 *
 * C'est ce qui donne aux panneaux leur silhouette : `sides = 8` avec un
 * huitième de tour de déphasage fait l'octogone d'un stop, `4` fait le losange
 * de la priorité, `12` fait un disque. Fonction pure.
 */
export function polygonPoints(radius, sides = 12, phase = 0) {
  const out = [];
  for (let i = 0; i < sides; i++) {
    const angle = phase + (i / sides) * Math.PI * 2;
    out.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return out;
}

/** Assembleur de volumes : triangles non indexés, normales par face. */
export class Kit {
  /**
   * @param {Object} [palette] Nuancier du thème. Il ne sert qu'au revers des
   *        panneaux, la seule couleur que `Kit` choisit lui-même.
   */
  constructor(palette = defaultTheme.furniture.colors) {
    this.palette = palette;
    this.positions = [];
    this.normals = [];
    this.colors = [];
    // Un flag par sommet, 1 pour ce qui doit tourner (les pales d'éolienne),
    // 0 pour tout le reste. Nul pour la quasi-totalité du catalogue : porté
    // dans `toGeometry` seulement quand une pièce s'en sert vraiment, pour ne
    // pas alourdir chaque poteau d'un attribut qui ne lui sert à rien.
    this.spins = [];
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  /**
   * Transforme un point local par roulis (Z), tangage (X), lacet (Y), puis
   * translation — dans cet ordre. Trois rotations suffisent à poser toutes les
   * pièces du catalogue, pales d'éolienne comprises.
   */
  static transform([x, y, z], t) {
    const { roll = 0, tilt = 0, yaw = 0, x: tx = 0, y: ty = 0, z: tz = 0 } = t || {};

    if (roll) {
      const c = Math.cos(roll);
      const s = Math.sin(roll);
      [x, y] = [x * c - y * s, x * s + y * c];
    }
    if (tilt) {
      const c = Math.cos(tilt);
      const s = Math.sin(tilt);
      [y, z] = [y * c - z * s, y * s + z * c];
    }
    if (yaw) {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      [x, z] = [x * c + z * s, -x * s + z * c];
    }
    return [x + tx, y + ty, z + tz];
  }

  /**
   * Triangle, normale déduite du sens de parcours.
   * @param {number} [spin] 1 si ce triangle doit tourner autour du moyeu
   *        (voir `windTurbine`), 0 sinon.
   */
  tri(a, b, c, color, spin = 0) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;

    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx, ny, nz);
      this.colors.push(color[0], color[1], color[2]);
      this.spins.push(spin);
    }
    return this;
  }

  quad(a, b, c, d, color, spin = 0) {
    return this.tri(a, b, c, color, spin).tri(a, c, d, color, spin);
  }

  /**
   * Boîte centrée en (0, h/2, 0) avant transformation : une boîte posée à
   * `y = 0` repose donc sur le sol, ce qui est le cas usuel.
   */
  box({ width, height, depth, color, spin = 0, ...t }) {
    const hw = width / 2;
    const hd = depth / 2;
    const p = (x, y, z) => Kit.transform([x, y, z], t);

    const a = p(-hw, 0, -hd);
    const b = p(hw, 0, -hd);
    const c = p(hw, 0, hd);
    const d = p(-hw, 0, hd);
    const e = p(-hw, height, -hd);
    const f = p(hw, height, -hd);
    const g = p(hw, height, hd);
    const h = p(-hw, height, hd);

    this.quad(d, c, g, h, color, spin); // +z
    this.quad(b, a, e, f, color, spin); // -z
    this.quad(c, b, f, g, color, spin); // +x
    this.quad(a, d, h, e, color, spin); // -x
    this.quad(h, g, f, e, color, spin); // dessus
    this.quad(a, b, c, d, color, spin); // dessous
    return this;
  }

  /**
   * Cylindre (ou cône, ou tronc de cône) d'axe Y, base à `y = 0`.
   * @param {number} [options.radial] Segments — 6 suffit pour un poteau vu de
   *        loin, 12 pour une tour d'éolienne dont la silhouette compte.
   */
  cylinder({ radiusTop, radiusBottom, height, radial = 8, color, colorTop, cap = true, ...t }) {
    const top = colorTop || color;
    const p = (x, y, z) => Kit.transform([x, y, z], t);
    const ring = (radius, y) => {
      const out = [];
      for (let i = 0; i < radial; i++) {
        const angle = (i / radial) * Math.PI * 2;
        out.push(p(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
      }
      return out;
    };

    const lower = ring(radiusBottom, 0);
    const upper = ring(radiusTop, height);

    for (let i = 0; i < radial; i++) {
      const j = (i + 1) % radial;
      if (radiusTop <= 1e-6) this.tri(lower[i], lower[j], upper[i], color);
      else if (radiusBottom <= 1e-6) this.tri(lower[i], upper[j], upper[i], color);
      else this.quad(lower[i], lower[j], upper[j], upper[i], color);
    }

    if (cap && radiusTop > 1e-6) {
      const centre = p(0, height, 0);
      for (let i = 0; i < radial; i++) this.tri(centre, upper[i], upper[(i + 1) % radial], top);
    }
    if (cap && radiusBottom > 1e-6) {
      const centre = p(0, 0, 0);
      for (let i = 0; i < radial; i++) this.tri(centre, lower[(i + 1) % radial], lower[i], color);
    }
    return this;
  }

  /** Toit à deux pentes posé sur une emprise `width × depth`, faîtage sur X. */
  gableRoof({ width, depth, height, overhang = 0.3, color, gableColor, ...t }) {
    const hw = width / 2 + overhang;
    const hd = depth / 2 + overhang;
    const p = (x, y, z) => Kit.transform([x, y, z], t);

    const a = p(-hw, 0, -hd);
    const b = p(hw, 0, -hd);
    const c = p(hw, 0, hd);
    const d = p(-hw, 0, hd);
    const ridgeA = p(-hw, height, 0);
    const ridgeB = p(hw, height, 0);

    this.quad(d, c, ridgeB, ridgeA, color);
    this.quad(b, a, ridgeA, ridgeB, color);
    this.tri(a, d, ridgeA, gableColor || color);
    this.tri(c, b, ridgeB, gableColor || color);
    return this;
  }

  /** Toit en berceau (hangar agricole) : une voûte approchée par facettes. */
  barrelRoof({ width, depth, rise, segments = 7, color, ...t }) {
    const hd = depth / 2;
    const p = (x, y, z) => Kit.transform([x, y, z], t);
    const arc = (i) => {
      const angle = (i / segments) * Math.PI;
      return { x: -Math.cos(angle) * (width / 2), y: Math.sin(angle) * rise };
    };

    for (let i = 0; i < segments; i++) {
      const s = arc(i);
      const e = arc(i + 1);
      this.quad(
        p(s.x, s.y, hd),
        p(e.x, e.y, hd),
        p(e.x, e.y, -hd),
        p(s.x, s.y, -hd),
        color
      );
    }
    return this;
  }

  /**
   * Polygone plat décrit dans le plan (x, y) et regardant +Z, en éventail.
   *
   * C'est la brique de toute la signalisation : un panneau est une face, pas un
   * volume. Deux faces dos à dos — l'une colorée, l'autre grise — suffisent, et
   * l'épaisseur d'un panneau routier ne se voit pas à trente mètres.
   *
   * @param {Array<number[]>} points Sommets `[x, y]`, dans le sens direct.
   * @param {number} [options.plane] Cote du plan dans le repère local, avant
   *        transformation — à ne pas confondre avec `z`, qui translate.
   */
  face(points, color, { plane = 0, ...t } = {}) {
    if (!points || points.length < 3) return this;
    const p = (i) => Kit.transform([points[i][0], points[i][1], plane], t);
    const first = p(0);
    for (let i = 1; i < points.length - 1; i++) this.tri(first, p(i), p(i + 1), color);
    return this;
  }

  /**
   * Panneau plat : une face colorée vers +Z, une face de revers vers -Z.
   * Le revers n'est pas décoratif — un panneau vu de dos est gris, et sans lui
   * la face avant se lirait des deux côtés.
   */
  panel({ points, color, back = null, thickness = 0.05, plane = 0, ...t }) {
    const half = thickness / 2;
    this.face(points, color, { ...t, plane: plane + half });
    this.face(points.slice().reverse(), back || this.palette.signGrey, { ...t, plane: plane - half });
    return this;
  }

  /**
   * Tronçon droit entre deux points du plan (y, z), à x constant.
   *
   * Sert aux pièces cintrées — la crosse d'un lampadaire — où chaque tronçon
   * doit partir **exactement** du bout du précédent. Les poser à des altitudes
   * choisies à la main laissait des trous qui se voient d'en dessous.
   */
  strutYZ({ from, to, width = 0.09, depth = null, color }) {
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dy, dz);
    if (length <= 1e-6) return this;
    return this.box({
      width,
      depth: depth ?? width,
      height: length,
      y: from.y,
      z: from.z,
      tilt: Math.atan2(dz, dy),
      color,
    });
  }

  /**
   * Bloc rocheux facetté : une demi-sphère irrégulière, tirée d'une graine.
   *
   * Un caillou lissé n'est pas un caillou : ce sont les facettes franches et
   * l'irrégularité du contour qui le font lire. Toutes les instances d'une même
   * pierre partagent cette forme ; c'est la rotation et l'échelle qui les
   * distinguent.
   */
  rock({ radius = 0.5, height = 0.6, sides = 7, rings = 2, seed = 1, color, colorTop, ...t }) {
    const random = seededUnit(seed);
    const top = colorTop || color;
    const p = (x, y, z) => Kit.transform([x, y, z], t);

    // Rayons et altitudes bruités, une fois par sommet : le même sommet doit
    // être partagé par les faces voisines, sinon le volume se fend.
    const grid = [];
    for (let r = 0; r <= rings; r++) {
      // Le dernier anneau s'arrête avant le pôle : poussé jusqu'à 1, son rayon
      // serait nul et il se confondrait avec la pointe, ce qui produit un
      // bouquet de triangles dégénérés au sommet de chaque bloc.
      const v = (r / rings) * 0.82;
      const row = [];
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const shrink = Math.cos((v * Math.PI) / 2);
        const jitter = 0.72 + random() * 0.56;
        const rr = radius * shrink * jitter;
        row.push(p(Math.cos(angle) * rr, height * Math.sin((v * Math.PI) / 2) * (0.8 + random() * 0.4), Math.sin(angle) * rr));
      }
      grid.push(row);
    }
    const apex = p(0, height, 0);

    for (let r = 0; r < rings; r++) {
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        const shade = r === rings - 1 ? top : color;
        this.quad(grid[r][i], grid[r][j], grid[r + 1][j], grid[r + 1][i], shade);
      }
    }
    for (let i = 0; i < sides; i++) {
      this.tri(grid[rings][i], grid[rings][(i + 1) % sides], apex, top);
    }
    return this;
  }

  toGeometry(THREE, name = 'furniture') {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    // Seules les pièces qui en posent (l'éolienne, aujourd'hui) portent
    // l'attribut : le reste du catalogue n'a rien à tourner.
    if (this.spins.some((v) => v !== 0)) {
      geometry.setAttribute(ROTOR_SPIN_ATTRIBUTE, new THREE.Float32BufferAttribute(this.spins, 1));
    }
    geometry.computeBoundingSphere();
    geometry.name = name;
    return geometry;
  }
}


/**
 * Géométrie de la crosse d'un lampadaire : fût droit, puis quart de cercle.
 * `sweep` est la part du quart de tour réellement parcourue — à 1, la crosse
 * finirait rigoureusement horizontale, ce qu'aucun mât ne fait.
 */
export const LAMP_ARC = { shaft: 7.2, radius: 1.35, sweep: 0.92, lantern: 0.3 };

/**
 * Point de la crosse au paramètre `t` ∈ [0, 1], dans le plan (y, z).
 * Fonction pure : c'est elle qui garantit que les tronçons se touchent et que
 * la tête est là où la couche de mobilier croit qu'elle est.
 */
export function lampArcAt(t) {
  const angle = t * (Math.PI / 2) * LAMP_ARC.sweep;
  return {
    y: LAMP_ARC.shaft + Math.sin(angle) * LAMP_ARC.radius,
    z: (1 - Math.cos(angle)) * LAMP_ARC.radius,
  };
}

/**
 * Le catalogue. Chaque entrée bâtit un `Kit` ; l'appelant le convertit une
 * seule fois en géométrie partagée par toutes les instances.
 *
 * L'ordre suit celui de la scène : ce qui borde la route, puis ce qui occupe
 * les champs, puis ce qui tient l'horizon.
 */
export const FURNITURE_BUILDERS = {
  /**
   * Lampadaire routier : mât droit, crosse cintrée, lanterne inclinée.
   *
   * ## La crosse
   *
   * Elle était faite de trois tronçons posés à des cotes choisies à la main, et
   * ils ne se touchaient pas : le deuxième repartait quarante centimètres sous
   * le bout du premier, et la lanterne flottait à côté du troisième. Vue d'en
   * dessous — c'est-à-dire depuis la selle, le seul point de vue qui existe —
   * la crosse ressemblait à trois bâtons jetés en l'air.
   *
   * Elle est donc maintenant **échantillonnée sur un quart de cercle** : chaque
   * tronçon part exactement du bout du précédent (`strutYZ`), et la lanterne se
   * pose au dernier point calculé. `LAMP_ARC` fixe la géométrie, et
   * `LAMP_HEAD_HEIGHT_M` / `LAMP_HEAD_REACH_M` en découlent — la couche de
   * mobilier y accroche le halo et la nappe de lumière au sol.
   */
  streetLamp(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.26, radiusTop: 0.2, height: 0.4, radial: 8, color: C.steelDark });
    k.cylinder({ radiusBottom: 0.15, radiusTop: 0.085, height: LAMP_ARC.shaft, radial: 8, color: C.steel });

    const steps = 5;
    for (let i = 0; i < steps; i++) {
      k.strutYZ({
        from: lampArcAt(i / steps),
        to: lampArcAt((i + 1) / steps),
        width: 0.095,
        color: C.steel,
      });
    }

    // Lanterne : un capot sombre et une vasque claire dessous, penchés vers la
    // chaussée. C'est la vasque qu'on voit d'en bas, et elle doit être claire.
    const head = lampArcAt(1);
    const z = head.z + LAMP_ARC.lantern;
    k.box({ width: 0.36, height: 0.14, depth: 0.82, y: head.y - 0.07, z, tilt: 0.14, color: C.steelDark });
    k.box({ width: 0.31, height: 0.05, depth: 0.7, y: head.y - 0.16, z, tilt: 0.14, color: C.lamp });
    return k;
  },

  /** Poteau électrique en bois, une traverse et ses isolateurs. */
  utilityPole(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.17, radiusTop: 0.12, height: 9, radial: 6, color: C.wood });
    k.box({ width: 2.2, height: 0.12, depth: 0.14, y: 8.35, color: C.wood });
    for (const x of [-0.95, 0, 0.95]) {
      k.cylinder({ radiusBottom: 0.08, radiusTop: 0.06, height: 0.22, radial: 5, x, y: 8.47, color: C.white });
    }
    return k;
  },

  /**
   * Pylône de ligne haute tension : quatre montants qui se resserrent, une
   * taille, deux consoles. Le treillis n'est pas modelé maille par maille —
   * à huit cents mètres il ne resterait qu'un gris moyen ; les diagonales, si.
   */
  pylon(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const height = 42;
    const spread = (t) => 3.6 - t * 2.4; // demi-emprise au fil de la montée

    const legs = 5;
    for (let s = 0; s < legs; s++) {
      const t0 = s / legs;
      const t1 = (s + 1) / legs;
      const y0 = t0 * height * 0.78;
      const y1 = t1 * height * 0.78;
      const r0 = spread(t0);
      const r1 = spread(t1);

      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const dx = (r1 - r0) * sx;
        const dz = (r1 - r0) * sz;
        const run = Math.hypot(dx, y1 - y0, dz);
        k.box({
          width: 0.22,
          height: run,
          depth: 0.22,
          x: r0 * sx + dx / 2,
          y: y0,
          z: r0 * sz + dz / 2,
          tilt: Math.atan2(dz, y1 - y0),
          roll: -Math.atan2(dx, y1 - y0),
          color: C.steelDark,
        });
      }
      // Une diagonale par étage : c'est elle qui fait lire « treillis ».
      k.box({
        width: r0 * 2.2,
        height: 0.14,
        depth: 0.14,
        y: y0 + (y1 - y0) / 2,
        z: -r0,
        roll: Math.atan2(y1 - y0, r0 * 2.2),
        color: C.steelDark,
      });
    }

    // Fût supérieur et consoles porteuses.
    k.box({ width: 1.6, height: height * 0.24, depth: 1.6, y: height * 0.78, color: C.steelDark });
    for (const [y, span] of [[height * 0.8, 9], [height * 0.93, 7]]) {
      k.box({ width: span, height: 0.2, depth: 0.2, y, color: C.steelDark });
      for (const x of [-span / 2, 0, span / 2]) {
        k.cylinder({ radiusBottom: 0.1, radiusTop: 0.1, height: 0.9, radial: 4, x, y: y - 0.9, color: C.slate });
      }
    }
    return k;
  },

  /**
   * Antenne relais : mât treillis à trois montants, deux paraboles, feu de
   * balisage. Elle se distingue du pylône électrique (`pylon`) par sa
   * silhouette — plus fin, plus haut, sans consoles porteuses — parce qu'elle
   * ne porte pas de ligne : c'est un relais, posé au sommet pour l'antenne,
   * pas pour ce qu'il transporte.
   *
   * Les traverses horizontales ne passent pas par `Kit.box` avec un couple
   * roulis/tangage : ce sont des segments **horizontaux** entre deux montants
   * disposés en cercle, une géométrie que ni `strutYZ` (plan (y, z) à x fixe)
   * ni la diagonale du pylône (un seul axe) ne couvrent. `ring` ci-dessous
   * calcule directement le cap qui pose l'axe « hauteur » de la boîte à
   * l'horizontale, dans la direction voulue.
   */
  radioMast(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const height = 40;
    const legs = 3;
    const stages = 7;
    const spread = (t) => 1.7 - t * 1.25; // rayon de la triangulation au fil de la montée

    /** Barre horizontale entre deux points du plan (x, z), à `y` fixe. */
    const ring = (x0, z0, x1, z1, y, color) => {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const run = Math.hypot(dx, dz);
      if (run <= 1e-6) return;
      k.box({
        width: 0.08,
        height: run,
        depth: 0.08,
        x: (x0 + x1) / 2,
        y,
        z: (z0 + z1) / 2,
        tilt: Math.PI / 2,
        yaw: Math.atan2(dx, dz),
        color,
      });
    };

    for (let s = 0; s < stages; s++) {
      const t0 = s / stages;
      const t1 = (s + 1) / stages;
      const y0 = t0 * height;
      const y1 = t1 * height;
      const r0 = spread(t0);
      const r1 = spread(t1);
      const points0 = [];
      const points1 = [];

      for (let leg = 0; leg < legs; leg++) {
        const angle = (leg / legs) * Math.PI * 2;
        const x0 = Math.cos(angle) * r0;
        const z0 = Math.sin(angle) * r0;
        const x1 = Math.cos(angle) * r1;
        const z1 = Math.sin(angle) * r1;
        points0.push([x0, z0]);
        points1.push([x1, z1]);
        const dx = x1 - x0;
        const dz = z1 - z0;
        const run = Math.hypot(dx, y1 - y0, dz);
        k.box({
          width: 0.1,
          height: run,
          depth: 0.1,
          x: x0 + dx / 2,
          y: y0,
          z: z0 + dz / 2,
          tilt: Math.atan2(dz, y1 - y0),
          roll: -Math.atan2(dx, y1 - y0),
          color: C.galvanised,
        });
      }
      // Un cerclage tous les deux étages : c'est lui qui lit « treillis »
      // plutôt qu'un trépied posé là.
      if (s % 2 === 1) {
        for (let leg = 0; leg < legs; leg++) {
          const [x0, z0] = points1[leg];
          const [x1, z1] = points1[(leg + 1) % legs];
          ring(x0, z0, x1, z1, y1, C.steelDark);
        }
      }
    }

    // Deux paraboles, à des hauteurs et des orientations différentes : deux
    // relais qui pointent le même point du ciel est le genre de détail qui
    // trahit un décor procédural une fois remarqué.
    for (const [y, facing, r] of [[height * 0.55, 0.6, 0.55], [height * 0.72, 2.3, 0.4]]) {
      k.cylinder({
        radiusBottom: r,
        radiusTop: r,
        height: 0.16,
        radial: 10,
        y,
        x: Math.sin(facing) * (spread(y / height) + 0.1),
        z: Math.cos(facing) * (spread(y / height) + 0.1),
        yaw: facing,
        tilt: Math.PI / 2,
        color: C.white,
        colorTop: C.steelDark,
      });
    }

    // Fouets d'antenne et feu de balisage, au sommet.
    for (const angle of [0.4, 2.6]) {
      k.cylinder({
        radiusBottom: 0.025,
        radiusTop: 0.01,
        height: 2.4,
        radial: 4,
        x: Math.cos(angle) * 0.15,
        y: height,
        z: Math.sin(angle) * 0.15,
        color: C.galvanised,
      });
    }
    k.box({ width: 0.22, height: 0.22, depth: 0.22, y: height + 2.3, color: C.signRed });
    return k;
  },

  /**
   * Éolienne : tour effilée, nacelle, trois pales.
   *
   * Les pales portent `spin: 1` : c'est le flag que `createFurnitureRotorMaterial`
   * lit pour les faire tourner autour du moyeu, en `(0, WIND_TURBINE_HUB_M)`
   * dans le repère local — voir l'en-tête de ce module pour le pourquoi du
   * pivot. Rien d'autre dans la pièce ne porte ce flag : le mât et la nacelle
   * restent immobiles.
   */
  windTurbine(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const hub = WIND_TURBINE_HUB_M;
    k.cylinder({ radiusBottom: 2.2, radiusTop: 1.1, height: hub, radial: 12, color: C.white });
    k.box({ width: 3, height: 3, depth: 9, y: hub - 1.5, color: C.white });
    k.cylinder({ radiusBottom: 1.1, radiusTop: 0.6, height: 1.4, radial: 8, y: hub, z: -5.4, tilt: -Math.PI / 2, color: C.white });

    // Trois pales de 38 m, vrillées d'un tiers de tour l'une de l'autre autour
    // de l'axe du rotor — lequel est horizontal, d'où le roulis puis le tangage.
    for (let i = 0; i < 3; i++) {
      const roll = (i / 3) * Math.PI * 2;
      k.box({
        width: 1.9,
        height: 38,
        depth: 0.5,
        y: hub,
        z: -6,
        roll,
        color: C.white,
        spin: 1,
      });
    }
    return k;
  },

  /**
   * Phare : tour tronconique, bande rouge de repère diurne, galerie,
   * chambre de la lanterne vitrée sous son dôme.
   *
   * La bande rouge n'est pas décorative — c'est elle qui distingue un phare
   * d'un silo depuis le large, où la silhouette seule (un cylindre effilé)
   * ne suffirait pas à trancher.
   */
  lighthouse(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const height = 20;
    k.cylinder({ radiusBottom: 2.3, radiusTop: 1.7, height, radial: 10, color: C.white });
    k.cylinder({
      radiusBottom: 2.06,
      radiusTop: 1.86,
      height: height * 0.16,
      radial: 10,
      y: height * 0.42,
      color: C.signRed,
    });
    // Galerie : le rebord qui porte la chambre de la lanterne.
    k.cylinder({ radiusBottom: 2, radiusTop: 2, height: 0.35, radial: 10, y: height, color: C.steelDark });
    // Chambre de la lanterne : verrière sombre, dôme, épi de faîtage.
    k.cylinder({
      radiusBottom: 1.3,
      radiusTop: 1.3,
      height: 2.4,
      radial: 8,
      y: height + 0.35,
      color: C.black,
      colorTop: C.slate,
      cap: false,
    });
    k.cylinder({ radiusBottom: 1.3, radiusTop: 0.05, height: 1.1, radial: 8, y: height + 2.75, color: C.steelDark });
    return k;
  },

  /** Glissière de sécurité : le poteau seul, la lisse est un profil balayé. */
  guardrailPost(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 0.12, height: 0.78, depth: 0.14, color: C.galvanised });
    return k;
  },

  /**
   * ## La signalisation
   *
   * Onze panneaux, et la raison d'en avoir onze plutôt qu'un : un bord de route
   * qui ne porte qu'un seul type de panneau se lit comme un motif répété au bout
   * de trois occurrences. La diversité y coûte moins cher que partout ailleurs —
   * un panneau est une **face** (`Kit.panel`), pas un volume, donc une dizaine de
   * triangles pièce.
   *
   * Aucun texte : à la distance où la caméra les prend, un chiffre est illisible
   * et un texte plaqué ferait plus faux que son absence. Ce qui identifie un
   * panneau est sa **silhouette** et sa **couleur** — le triangle du danger,
   * l'octogone rouge du stop, le losange jaune de la priorité —, et ces deux-là
   * suffisent à les distinguer.
   */

  /** Danger : triangle pointe en haut, bordure rouge. */
  signWarning(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.05, radiusTop: 0.05, height: 2.2, radial: 6, color: C.galvanised });
    const outer = [[0, 0.86], [-0.5, 0], [0.5, 0]];
    const inner = [[0, 0.62], [-0.36, 0.08], [0.36, 0.08]];
    k.panel({ points: outer, color: C.signRed, y: 2.15 });
    k.face(inner, C.signWhite, { y: 2.15, plane: 0.035 });
    return k;
  },

  /** Stop : octogone rouge, barre blanche. Aucun autre panneau n'a cette forme. */
  signStop(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.05, radiusTop: 0.05, height: 2.2, radial: 6, color: C.galvanised });
    k.panel({ points: polygonPoints(0.42, 8, Math.PI / 8), color: C.signRed, y: 2.55 });
    k.box({ width: 0.5, height: 0.11, depth: 0.02, y: 2.5, z: 0.035, color: C.signWhite });
    return k;
  },

  /** Cédez-le-passage : triangle pointe en bas, l'inverse du danger. */
  signYield(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.05, radiusTop: 0.05, height: 2.2, radial: 6, color: C.galvanised });
    const outer = [[-0.52, 0.86], [0.52, 0.86], [0, 0]];
    const inner = [[-0.36, 0.76], [0.36, 0.76], [0, 0.2]];
    k.panel({ points: outer, color: C.signRed, y: 2.15 });
    k.face(inner, C.signWhite, { y: 2.15, plane: 0.035 });
    return k;
  },

  /** Route prioritaire : losange jaune bordé de blanc. */
  signPriority(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.05, radiusTop: 0.05, height: 2.2, radial: 6, color: C.galvanised });
    k.panel({ points: polygonPoints(0.44, 4, Math.PI / 4), color: C.signWhite, y: 2.55 });
    k.face(polygonPoints(0.3, 4, Math.PI / 4), C.signYellow, { y: 2.55, plane: 0.035 });
    return k;
  },

  /** Limitation de vitesse : disque blanc cerclé de rouge. */
  signSpeedLimit(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.05, radiusTop: 0.05, height: 2.2, radial: 6, color: C.galvanised });
    k.panel({ points: polygonPoints(0.4, 12), color: C.signRed, y: 2.55 });
    k.face(polygonPoints(0.3, 12), C.signWhite, { y: 2.55, plane: 0.035 });
    return k;
  },

  /** Interdiction de dépasser : le même disque, deux véhicules dedans. */
  signNoOvertaking(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.05, radiusTop: 0.05, height: 2.2, radial: 6, color: C.galvanised });
    k.panel({ points: polygonPoints(0.4, 12), color: C.signRed, y: 2.55 });
    k.face(polygonPoints(0.3, 12), C.signWhite, { y: 2.55, plane: 0.035 });
    k.box({ width: 0.13, height: 0.2, depth: 0.02, x: -0.11, y: 2.45, z: 0.05, color: C.black });
    k.box({ width: 0.13, height: 0.2, depth: 0.02, x: 0.11, y: 2.45, z: 0.05, color: C.signRed });
    return k;
  },

  /** Giratoire : disque bleu, trois flèches blanches en triangle. */
  signRoundabout(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.05, radiusTop: 0.05, height: 2.2, radial: 6, color: C.galvanised });
    k.panel({ points: polygonPoints(0.4, 12), color: C.signBlue, y: 2.55 });
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      k.box({
        width: 0.07,
        height: 0.2,
        depth: 0.02,
        x: Math.cos(angle) * 0.17,
        y: 2.55 + Math.sin(angle) * 0.17 - 0.1,
        z: 0.05,
        roll: angle,
        color: C.signWhite,
      });
    }
    return k;
  },

  /** Passage piétons : carré bleu, triangle blanc. */
  signCrossing(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.05, radiusTop: 0.05, height: 2.2, radial: 6, color: C.galvanised });
    const square = [[-0.36, -0.36], [0.36, -0.36], [0.36, 0.36], [-0.36, 0.36]];
    k.panel({ points: square, color: C.signBlue, y: 2.52 });
    k.face([[0, 0.26], [-0.26, -0.2], [0.26, -0.2]], C.signWhite, { y: 2.52, plane: 0.035 });
    return k;
  },

  /**
   * Direction : lame en pointe, deux pieds. La pointe est ce qui la distingue
   * d'un panneau d'agglomération — sans elle, les deux lames se ressemblent.
   */
  signDirection(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    for (const x of [-0.5, 0.5]) {
      k.cylinder({ radiusBottom: 0.045, radiusTop: 0.045, height: 2.3, radial: 5, x, color: C.galvanised });
    }
    const lame = [[-0.85, -0.22], [0.62, -0.22], [0.92, 0], [0.62, 0.22], [-0.85, 0.22]];
    k.panel({ points: lame, color: C.signWhite, y: 2.4, thickness: 0.06 });
    k.box({ width: 1.44, height: 0.05, depth: 0.075, x: -0.12, y: 2.58, color: C.signBlue });
    return k;
  },

  /** Entrée d'agglomération : lame blanche bordée de rouge, posée bas. */
  signPlaceName(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    for (const x of [-0.62, 0.62]) {
      k.cylinder({ radiusBottom: 0.045, radiusTop: 0.045, height: 1.75, radial: 5, x, color: C.galvanised });
    }
    const lame = [[-0.9, -0.28], [0.9, -0.28], [0.9, 0.28], [-0.9, 0.28]];
    k.panel({ points: lame, color: C.signRed, y: 1.85, thickness: 0.06 });
    k.face([[-0.82, -0.2], [0.82, -0.2], [0.82, 0.2], [-0.82, 0.2]], C.signWhite, { y: 1.85, plane: 0.04 });
    return k;
  },

  /**
   * Balise de virage : panneau bas à chevrons. C'est le seul objet du catalogue
   * qui dise « la route tourne ici », et il se pose donc en série dans les
   * courbes, jamais isolément.
   */
  signChevron(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.045, radiusTop: 0.045, height: 1.05, radial: 5, color: C.galvanised });
    k.panel({ points: [[-0.34, -0.22], [0.34, -0.22], [0.34, 0.22], [-0.34, 0.22]], color: C.signWhite, y: 1.15 });
    for (const x of [-0.16, 0.12]) {
      k.box({ width: 0.1, height: 0.3, depth: 0.02, x, y: 1, z: 0.04, roll: 0.7, color: C.black });
    }
    return k;
  },

  /**
   * Borne kilométrique à la française : socle blanc, chapeau coloré. Le rouge
   * est celui des routes nationales ; les départementales le portent jaune,
   * mais la nuance ne se lit pas à trente mètres.
   */
  milestone(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 0.3, height: 0.5, depth: 0.22, color: C.white });
    k.cylinder({ radiusBottom: 0.15, radiusTop: 0.15, height: 0.14, radial: 8, y: 0.5, color: C.red });
    return k;
  },

  /** Abribus : quatre montants, un fond, une couverture, un banc. */
  busShelter(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    for (const [x, z] of [[-1.5, -0.65], [1.5, -0.65], [-1.5, 0.65], [1.5, 0.65]]) {
      k.box({ width: 0.1, height: 2.4, depth: 0.1, x, z, color: C.steelDark });
    }
    k.box({ width: 3.2, height: 2.3, depth: 0.06, z: -0.68, color: C.plaster });
    k.box({ width: 0.06, height: 2.3, depth: 1.4, x: -1.55, color: C.plaster });
    k.box({ width: 3.5, height: 0.12, depth: 1.7, y: 2.4, color: C.slate });
    k.box({ width: 2.6, height: 0.08, depth: 0.4, y: 0.45, z: -0.42, color: C.wood });
    return k;
  },

  /** Fontaine de village : vasque octogonale et colonne. */
  fountain(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 1.25, radiusTop: 1.25, height: 0.62, radial: 8, color: C.stone });
    k.cylinder({ radiusBottom: 1.05, radiusTop: 1.05, height: 0.06, radial: 8, y: 0.58, color: C.water });
    k.cylinder({ radiusBottom: 0.24, radiusTop: 0.17, height: 1.5, radial: 6, y: 0.62, color: C.stoneDark });
    k.box({ width: 0.5, height: 0.16, depth: 0.5, y: 2.05, color: C.stoneDark });
    return k;
  },

  /** Lavoir : bassin ouvert sous une couverture sur poteaux. */
  lavoir(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 5, height: 0.55, depth: 3, color: C.stone });
    k.box({ width: 4.2, height: 0.08, depth: 2.2, y: 0.5, color: C.water });
    for (const [x, z] of [[-2.2, -1.3], [2.2, -1.3], [-2.2, 1.3], [2.2, 1.3]]) {
      k.box({ width: 0.16, height: 2.5, depth: 0.16, x, y: 0.55, z, color: C.wood });
    }
    k.gableRoof({ width: 5, depth: 3, height: 1.1, y: 3.05, color: C.tile, gableColor: C.tile });
    return k;
  },

  /** Botte ronde, couchée sur le flanc — l'orientation usuelle au champ. */
  hayBaleRound(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({
      radiusBottom: 0.75,
      radiusTop: 0.75,
      height: 1.2,
      radial: 10,
      y: 0.75,
      z: -0.6,
      tilt: Math.PI / 2,
      color: C.hay,
      colorTop: C.hayDark,
    });
    return k;
  },

  /** Botte parallélépipédique, posée à plat. */
  hayBaleSquare(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 2.2, height: 1.1, depth: 1.2, color: C.hay });
    return k;
  },

  /**
   * Tas de bois : trois rangs de rondins empilés, refendus au bout.
   *
   * Les rondins sont couchés selon Z — c'est le tangage qui les y met — et
   * s'échelonnent donc en X. Les décaler selon Z les alignerait bout à bout au
   * lieu de les ranger côte à côte, ce qui donnerait une poutre de sept mètres.
   */
  woodPile(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const logs = 6;
    for (let row = 0; row < 3; row++) {
      // Un rang sur deux décalé d'un demi-rondin : un empilement parfaitement
      // aligné ne tiendrait pas debout, et ne trompe personne.
      const stagger = row % 2 === 0 ? 0 : 0.16;
      for (let i = 0; i < logs - (row % 2); i++) {
        k.cylinder({
          radiusBottom: 0.16,
          radiusTop: 0.16,
          height: 2.4,
          radial: 6,
          x: -0.8 + stagger + (i / (logs - 1)) * 1.6,
          y: 0.17 + row * 0.3,
          z: -1.2,
          tilt: Math.PI / 2,
          color: row === 2 ? C.woodPale : C.wood,
          colorTop: C.woodPale,
        });
      }
    }
    return k;
  },

  /** Grange : long volume maçonné, toit à deux pentes, grande porte. */
  barn(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 16, height: 5.5, depth: 9, color: C.plaster });
    k.gableRoof({ width: 16, depth: 9, height: 3.2, y: 5.5, color: C.tile, gableColor: C.brick });
    k.box({ width: 4, height: 4.2, depth: 0.12, z: 4.55, color: C.wood });
    return k;
  },

  /**
   * Moulin à vent : tour effilée en pierre, calotte, quatre ailes. Les ailes
   * ne tournent pas — contrairement au rotor de l'éolienne moderne, dont le
   * pivot est câblé une fois pour toutes dans le shader commun à la hauteur
   * du moyeu de l'éolienne (`WIND_TURBINE_HUB_M`) ; un second pivot, à une
   * autre hauteur, demanderait d'y toucher pour un seul objet. Un moulin à
   * l'arrêt reste un moulin.
   */
  windmill(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const height = 8.5;
    k.cylinder({ radiusBottom: 2.4, radiusTop: 1.7, height, radial: 8, color: C.stone });
    k.cylinder({ radiusBottom: 1.9, radiusTop: 0.15, height: 2.3, radial: 8, y: height, color: C.slate });
    const hubY = height + 0.5;
    const hubZ = 1.75;
    for (let i = 0; i < 4; i++) {
      const roll = (i / 4) * Math.PI * 2 + Math.PI / 4;
      k.box({ width: 0.18, height: 4.4, depth: 0.06, y: hubY, z: hubZ, roll, color: C.wood });
    }
    k.box({ width: 0.4, height: 0.4, depth: 0.3, y: hubY, z: hubZ - 0.1, color: C.woodPale });
    return k;
  },

  /**
   * Moulin à eau : bâtisse à toit à deux pentes, roue à aubes plaquée sur le
   * pignon. La roue n'est pas non plus animée, pour la même raison que les
   * ailes du moulin à vent.
   */
  watermill(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 6, height: 5.5, depth: 7, color: C.plaster });
    k.gableRoof({ width: 6, depth: 7, height: 2.6, y: 5.5, color: C.tile, gableColor: C.brick });
    const wheelY = 2.2;
    const wheelZ = 4.3;
    k.cylinder({
      radiusBottom: 2.1,
      radiusTop: 2.1,
      height: 0.4,
      radial: 12,
      y: wheelY,
      z: wheelZ,
      tilt: Math.PI / 2,
      color: C.woodPale,
    });
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      k.box({
        width: 0.5,
        height: 0.08,
        depth: 0.5,
        x: Math.cos(angle) * 2.1,
        y: wheelY + Math.sin(angle) * 2.1,
        z: wheelZ,
        roll: angle,
        color: C.wood,
      });
    }
    return k;
  },

  /**
   * Château d'eau, silhouette moderne « à la française » : un long fût
   * cylindrique large, surmonté d'une cuve en pyramide ronde inversée qui
   * s'évase vers le haut (le fût est son sommet, pas sa base), fermée par un
   * toit plat. Teinte claire (plâtre) plutôt que béton brut ou ardoise — la
   * lecture recherchée est celle des tours-réservoirs récentes, pas celle du
   * modèle rural à chapeau conique qu'elle remplace.
   */
  waterTower(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const shaftRadius = 1.3;
    const shaftHeight = 16;
    const tankHeight = 6.5;
    const tankRadius = 4.6;
    k.cylinder({ radiusBottom: shaftRadius, radiusTop: shaftRadius, height: shaftHeight, radial: 16, color: C.plaster });
    k.cylinder({
      radiusBottom: shaftRadius,
      radiusTop: tankRadius,
      height: tankHeight,
      radial: 16,
      y: shaftHeight,
      color: C.plaster,
    });
    k.cylinder({
      radiusBottom: tankRadius,
      radiusTop: tankRadius,
      height: 0.3,
      radial: 16,
      y: shaftHeight + tankHeight,
      color: C.plaster,
    });
    return k;
  },

  /** Silo : cylindre cannelé et chapeau conique. */
  silo(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 2.4, radiusTop: 2.4, height: 13, radial: 12, color: C.corrugated, cap: false });
    k.cylinder({ radiusBottom: 2.6, radiusTop: 0.3, height: 2.2, radial: 12, y: 13, color: C.galvanised });
    // Échelle : deux montants, assez pour donner l'échelle du volume.
    for (const x of [-0.3, 0.3]) {
      k.box({ width: 0.06, height: 13, depth: 0.06, x, z: 2.45, color: C.steelDark });
    }
    return k;
  },

  /** Hangar agricole : bardage bas, toit en berceau, un long côté ouvert. */
  hangar(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 18, height: 3.6, depth: 0.15, z: -5, color: C.corrugated });
    k.box({ width: 0.15, height: 3.6, depth: 10, x: -9, color: C.corrugated });
    k.box({ width: 0.15, height: 3.6, depth: 10, x: 9, color: C.corrugated });
    for (const x of [-9, -3, 3, 9]) {
      k.box({ width: 0.2, height: 4.4, depth: 0.2, x, z: 5, color: C.steelDark });
    }
    k.barrelRoof({ width: 18.4, depth: 10.4, rise: 2.6, y: 4.2, color: C.corrugated });
    return k;
  },

  /**
   * Serre tunnel de maraîchage : une voûte pleine, deux longrines au sol.
   *
   * Le matériau commun du mobilier ne sait pas la transparence — c'est un seul
   * programme GPU pour tout le catalogue (voir l'en-tête de ce module) — donc
   * la bâche n'est pas vitrée, elle est **pâle**. À la distance où ce décor se
   * regarde, une couleur claire et un peu bleutée suffit à lire « plastique »
   * plutôt que « tôle », ce qui est tout ce qu'on demande à cette pièce.
   */
  greenhouse(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const width = 4.2;
    const length = 14;
    k.barrelRoof({ width, depth: length, rise: 2, color: C.water });
    for (const x of [-width / 2, width / 2]) {
      k.box({ width: 0.06, height: 0.06, depth: length, x, color: C.galvanised });
    }
    return k;
  },

  /**
   * ## Édifices urbains
   *
   * Église, mosquée, hôpital, boulangerie, commerce et centre commercial ne
   * sont **plus** ici : voir `buildingLayer.buildingPersonalityFor`, qui
   * donne leur silhouette aux vrais bâtiments désignés par le point d'intérêt
   * plutôt que de poser un modèle séparé à côté — un modèle que l'empreinte
   * réelle finissait presque toujours par recouvrir.
   *
   * Ce qui reste ici sont de grandes structures **autonomes**, visibles de
   * loin, qui ne sont pas elles-mêmes un bâtiment ordinaire qu'une empreinte
   * recouvrirait.
   */

  /** Monument : plinthe et obélisque — un cône à quatre pans, effilé. */
  monument(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 3, height: 0.6, depth: 3, color: C.stoneDark });
    k.box({ width: 1.6, height: 0.5, depth: 1.6, y: 0.6, color: C.stone });
    k.cylinder({ radiusBottom: 0.9, radiusTop: 0.08, height: 6, radial: 4, y: 1.1, color: C.stone });
    return k;
  },

  /** Château : donjon crénelé, tourelle, courtine. */
  castle(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const keepH = 15;
    k.cylinder({ radiusBottom: 4.2, radiusTop: 3.9, height: keepH, radial: 10, color: C.stone });
    for (let i = 0; i < 10; i += 2) {
      const angle = (i / 10) * Math.PI * 2;
      k.box({
        width: 0.9,
        height: 1,
        depth: 0.9,
        x: Math.cos(angle) * 3.9,
        y: keepH,
        z: Math.sin(angle) * 3.9,
        color: C.stone,
      });
    }
    k.box({ width: 6, height: 6, depth: 4, x: 8, y: 0, z: 0, color: C.stone });
    k.cylinder({ radiusBottom: 2.4, radiusTop: 2.2, height: 9, radial: 8, x: 12, color: C.stone });
    return k;
  },

  /** Tour générique : beffroi ou tour de guet, toit en pavillon. */
  tower(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 4.4, height: 16, depth: 4.4, color: C.stone });
    k.cylinder({ radiusBottom: 3.4, radiusTop: 0, height: 3.5, radial: 4, y: 16, roll: Math.PI / 4, color: C.slate });
    return k;
  },

  /** Croix de cimetière : plinthe et croix, seul repère posé sur le site. */
  cemeteryCross(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 0.7, height: 0.5, depth: 0.7, color: C.stoneDark });
    k.box({ width: 0.14, height: 1.6, depth: 0.14, y: 0.5, color: C.stone });
    k.box({ width: 0.7, height: 0.14, depth: 0.14, y: 1.5, color: C.stone });
    return k;
  },

  /**
   * Cheminée d'usine : fût effilé, bande de balisage. Publie un point de
   * fumée comme celle de la ferme (`furnitureLayer._placeFarmstead`) — c'est
   * la couche appelante qui pousse le point dans `chimneys`, cette pièce ne
   * fait que porter la forme.
   */
  factoryChimney(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const height = 28;
    k.cylinder({ radiusBottom: 1.3, radiusTop: 0.75, height, radial: 10, color: C.brick });
    k.cylinder({ radiusBottom: 1.12, radiusTop: 0.95, height: 1.6, radial: 10, y: height * 0.8, color: C.signWhite });
    return k;
  },

  /**
   * Grande roue : portique, jante, rayons, nacelles. Un repère de foire ou de
   * parc d'attractions — rien qui tourne, comme le moulin à vent, pour ne pas
   * toucher au pivot du rotor commun (voir `windmill`).
   */
  ferrisWheel(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const radius = 9;
    const hubY = radius + 2;
    for (const x of [-4, 4]) {
      k.box({ width: 0.35, height: hubY, depth: 0.35, x, color: C.steelDark });
    }
    k.box({ width: 8.3, height: 0.3, depth: 0.3, y: hubY, color: C.steelDark });
    k.cylinder({
      radiusBottom: radius,
      radiusTop: radius,
      height: 0.4,
      radial: 16,
      y: hubY,
      tilt: Math.PI / 2,
      cap: false,
      color: C.white,
    });
    for (let i = 0; i < 8; i++) {
      const roll = (i / 8) * Math.PI * 2;
      k.box({ width: 0.12, height: radius, depth: 0.12, y: hubY, roll, color: C.galvanised });
    }
    for (let i = 0; i < 8; i++) {
      const roll = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const nx = -radius * Math.sin(roll);
      const ny = hubY + radius * Math.cos(roll);
      k.box({ width: 0.9, height: 0.9, depth: 0.7, x: nx, y: ny - 0.45, color: i % 2 === 0 ? C.red : C.blue });
    }
    return k;
  },

  /** Stade : cuvette de gradins, quatre mâts d'éclairage. */
  stadium(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const radius = 42;
    k.cylinder({ radiusBottom: radius, radiusTop: radius, height: 12, radial: 20, cap: false, color: C.concrete });
    k.cylinder({ radiusBottom: radius + 1.5, radiusTop: radius + 1.5, height: 1, radial: 20, y: 12, color: C.slate });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = sx * radius * 0.78;
      const z = sz * radius * 0.78;
      k.cylinder({ radiusBottom: 0.5, radiusTop: 0.3, height: 22, radial: 6, x, z, color: C.galvanised });
      k.box({ width: 2.4, height: 1.2, depth: 0.3, x, y: 22, z, color: C.steelDark });
    }
    return k;
  },

  /** Piquet de clôture en bois, tête taillée. */
  fencePostWood(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.08, radiusTop: 0.07, height: 1.15, radial: 5, color: C.wood });
    k.cylinder({ radiusBottom: 0.07, radiusTop: 0, height: 0.12, radial: 5, y: 1.15, color: C.woodPale });
    return k;
  },

  /** Piquet de clôture en béton, section carrée — celui des pâtures barbelées. */
  fencePostConcrete(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 0.1, height: 1.3, depth: 0.1, color: C.concrete });
    return k;
  },

  /**
   * Buisson isolé : trois masses irrégulières, sans tronc visible.
   *
   * ## Pourquoi ce n'est plus un empilement de cylindres
   *
   * La version précédente empilait trois troncs de cône coaxiaux. Vue de la
   * selle, elle donnait exactement ce qu'elle était : un plot. Le défaut n'est
   * pas le nombre de faces — c'est la **régularité**. Un feuillage n'a ni axe de
   * révolution, ni silhouette convexe, ni couleur unique.
   *
   * Les masses sont donc bruitées (`Kit.rock`, qui n'a rien de minéral : c'est
   * un volume facetté irrégulier), **décentrées** les unes par rapport aux
   * autres, et de trois verts différents. Le coût est le même ; ce qui change
   * est qu'aucune arête ne se répète.
   */
  bush(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.rock({ radius: 1.05, height: 1.35, sides: 7, rings: 3, seed: 2101, color: C.leafDeep, colorTop: C.leafOlive });
    k.rock({ radius: 0.8, height: 1.05, sides: 6, rings: 2, seed: 2113, x: 0.8, z: 0.45, y: 0.1, color: C.leafOlive, colorTop: C.leafSpring });
    k.rock({ radius: 0.62, height: 0.85, sides: 6, rings: 2, seed: 2129, x: -0.62, z: -0.5, color: C.leafBlue, colorTop: C.leafOlive });
    return k;
  },

  /**
   * Arbre de plein vent : un tronc net, une charpentière, une houppe éclatée.
   *
   * Il ne remplace pas les arbres de bois, qui restent des panneaux croisés
   * (`vegetationLayer`) — à mille par tuile, un volume serait ruineux. Il sert là
   * où l'arbre est **isolé et proche** : alignement de départementale, arbre de
   * cour de ferme, bord de parcelle. Là, un panneau se trahit dès qu'on le
   * contourne, et c'est exactement ce que fait la caméra.
   */
  treeBroad(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.34, radiusTop: 0.2, height: 3.2, radial: 6, color: C.bark });
    // Deux charpentières : elles sortent de la houppe et donnent la lecture de
    // l'arbre là où une boule posée sur un bâton donne une sucette.
    k.box({ width: 0.16, height: 1.5, depth: 0.16, y: 2.7, z: 0.2, tilt: 0.7, color: C.bark });
    k.box({ width: 0.16, height: 1.4, depth: 0.16, y: 2.7, z: -0.2, tilt: -0.8, color: C.bark });
    k.rock({ radius: 2.5, height: 2.9, sides: 8, rings: 3, seed: 2203, y: 2.9, color: C.leafDeep, colorTop: C.leafOlive });
    k.rock({ radius: 1.7, height: 2, sides: 7, rings: 2, seed: 2213, x: 1.5, z: 0.9, y: 3.6, color: C.leafOlive, colorTop: C.leafSpring });
    k.rock({ radius: 1.5, height: 1.8, sides: 7, rings: 2, seed: 2237, x: -1.4, z: -0.7, y: 3.3, color: C.leafBlue, colorTop: C.leafOlive });
    return k;
  },

  /**
   * Arbre en boule : houppe unique, dense, ronde — le tilleul ou le platane
   * taillé en rideau qu'on plante en ville et le long des départementales.
   *
   * `treeBroad` lit un arbre de plein champ, aux branches ouvertes ; celui-ci
   * lit l'arbre **conduit**, dont on a fermé la silhouette à la taille. D'où
   * une seule masse dominante — pas trois lobes décentrés — et pas de
   * charpentière visible : une boule taillée cache son bois.
   */
  treeRound(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.3, radiusTop: 0.22, height: 2.6, radial: 6, color: C.bark });
    k.rock({ radius: 2.1, height: 2.3, sides: 8, rings: 3, seed: 2301, y: 2.5, color: C.leafDeep, colorTop: C.leafOlive });
    // Second lobe imbriqué, à peine décalé : de quoi rompre la symétrie de
    // révolution sans rouvrir la silhouette en boule.
    k.rock({ radius: 1.3, height: 1.5, sides: 7, rings: 2, seed: 2311, x: 0.5, z: -0.35, y: 3, color: C.leafOlive, colorTop: C.leafSpring });
    return k;
  },

  /**
   * Arbre en fuseau : houppe haute et étroite sur un tronc fin — le peuplier
   * d'Italie des routes de plaine, planté en rang serré au bord des canaux
   * comme des départementales.
   *
   * Trois lobes empilés et **imbriqués**, chacun plus étroit que haut :
   * `treeConifer` tapisse la silhouette en étages nets, ce qui lit le sapin ;
   * ici les lobes se chevauchent pour fondre en une seule flamme continue,
   * ce qui lit le feuillu fastigié.
   */
  treeColumnar(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.22, radiusTop: 0.14, height: 3.6, radial: 6, color: C.bark });
    const lobes = [
      { y: 3.4, r: 1.05, h: 2.6, seed: 2401, color: C.leafDeep, top: C.leafOlive },
      { y: 5.3, r: 0.92, h: 2.3, seed: 2411, color: C.leafOlive, top: C.leafSpring },
      { y: 7, r: 0.72, h: 1.9, seed: 2423, color: C.leafBlue, top: C.leafOlive },
    ];
    for (const l of lobes) {
      k.rock({ radius: l.r, height: l.h, sides: 7, rings: 2, seed: l.seed, y: l.y, color: l.color, colorTop: l.top });
    }
    return k;
  },

  /**
   * Arbre en dôme : houppe large et basse, plus étalée que haute — le
   * marronnier ou le chêne de plein champ, dont la ramure déborde largement
   * le tronc plutôt que de monter en pointe.
   *
   * Même principe que `treeBroad` (charpentières visibles, lobes décentrés),
   * mais des proportions inverses : le rayon dépasse la hauteur, là où
   * `treeBroad` reste à peu près aussi haut que large.
   */
  treeOval(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.36, radiusTop: 0.22, height: 2.6, radial: 6, color: C.bark });
    k.box({ width: 0.18, height: 1.2, depth: 0.18, y: 2.3, z: 0.25, tilt: 0.85, color: C.bark });
    k.box({ width: 0.18, height: 1.1, depth: 0.18, y: 2.3, z: -0.25, tilt: -0.95, color: C.bark });
    k.rock({ radius: 3, height: 2, sides: 9, rings: 3, seed: 2501, y: 2.9, color: C.leafDeep, colorTop: C.leafOlive });
    k.rock({ radius: 1.9, height: 1.4, sides: 7, rings: 2, seed: 2513, x: 1.7, z: 1, y: 3.1, color: C.leafOlive, colorTop: C.leafSpring });
    return k;
  },

  /** Conifère isolé : fût droit, trois étages de plus en plus courts. */
  treeConifer(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.28, radiusTop: 0.12, height: 8.5, radial: 6, color: C.bark });
    const stages = [
      { y: 1.6, r: 2.2, h: 3, color: C.leafDeep, top: C.leafBlue },
      { y: 4, r: 1.7, h: 2.8, color: C.leafBlue, top: C.leafDeep },
      { y: 6.2, r: 1.1, h: 2.6, color: C.leafDeep, top: C.leafOlive },
    ];
    for (const s of stages) {
      k.cylinder({ radiusBottom: s.r, radiusTop: 0.05, height: s.h, radial: 7, y: s.y, color: s.color, colorTop: s.top, cap: false });
    }
    return k;
  },

  /**
   * Vache, de profil, tête baissée à brouter.
   *
   * Ce qui fait lire « vache » à cinquante mètres, c'est la **silhouette de
   * profil** : un corps long et bas sur quatre pattes fines, plus la tache
   * sombre du train arrière — mais à quinze mètres, ce que la selle voit
   * vraiment, ce sont les oreilles, les sabots et un mufle qui dépasse : sans
   * eux, la silhouette reste juste, mais l'objet se lit comme un bloc.
   */
  cow(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 0.62, height: 0.78, depth: 1.85, y: 0.72, color: C.hide });
    // Croupe sombre : la vache pie noire de nos prés, en deux couleurs.
    k.box({ width: 0.64, height: 0.66, depth: 0.6, y: 0.78, z: -0.66, color: C.hideDark });
    // Encolure et tête, penchées vers l'herbe — la posture qu'elles tiennent
    // les trois quarts du temps.
    k.box({ width: 0.4, height: 0.5, depth: 0.55, y: 0.85, z: 1.02, tilt: 0.75, color: C.hide });
    k.box({ width: 0.3, height: 0.28, depth: 0.44, y: 0.5, z: 1.32, color: C.hideDark });
    // Mufle : la tache claire au bout du museau, qui donne à la tête son avant.
    k.box({ width: 0.22, height: 0.16, depth: 0.1, y: 0.42, z: 1.5, color: C.muzzle });
    // Oreilles, en éventail de part et d'autre du crâne.
    for (const x of [-0.16, 0.16]) {
      k.box({ width: 0.14, height: 0.05, depth: 0.16, x, y: 0.62, z: 1.2, roll: x < 0 ? 0.5 : -0.5, color: C.hideDark });
    }
    for (const [x, z] of [[-0.22, 0.68], [0.22, 0.68], [-0.22, -0.62], [0.22, -0.62]]) {
      k.box({ width: 0.12, height: 0.6, depth: 0.13, x, z, color: C.hideDark });
      // Sabot : un talon sombre plus large, posé au sol — un trait de plus
      // qui casse la jambe-tube.
      k.box({ width: 0.14, height: 0.14, depth: 0.15, x, z, color: C.black });
    }
    // Queue : un trait, mais un trait qu'on cherche du regard.
    k.box({ width: 0.06, height: 0.62, depth: 0.06, y: 0.5, z: -0.92, color: C.hideDark });
    return k;
  },

  /**
   * Mouton : une masse laineuse, une tête sombre, quatre pattes courtes.
   * Oreilles tombantes et sabots sombres, comme la vache — la même raison :
   * une tête sans oreille se lit comme un cube, pas comme un animal.
   */
  sheep(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 0.42, height: 0.5, depth: 0.96, y: 0.42, color: C.fleece });
    k.box({ width: 0.26, height: 0.26, depth: 0.3, y: 0.36, z: 0.6, color: C.hideDark });
    for (const x of [-0.14, 0.14]) {
      k.box({ width: 0.1, height: 0.05, depth: 0.14, x, y: 0.3, z: 0.55, tilt: 0.6, color: C.hideDark });
    }
    for (const [x, z] of [[-0.14, 0.32], [0.14, 0.32], [-0.14, -0.32], [0.14, -0.32]]) {
      k.box({ width: 0.08, height: 0.34, depth: 0.08, x, z, color: C.hideDark });
      k.box({ width: 0.09, height: 0.1, depth: 0.1, x, z, color: C.black });
    }
    return k;
  },

  /**
   * Chèvre : plus petite qu'un mouton, la tête levée au lieu de baissée — elle
   * surveille, elle ne broute pas en continu — et deux cornes recourbées vers
   * l'arrière, qui sont ce qui la distingue d'un mouton à cette distance.
   */
  goat(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 0.34, height: 0.5, depth: 0.85, y: 0.58, color: C.fleece });
    k.box({ width: 0.22, height: 0.3, depth: 0.32, y: 0.78, z: 0.5, tilt: -0.3, color: C.fleece });
    k.box({ width: 0.16, height: 0.18, depth: 0.24, y: 0.95, z: 0.68, color: C.hideDark });
    // Oreilles, dressées de chaque côté — celles de la chèvre ne tombent pas
    // comme celles du mouton, encore un repère qui les distingue.
    for (const x of [-0.13, 0.13]) {
      k.box({ width: 0.08, height: 0.04, depth: 0.14, x, y: 1, z: 0.66, tilt: -0.3, color: C.hideDark });
    }
    for (const [x, z] of [[-0.12, 0.32], [0.12, 0.32], [-0.12, -0.3], [0.12, -0.3]]) {
      k.box({ width: 0.07, height: 0.42, depth: 0.07, x, z, color: C.hideDark });
      k.box({ width: 0.08, height: 0.08, depth: 0.08, x, z, color: C.black });
    }
    for (const x of [-0.06, 0.06]) {
      k.box({ width: 0.03, height: 0.22, depth: 0.03, x, y: 1.02, z: 0.62, tilt: 0.9, color: C.hideDark });
    }
    k.box({ width: 0.05, height: 0.14, depth: 0.05, y: 0.85, z: -0.44, tilt: -0.6, color: C.hideDark });
    return k;
  },

  /**
   * Cheval au pré : plus grand qu'une vache, l'encolure haute et la tête
   * levée — un cheval ne broute pas en permanence, contrairement au bovin —
   * et une crinière et une queue sombres, qui font sa silhouette avant même
   * ses jambes plus longues et plus fines.
   *
   * Robe alezane (`chestnut`), pas la même que le train arrière de la vache
   * (`hideDark`, réservé aux crins et aux sabots) : c'est elle qui manquait —
   * un cheval tout en `hideDark` se fond dans l'ombre au pied d'une haie.
   */
  horse(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const coat = C.chestnut || C.hideDark;
    k.box({ width: 0.58, height: 0.95, depth: 2.05, y: 1.05, color: coat });
    k.box({ width: 0.32, height: 0.75, depth: 0.4, y: 1.35, z: 1.05, tilt: -0.35, color: coat });
    k.box({ width: 0.24, height: 0.28, depth: 0.55, y: 1.62, z: 1.35, tilt: 0.15, color: coat });
    // Oreilles, dressées au sommet du crâne.
    for (const x of [-0.07, 0.07]) {
      k.box({ width: 0.05, height: 0.14, depth: 0.05, x, y: 1.86, z: 1.5, tilt: 0.15, color: C.black });
    }
    // Crinière : une crête sombre sur l'encolure.
    k.box({ width: 0.08, height: 0.5, depth: 0.36, y: 1.55, z: 0.95, tilt: -0.35, color: C.black });
    for (const [x, z] of [[-0.24, 0.75], [0.24, 0.75], [-0.24, -0.75], [0.24, -0.75]]) {
      k.box({ width: 0.13, height: 0.85, depth: 0.14, x, z, color: C.black });
      k.box({ width: 0.15, height: 0.14, depth: 0.16, x, z, color: C.hideDark });
    }
    // Queue longue, tombante — celle d'une vache est un trait, celle d'un
    // cheval balaie près du sol.
    k.box({ width: 0.1, height: 0.85, depth: 0.1, y: 0.75, z: -1.05, tilt: 0.12, color: C.black });
    return k;
  },

  /**
   * Âne : plus petit et plus trapu qu'un cheval, robe grise, oreilles bien
   * plus longues — c'est elles qui le distinguent du poney à cette échelle,
   * pas la taille, difficile à juger sans repère à côté.
   */
  donkey(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const coat = C.donkeyGrey || C.hideDark;
    k.box({ width: 0.46, height: 0.72, depth: 1.5, y: 0.8, color: coat });
    k.box({ width: 0.26, height: 0.55, depth: 0.32, y: 1, z: 0.78, tilt: -0.3, color: coat });
    k.box({ width: 0.2, height: 0.22, depth: 0.42, y: 1.32, z: 1.02, tilt: 0.1, color: coat });
    // Oreilles longues, dressées — le trait qui fait « âne » avant tout le reste.
    for (const x of [-0.09, 0.09]) {
      k.box({ width: 0.06, height: 0.32, depth: 0.07, x, y: 1.5, z: 1.1, tilt: 0.1, roll: x < 0 ? -0.12 : 0.12, color: coat });
    }
    // Crinière et queue courtes, sombres — plus discrètes que chez le cheval.
    k.box({ width: 0.07, height: 0.28, depth: 0.28, y: 1.24, z: 0.68, tilt: -0.3, color: C.hideDark });
    for (const [x, z] of [[-0.18, 0.55], [0.18, 0.55], [-0.18, -0.55], [0.18, -0.55]]) {
      k.box({ width: 0.1, height: 0.66, depth: 0.11, x, z, color: coat });
      k.box({ width: 0.12, height: 0.1, depth: 0.13, x, z, color: C.black });
    }
    k.box({ width: 0.08, height: 0.5, depth: 0.08, y: 0.55, z: -0.78, tilt: 0.08, color: C.hideDark });
    return k;
  },

  /** Poule : un corps, une tête, une crête. Trente centimètres de vie. */
  chicken(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 0.16, height: 0.2, depth: 0.28, y: 0.13, color: C.feather });
    k.box({ width: 0.1, height: 0.13, depth: 0.11, y: 0.28, z: 0.1, color: C.feather });
    k.box({ width: 0.03, height: 0.06, depth: 0.08, y: 0.4, z: 0.09, color: C.comb });
    for (const x of [-0.05, 0.05]) {
      k.box({ width: 0.02, height: 0.13, depth: 0.02, x, color: C.hayDark });
    }
    return k;
  },

  /**
   * Fil à linge : deux piquets, une corde, et quatre pièces qui pendent.
   *
   * Les draps sont des quadrilatères simples plutôt que des surfaces pliées :
   * ce qui les rend lisibles, c'est leur couleur claire sur le vert du pré et
   * leur alignement régulier, pas le drapé.
   */
  laundryLine(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const span = 4.6;
    for (const x of [-span / 2, span / 2]) {
      k.box({ width: 0.09, height: 1.85, depth: 0.09, x, color: C.wood });
      k.box({ width: 0.5, height: 0.07, depth: 0.07, x, y: 1.7, color: C.wood });
    }
    k.box({ width: span, height: 0.025, depth: 0.025, y: 1.72, color: C.galvanised });

    const pieces = [
      { w: 0.9, h: 0.95, x: -1.5, color: C.linen },
      { w: 0.62, h: 0.7, x: -0.45, color: C.cloth },
      { w: 0.8, h: 0.85, x: 0.55, color: C.linen },
      { w: 0.55, h: 0.6, x: 1.55, color: C.clothWarm },
    ];
    for (const p of pieces) {
      k.box({ width: p.w, height: p.h, depth: 0.02, x: p.x, y: 1.7 - p.h, color: p.color });
    }
    return k;
  },

  /**
   * Feu tricolore : mât, boîtier, trois lentilles **éteintes**.
   *
   * ## Le scintillement
   *
   * Les lentilles étaient des cylindres tournés de `-π/2`, ce qui envoie leur
   * axe vers `-Z` : elles rentraient donc *dans* le boîtier au lieu d'en
   * sortir, et leur disque arrière tombait exactement sur la face avant du
   * boîtier. Deux surfaces coplanaires, c'est un combat pour le même pixel — le
   * scintillement qu'on voyait, et il changeait avec la distance parce que la
   * précision du tampon de profondeur en dépend.
   *
   * Les lentilles sortent maintenant franchement du boîtier (`tilt: +π/2`,
   * base à `z = 0.135` contre `0.13` pour la face), et elles sont **sombres** :
   * c'est `furnitureLayer` qui allume la bonne au bon moment, avec une pastille
   * lumineuse posée par-dessus (`TRAFFIC_LENSES`). Un feu dont les trois
   * couleurs brillent en permanence n'est pas un feu, c'est une guirlande.
   */
  trafficLight(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.11, radiusTop: 0.09, height: 3, radial: 6, color: C.steelDark });
    k.box({ width: 0.34, height: 0.92, depth: 0.26, y: 2.35, color: C.black });
    for (const lens of trafficLensesFor(C)) {
      k.cylinder({
        radiusBottom: 0.1,
        radiusTop: 0.1,
        height: 0.06,
        radial: 8,
        y: lens.y,
        z: 0.135,
        tilt: Math.PI / 2,
        // Verre éteint : sombre et légèrement teinté, comme une lentille au
        // repos. La couleur vive vient de la pastille allumée.
        color: C.black,
        colorTop: lens.dark,
      });
      // Casquette : l'auvent noir qui coiffe chaque feu, et qui est ce qui fait
      // lire « feu tricolore » de loin plus sûrement que la couleur.
      k.box({ width: 0.24, height: 0.03, depth: 0.14, y: lens.y + 0.11, z: 0.22, color: C.black });
    }
    // Petit répétiteur bas, comme sur les carrefours français.
    k.box({ width: 0.2, height: 0.5, depth: 0.18, y: 1.05, z: 0.06, color: C.black });
    return k;
  },

  /**
   * Pierre isolée, taille d'un pavé. Ce qui manquait aux pentes minérales : un
   * versant de roche parfaitement lisse ne se lit pas comme de la roche.
   */
  rockSmall(C = DEFAULT_COLORS) {
    return new Kit(C).rock({ radius: 0.42, height: 0.34, sides: 7, rings: 2, seed: 1201, color: C.rock, colorTop: C.rockPale });
  },

  /** Bloc erratique : le rocher qu'on contourne, pas celui qu'on enjambe. */
  rockBoulder(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.rock({ radius: 1.5, height: 1.5, sides: 8, rings: 3, seed: 1303, color: C.rockDark, colorTop: C.rock });
    // Une pierre au pied : un bloc isolé au milieu de rien flotte, une petite
    // à côté l'ancre.
    k.rock({ radius: 0.5, height: 0.4, sides: 6, rings: 2, seed: 1307, x: 1.5, z: 0.7, color: C.rock, colorTop: C.rockPale });
    return k;
  },

  /** Affleurement : la dalle qui perce la pelouse d'alpage. */
  rockOutcrop(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.rock({ radius: 3.2, height: 1.9, sides: 9, rings: 3, seed: 1409, color: C.rockDark, colorTop: C.rockMoss });
    k.rock({ radius: 1.4, height: 2.6, sides: 7, rings: 3, seed: 1423, x: -1.6, z: -0.9, color: C.rockDark, colorTop: C.rock });
    return k;
  },

  /**
   * Pied de vigne : un cep tordu et sa frondaison, à poser en rang.
   *
   * Un vignoble ne se reconnaît pas à ses ceps mais à ses **rangs** — d'où le
   * profil `vineRow`, qui les relie. Le cep n'est là que pour donner le grain
   * du rang quand on passe à trois mètres.
   */
  vineStock(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.cylinder({ radiusBottom: 0.07, radiusTop: 0.05, height: 0.5, radial: 5, color: C.vineWood });
    k.cylinder({ radiusBottom: 0.32, radiusTop: 0.2, height: 0.55, radial: 6, y: 0.45, color: C.vineLeaf, colorTop: C.leafSpring });
    return k;
  },
};

/**
 * Les trois feux d'un boîtier : hauteur, couleur allumée, couleur au repos.
 *
 * Partagé entre la pièce (qui pose les verres éteints) et `furnitureLayer` (qui
 * en allume un à la fois) : les deux ne peuvent donc pas diverger d'un
 * centimètre.
 */
const trafficLensesFor = (C) => [
  { y: 3.07, color: C.red, dark: C.redDark },
  { y: 2.79, color: C.signalAmber, dark: C.amberDark },
  { y: 2.51, color: C.signalGreen, dark: C.greenDark },
];

/** Avancée de la lentille allumée devant le boîtier, en mètres. */
export const TRAFFIC_LENS_REACH_M = 0.2;

/**
 * Sections balayées le long des polylignes (`appendProfile`). Décrites en
 * mètres, `across` compté à gauche de la marche, `up` depuis le sol.
 *
 * Les couleurs descendent du pied vers la crête : un pied plus sombre suffit à
 * ancrer l'objet au sol, là où une couleur unique le fait flotter.
 */
const profilesFor = (C) => ({
  /**
   * Haie de bocage : 1,8 m, épaule à mi-hauteur, dessus arrondi.
   *
   * La section n'est plus symétrique : une haie taillée des deux côtés à
   * l'identique se lit comme un tube extrudé, ce qu'elle est. Un flanc plus
   * ouvert que l'autre et une crête décalée cassent la lecture, mais aucune
   * section fixe ne suffit à la défaire — c'est `hedgeGeometry` qui s'en
   * charge : il module cette section en hauteur et en largeur le long du tracé,
   * et lui pose des arbustes dessus dès qu'on s'en approche. Cette section-ci
   * n'est donc plus la haie ; elle en est la masse continue, celle qui la ferme
   * et qu'on voit de loin.
   */
  hedge: [
    { across: -0.5, up: 0, color: C.leafDeep },
    { across: -0.74, up: 0.7, color: C.leafDeep },
    { across: -0.5, up: 1.5, color: C.leafOlive },
    { across: -0.12, up: 1.85, color: C.leafSpring },
    { across: 0.38, up: 1.66, color: C.leafOlive },
    { across: 0.68, up: 0.82, color: C.leafBlue },
    { across: 0.52, up: 0, color: C.leafDeep },
  ],

  /**
   * Haie basse de ronces et de fougères : 0,7 m, très ouverte. Comme la haie de
   * bocage, elle reçoit ses arbustes de `hedgeGeometry` dans le champ proche.
   *
   * C'est ce qui borde la plupart des chemins et des fossés en vrai, et sa
   * seule existence corrige le défaut le plus visible du bocage procédural :
   * toutes les limites y avaient la même hauteur, donc le paysage était
   * compartimenté partout à hauteur d'homme.
   */
  lowHedge: [
    { across: -0.62, up: 0, color: C.leafDeep },
    { across: -0.5, up: 0.42, color: C.bramble },
    { across: -0.1, up: 0.72, color: C.fern },
    { across: 0.34, up: 0.5, color: C.bramble },
    { across: 0.55, up: 0, color: C.leafDeep },
  ],

  /** Rang de vigne : le feuillage tendu entre deux ceps, sur son fil. */
  vineRow: [
    { across: -0.28, up: 0.35, color: C.leafDeep },
    { across: -0.34, up: 0.9, color: C.vineLeaf },
    { across: 0, up: 1.25, color: C.leafSpring },
    { across: 0.34, up: 0.9, color: C.vineLeaf },
    { across: 0.28, up: 0.35, color: C.leafDeep },
  ],

  /**
   * Garde-corps en bois : deux lisses rondes sur poteaux, le parapet des routes
   * forestières et des ouvrages de montagne. Il remplace la glissière métallique
   * là où celle-ci ferait autoroute.
   */
  woodRail: [
    { across: -0.06, up: 0.42, color: C.wood },
    { across: -0.08, up: 0.56, color: C.woodPale },
    { across: 0.08, up: 0.56, color: C.wood },
    { across: 0.06, up: 0.42, color: C.wood },
  ],
  woodRailTop: [
    { across: -0.07, up: 0.82, color: C.woodPale },
    { across: -0.09, up: 0.96, color: C.woodPale },
    { across: 0.09, up: 0.96, color: C.wood },
    { across: 0.07, up: 0.82, color: C.wood },
  ],

  /** Muret de pierre sèche : 0,9 m, fruit léger, couronnement débordant. */
  dryStoneWall: [
    { across: -0.32, up: 0, color: C.stoneDark },
    { across: -0.26, up: 0.78, color: C.stone },
    { across: -0.3, up: 0.92, color: C.stone },
    { across: 0.3, up: 0.92, color: C.stone },
    { across: 0.26, up: 0.78, color: C.stone },
    { across: 0.32, up: 0, color: C.stoneDark },
  ],

  /**
   * Lisse de glissière, profil en W simplifié. Deux bosses seraient plus
   * fidèles ; à cette taille elles se referment en un trait, alors qu'une
   * arête franche à mi-hauteur accroche encore la lumière.
   */
  guardrailBeam: [
    { across: -0.04, up: 0.5, color: C.steelDark },
    { across: -0.09, up: 0.63, color: C.galvanised },
    { across: -0.04, up: 0.75, color: C.galvanised },
    { across: 0.04, up: 0.75, color: C.steel },
    { across: 0.09, up: 0.63, color: C.steel },
    { across: 0.04, up: 0.5, color: C.steelDark },
  ],

  /** Fil de fer barbelé : trois brins, section en losange minuscule. */
  wire: [
    { across: -0.02, up: 0, color: C.steelDark },
    { across: 0, up: 0.02, color: C.galvanised },
    { across: 0.02, up: 0, color: C.steelDark },
    { across: 0, up: -0.02, color: C.steelDark },
  ],
});

/** Hauteurs des trois brins d'une clôture barbelée, en mètres. */
export const BARBED_WIRE_HEIGHTS = [0.55, 0.85, 1.15];

/**
 * Les deux ouvrages qui tiennent une chaussée sur un versant.
 *
 * Ils ne sont pas décrits par une section, parce que leur **hauteur change** le
 * long du tracé : c'est le versant qui la fixe, mètre par mètre. Voir
 * `appendVariableWall`, qui les balaie, et `levelRow`, qui explique pourquoi la
 * plate-forme à mi-hauteur les appelle tous les deux à la fois.
 *
 * `cut` monte de la rive amont jusqu'au terrain qui la domine — c'est le mur qui
 * habille la tranchée, pas un muret posé dessus. `fill` descend de la rive aval
 * jusqu'au sol qu'elle surplombe, et porte la glissière.
 */
const wallSpecsFor = (C) => ({
  cut: {
    thickness: 0.55,
    coping: 0.09,
    colorFoot: C.stoneDark,
    colorTop: C.stone,
    /** Débord de l'arase au-dessus du terrain retenu, en mètres. */
    crown: 0.35,
    /** Plafond : au-delà, ce n'est plus un mur, c'est une falaise. */
    maxHeight: 9,
  },
  fill: {
    thickness: 0.6,
    coping: 0.08,
    colorFoot: C.stoneDark,
    colorTop: C.stone,
    crown: 0,
    maxHeight: 12,
  },
});

/**
 * Section d'un talus de remblai, engendrée à la demande : sa profondeur dépend
 * de la hauteur dont la plate-forme surplombe le terrain à cet endroit.
 *
 * Le talus part sous la rive de la chaussée et rejoint le sol en biais, avec le
 * fruit d'un remblai courant (3 de base pour 2 de hauteur). Fonction pure.
 *
 * @param {number} drop Hauteur à combler, en mètres.
 * @returns {Array<{across:number, up:number, color:number[]}>}
 */
const embankmentFor = (C) => (drop) => {
  const run = Math.max(0.4, drop * 1.5);
  return [
    { across: 0, up: 0, color: C.stoneDark },
    { across: 0, up: -Math.max(0.15, drop) * 0.35, color: C.stoneDark },
    { across: -run, up: -Math.max(0.15, drop), color: C.stone },
  ];
};

/**
 * Tout ce que le mobilier tire de son nuancier : les sections balayées le long
 * des polylignes, les ouvrages de soutènement, les feux.
 *
 * Mémorisé sur le nuancier lui-même. Deux mondes de thèmes différents gardent
 * ainsi chacun ses sections, sans rien retenir de global, et un même monde ne
 * les recalcule pas à chaque haie.
 */
const SPECS_CACHE = new WeakMap();

export function furnitureSpecsFor(colors = defaultTheme.furniture.colors) {
  let specs = SPECS_CACHE.get(colors);
  if (!specs) {
    specs = Object.freeze({
      profiles: profilesFor(colors),
      wallSpecs: wallSpecsFor(colors),
      trafficLenses: trafficLensesFor(colors),
      embankmentProfile: embankmentFor(colors),
    });
    SPECS_CACHE.set(colors, specs);
  }
  return specs;
}

/**
 * Construit le catalogue une fois pour toutes.
 * @param {Object} THREE
 * @param {Object} [colors] Nuancier du thème.
 * @returns {Record<string, Object>} géométrie par nom.
 */
export function createFurnitureGeometries(THREE, colors = defaultTheme.furniture.colors) {
  const out = {};
  for (const [name, build] of Object.entries(FURNITURE_BUILDERS)) {
    out[name] = build(colors).toGeometry(THREE, `furniture-${name}`);
  }
  return out;
}

/**
 * Matériau unique du mobilier : couleurs de sommet, éclairage lambertien.
 *
 * Un seul matériau pour tout le catalogue, donc un seul programme GPU. Les
 * appels de rendu restent séparés — une instanciation par forme —, mais le
 * changement d'état entre eux est nul.
 *
 * `DoubleSide` n'est pas une facilité : les sections balayées ouvertes — talus,
 * brins de clôture, câbles — n'ont pas d'intérieur, et le sens de leur normale
 * dépend de celui du contour d'origine, qu'on ne contrôle pas. Une face
 * manquante s'y verrait comme un trou.
 */
export function createFurnitureMaterial(THREE) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.name = 'furniture';
  return material;
}

/**
 * Vitesse angulaire du rotor à son régime nominal, en radians/seconde. Une
 * éolienne réelle tourne à dix-quinze tours par minute ; on prend le haut de
 * la fourchette (~14 tr/min) pour qu'un rotor au régime se remarque bien une
 * fois le vent monté.
 */
const ROTOR_MAX_ANGULAR_SPEED = (14 / 60) * Math.PI * 2;

/**
 * Vitesse du vent que représente `weather.wind = 1` (la bourrasque de
 * référence du thème), en km/h. Le moteur ne connaît le vent que par ce
 * scalaire 0-1 ; c'est cette échelle qui lui donne un sens physique pour le
 * rotor. 90 km/h est une bourrasque forte, plausible en France métropolitaine
 * — et c'est aussi, par construction, à peu près la vitesse à laquelle une
 * éolienne réelle se met en drapeau par sécurité, ce qui borne la fourchette
 * du bon côté sans qu'on ait à modéliser cet arrêt.
 */
const WIND_SPEED_MAX_KMH = 90;

/**
 * Sous ce seuil, le rotor ne tourne pas : le vent n'a pas la force de vaincre
 * l'inertie des pales. Valeur demandée, pas mesurée — une éolienne réelle
 * démarre plutôt vers 12-15 km/h, mais on suit le réglage voulu ici.
 */
const ROTOR_CUT_IN_KMH = 5;

/**
 * Au-delà de ce vent, le rotor tourne à `ROTOR_MAX_ANGULAR_SPEED` et n'accélère
 * plus : une éolienne régule son régime au-delà de sa vitesse de vent nominale
 * en orientant ses pales, elle ne s'emballe pas avec la tempête.
 *
 * Une éolienne réelle atteint plutôt son régime vers 45 km/h ; ici, la brise
 * ordinaire du thème (22,5 km/h — `DEFAULT_WEATHER.wind`) doit déjà se voir
 * tourner sans qu'on force le vent au maximum dans la démo, donc 25 km/h :
 * la forme de la courbe (démarrage lent, montée en cube) reste celle d'une
 * vraie éolienne, seule l'échelle est resserrée pour rester lisible depuis
 * une caméra qui roule.
 */
const ROTOR_RATED_KMH = 25;

/**
 * Vitesse angulaire du rotor pour une force de vent donnée (`weather.wind`,
 * 0-1). Nul sous le seuil de démarrage, puis une montée **cubique** — lente
 * au débrayage, de plus en plus rapide ensuite — jusqu'au régime nominal :
 * c'est la forme de la courbe de puissance d'une éolienne réelle entre son
 * démarrage et son vent nominal, pas une rampe linéaire.
 *
 * @param {number} force `weather.wind`, de 0 à 1.
 * @returns {number} radians/seconde.
 */
function rotorAngularSpeed(force) {
  const f = Number.isFinite(force) ? Math.min(1, Math.max(0, force)) : 0;
  const kmh = f * WIND_SPEED_MAX_KMH;
  if (kmh <= ROTOR_CUT_IN_KMH) return 0;
  const t = Math.min(1, (kmh - ROTOR_CUT_IN_KMH) / (ROTOR_RATED_KMH - ROTOR_CUT_IN_KMH));
  return ROTOR_MAX_ANGULAR_SPEED * t * t * t;
}

/**
 * Matériau du mobilier, avec un rotor qui tourne. C'est un matériau **séparé**
 * de `createFurnitureMaterial`, pas une option de plus dessus : le shader
 * commun est partagé par tout le catalogue justement pour n'avoir qu'un seul
 * programme GPU, et l'attribut `aSpin` que celui-ci lit n'existe que sur la
 * géométrie de l'éolienne (voir `Kit.toGeometry`) — le brancher sur le
 * matériau commun ferait chercher un attribut absent sur chaque poteau et
 * chaque banc.
 *
 * La rotation se fait au sommet, comme le vent du feuillage
 * (`foliageMaterial`) : un seul uniforme avance par image, rien à réécrire
 * par instance.
 */
export function createFurnitureRotorMaterial(THREE) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.name = 'furniture-rotor';

  const uniforms = { uRotorAngle: { value: 0 } };
  material.userData.rotor = { uRotorAngle: uniforms.uRotorAngle, angle: 0 };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRotorAngle = uniforms.uRotorAngle;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n attribute float ${ROTOR_SPIN_ATTRIBUTE};\n uniform float uRotorAngle;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         if (${ROTOR_SPIN_ATTRIBUTE} > 0.5) {
           // Rotation dans le plan (x, y), pivot au moyeu — voir
           // WIND_TURBINE_HUB_M et la pose des pales dans windTurbine.
           float c = cos(uRotorAngle);
           float s = sin(uRotorAngle);
           float rx = transformed.x;
           float ry = transformed.y - ${WIND_TURBINE_HUB_M.toFixed(1)};
           transformed.x = rx * c - ry * s;
           transformed.y = rx * s + ry * c + ${WIND_TURBINE_HUB_M.toFixed(1)};
         }`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         if (${ROTOR_SPIN_ATTRIBUTE} > 0.5) {
           float c = cos(uRotorAngle);
           float s = sin(uRotorAngle);
           float nx = objectNormal.x;
           float ny = objectNormal.y;
           objectNormal.x = nx * c - ny * s;
           objectNormal.y = nx * s + ny * c;
         }`
      );
  };
  material.customProgramCacheKey = () => 'furniture-rotor';

  return material;
}

/**
 * Fait avancer le rotor d'un matériau créé par `createFurnitureRotorMaterial`.
 *
 * @param {Object} material
 * @param {number} delta Secondes écoulées.
 * @param {number} force Force du vent, de 0 à 1 (`weather.wind`) — c'est elle
 *        qui pilote la vitesse, pas une constante : un rotor tourne à la
 *        vitesse que lui donne le vent, immobile en dessous du seuil de
 *        démarrage, plafonné à son régime nominal au-delà (voir
 *        `rotorAngularSpeed`).
 */
export function advanceFurnitureRotor(material, delta, force) {
  const rotor = material?.userData?.rotor;
  if (!rotor || !Number.isFinite(delta)) return;
  const speed = rotorAngularSpeed(force);
  rotor.angle = (rotor.angle + delta * speed) % (Math.PI * 2);
  rotor.uRotorAngle.value = rotor.angle;
}

/**
 * Hauteur et avancée de la lanterne, déduites de la crosse et non recopiées :
 * changer `LAMP_ARC` déplace du même coup le halo et la nappe de lumière.
 */
export const LAMP_HEAD_HEIGHT_M = lampArcAt(1).y - 0.16;
export const LAMP_HEAD_REACH_M = lampArcAt(1).z + LAMP_ARC.lantern;

/**
 * Quadrilatère du halo d'un point lumineux, dans le plan (x, y), centré.
 *
 * Un panneau et non une sphère : un halo est un phénomène atmosphérique, il n'a
 * pas de volume. Le matériau le rend toujours face caméra, ce qui rend la forme
 * du panneau indifférente au point de vue.
 */
export function createGlowGeometry(THREE) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.name = 'furniture-glow';
  return geometry;
}

/**
 * Matériau des halos nocturnes : additif, sans écriture de profondeur.
 *
 * Additif parce qu'un halo **ajoute** de la lumière ; sans écriture de
 * profondeur parce que deux halos qui se recouvrent ne doivent pas s'exclure. Le
 * dégradé radial est calculé dans le shader plutôt que porté par une texture :
 * une texture de 64² pour un dégradé que trois lignes de GLSL rendent
 * exactement, et sans filtrage, ne se justifie pas.
 *
 * Le panneau est orienté face caméra dans le **vertex shader**, à partir des
 * matrices déjà présentes : c'est ce qui permet de garder l'instanciation, là où
 * des `Sprite` imposeraient un objet par lampadaire.
 *
 * ## La teinte par instance ne se demande pas, elle se constate
 *
 * Un feu tricolore a besoin d'un halo par couleur, un lampadaire d'un seul ton
 * pour tous. La distinction ne passe **pas** par un paramètre : elle est déjà
 * portée par la scène. Dès qu'un `InstancedMesh` reçoit un `instanceColor`,
 * three définit `USE_INSTANCING_COLOR` **et déclare lui-même l'attribut** dans
 * le préambule qu'il ajoute à tout `ShaderMaterial`. Le déclarer une seconde
 * fois ici faisait échouer la compilation du programme (`'instanceColor' :
 * redefinition`), et donc disparaître tous les halos.
 *
 * On lit donc le define de three plutôt que de dupliquer la question. Un
 * maillage sans `instanceColor` retombe sur `uColor`, ce qui est la bonne
 * valeur et non un repli : c'est le cas du lampadaire.
 */
export function createGlowMaterial(THREE, { color = [1, 0.86, 0.6] } = {}) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Le panneau est dressé dans l'espace de la vue : son enroulement dépend
    // alors de la projection, et non de la géométrie. Deux faces coûtent zéro
    // ici — pas de profondeur écrite, un mélange additif — et évitent qu'un halo
    // disparaisse sous un angle particulier.
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    // Un halo n'est pas fondu par le brouillard : c'est justement dans la brume
    // qu'on le voit le mieux.
    fog: false,
    uniforms: {
      uColor: { value: new THREE.Vector3(...color) },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vTint;
      // Pas de déclaration manuelle : dès que \`mesh.setColorAt\` a été appelé
      // une fois, three.js définit USE_INSTANCING_COLOR et injecte lui-même
      // cet attribut en tête de shader (WebGLProgram.js). Le redéclarer ici
      // provoquait une double définition — le halo des feux ne compilait plus
      // et disparaissait, avec toute la scène en erreur de programme WebGL.
      uniform vec3 uColor;
      void main() {
        vUv = uv;
        // instanceColor est déclaré par three, jamais ici : voir plus haut.
        vTint = uColor;
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        // Position de l'instance dans l'espace de la vue, puis panneau dressé
        // dans le plan de l'écran : le halo garde sa taille et sa forme quel
        // que soit l'angle.
        #ifdef USE_INSTANCING
          vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float scale = length(instanceMatrix[0].xyz);
        #else
          vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float scale = 1.0;
        #endif
        centre.xy += position.xy * scale;
        gl_Position = projectionMatrix * centre;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        // Décroissance en puissance et non linéaire : un halo a un cœur dense
        // et une frange longue, l'inverse d'un dégradé droit.
        float falloff = pow(max(0.0, 1.0 - r), 2.6);
        if (falloff <= 0.001 || uOpacity <= 0.001) discard;
        gl_FragColor = vec4(vTint * falloff, falloff * uOpacity);
      }
    `,
  });
  material.name = 'furniture-glow';
  return material;
}

/**
 * Nappe de lumière au sol, sous un lampadaire : un disque horizontal.
 *
 * ## Pourquoi une nappe plutôt qu'une lumière
 *
 * Le reproche fait aux lampadaires était juste : ils portaient un halo, donc on
 * voyait *la lampe*, mais rien n'était **éclairé**. La correction évidente —
 * une `PointLight` par mât — est impraticable : le nombre de lumières de la
 * scène entre dans la clé de programme de tous les matériaux, donc en ajouter
 * une par lampadaire recompilerait tout le décor à chaque reconstruction.
 *
 * La scène porte donc deux vraies lumières mobiles, accrochées aux deux
 * lampadaires les plus proches (`furnitureLayer.advanceLamps`) — nombre fixe,
 * clé de programme stable —, et **toutes** les têtes portent en plus cette
 * nappe additive posée à plat. C'est ce qui donne la flaque de lumière sur le
 * bitume, qui est ce qu'on regarde quand on roule de nuit.
 *
 * Le disque est dans le plan (x, z) et n'écrit pas la profondeur : deux flaques
 * qui se recouvrent s'additionnent, comme deux lampes.
 */
export function createLightPoolGeometry(THREE) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.name = 'furniture-light-pool';
  return geometry;
}

/** Matière de la nappe : additive, radiale, sans écriture de profondeur. */
export function createLightPoolMaterial(THREE, { color = [1, 0.84, 0.56] } = {}) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    // Comme le halo : c'est justement dans la brume qu'une flaque de lumière se
    // voit le mieux, la fondre dans le brouillard reviendrait à l'éteindre.
    fog: false,
    uniforms: {
      uColor: { value: new THREE.Vector3(...color) },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 local = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * local;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        // Décroissance plus douce que celle du halo : une flaque au sol s'étale,
        // là qu'un halo dans l'air a un cœur dense.
        float falloff = pow(max(0.0, 1.0 - r), 1.9);
        if (falloff <= 0.002 || uOpacity <= 0.002) discard;
        gl_FragColor = vec4(uColor * falloff, falloff * uOpacity);
      }
    `,
  });
  material.name = 'furniture-light-pool';
  return material;
}
