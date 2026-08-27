/*
 * furnitureKit — le mobilier, modelé en code.
 * -------------------------------------------
 * Un catalogue de petits volumes : lampadaire, poteau, pylône, éolienne,
 * panneau, borne, abribus, botte de foin, tas de bois, fontaine, lavoir,
 * grange, silo, hangar, piquets de clôture, bosquet, feu tricolore — et ce qui
 * donne de la vie au décor : vaches, moutons, poules, fil à linge.
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

  /** Triangle, normale déduite du sens de parcours. */
  tri(a, b, c, color) {
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
    }
    return this;
  }

  quad(a, b, c, d, color) {
    return this.tri(a, b, c, color).tri(a, c, d, color);
  }

  /**
   * Boîte centrée en (0, h/2, 0) avant transformation : une boîte posée à
   * `y = 0` repose donc sur le sol, ce qui est le cas usuel.
   */
  box({ width, height, depth, color, ...t }) {
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

    this.quad(d, c, g, h, color); // +z
    this.quad(b, a, e, f, color); // -z
    this.quad(c, b, f, g, color); // +x
    this.quad(a, d, h, e, color); // -x
    this.quad(h, g, f, e, color); // dessus
    this.quad(a, b, c, d, color); // dessous
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

  /** Éolienne : tour effilée, nacelle, trois pales. */
  windTurbine(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    const hub = 78;
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
      });
    }
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
   * sombre du train arrière. Ni les cornes ni les oreilles n'y comptent, et
   * elles doubleraient le nombre de triangles d'un objet dont on pose parfois
   * une trentaine d'exemplaires.
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
    for (const [x, z] of [[-0.22, 0.68], [0.22, 0.68], [-0.22, -0.62], [0.22, -0.62]]) {
      k.box({ width: 0.12, height: 0.74, depth: 0.13, x, z, color: C.hideDark });
    }
    // Queue : un trait, mais un trait qu'on cherche du regard.
    k.box({ width: 0.06, height: 0.62, depth: 0.06, y: 0.5, z: -0.92, color: C.hideDark });
    return k;
  },

  /** Mouton : une masse laineuse, une tête sombre, quatre pattes courtes. */
  sheep(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    k.box({ width: 0.42, height: 0.5, depth: 0.96, y: 0.42, color: C.fleece });
    k.box({ width: 0.26, height: 0.26, depth: 0.3, y: 0.36, z: 0.6, color: C.hideDark });
    for (const [x, z] of [[-0.14, 0.32], [0.14, 0.32], [-0.14, -0.32], [0.14, -0.32]]) {
      k.box({ width: 0.08, height: 0.44, depth: 0.08, x, z, color: C.hideDark });
    }
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
   * Touffe de fougères : trois frondes en éventail, hautes d'un demi-mètre.
   * C'est le remplissage de fossé et de pied de haie, là où la haie de bocage
   * serait un mur de deux mètres.
   */
  fernClump(C = DEFAULT_COLORS) {
    const k = new Kit(C);
    for (let i = 0; i < 5; i++) {
      const yaw = (i / 5) * Math.PI * 2;
      k.box({
        width: 0.5,
        height: 0.06,
        depth: 0.12,
        y: 0.34,
        yaw,
        roll: 0.9,
        color: i % 2 === 0 ? C.fern : C.leafOlive,
      });
    }
    k.cylinder({ radiusBottom: 0.16, radiusTop: 0.05, height: 0.3, radial: 5, color: C.leafDeep });
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

  /**
   * Fossé : une saignée en V asymétrique, l'aval plus court que l'amont.
   *
   * Il n'ajoute rien au-dessus du sol, il en **retire** — d'où des cotes
   * négatives. C'est la seule pièce du catalogue à descendre sous le terrain, et
   * la raison pour laquelle elle en vaut la peine : le motif fossé / bas-côté /
   * chaussée est ce qui fait lire une route départementale, bien plus qu'un
   * panneau de plus.
   */
  ditch: [
    { across: -1.15, up: 0.05, color: C.leafOlive },
    { across: -0.5, up: -0.42, color: C.stoneDark },
    { across: 0.2, up: -0.5, color: C.stoneDark },
    { across: 0.85, up: 0.02, color: C.leafOlive },
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
 */
export function createGlowMaterial(THREE, { color = [1, 0.86, 0.6], perInstanceColor = false } = {}) {
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
      ${perInstanceColor ? 'attribute vec3 instanceColor;' : ''}
      uniform vec3 uColor;
      void main() {
        vUv = uv;
        vTint = ${perInstanceColor ? 'instanceColor' : 'uColor'};
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
