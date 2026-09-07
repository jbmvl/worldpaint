/*
 * kit — l'assembleur de volumes, seul.
 * -----------------------------------
 * Extrait de `furnitureKit`, qui le portait avec les soixante pièces de son
 * catalogue. La raison du découpage est banale et suffisante : les modèles
 * s'écrivent par familles (mobilier, faune, demain autre chose) et chacune
 * grossit ; l'assembleur, lui, ne bouge plus. Le garder dans le fichier d'une
 * famille obligeait toutes les autres à en dépendre.
 *
 * `furnitureKit` réexporte `Kit` et `polygonPoints` : rien de ce qui importait
 * ces noms depuis là n'a eu à changer.
 *
 * Trois primitives (boîte, cylindre, plan) assemblées en triangles non
 * indexés à facettes franches — elles accrochent la lumière mieux qu'un
 * lissage, à la taille où le décor est vu.
 *
 * Repère de chaque objet : origine au pied, +Y vers le haut, +Z vers l'avant,
 * mètres réels.
 */

import { defaultTheme } from '../themes/default.js';

/** Nom de l'attribut de sommet qui marque les pales d'éolienne. */
export const ROTOR_SPIN_ATTRIBUTE = 'aSpin';

/**
 * Suite déterministe dans [0, 1[, pour les formes irrégulières du catalogue.
 * Graine fixée par la pièce (pas par le placement) : toutes les instances
 * d'un même rocher partagent la même silhouette, une géométrie unique.
 */
export function seededUnit(seed) {
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
   * Tronc à section rectangulaire, effilé : la même boîte, mais la face du
   * dessus peut être plus étroite que celle du bas et décalée.
   *
   * C'est la primitive de toute l'anatomie (`animalKit`) : un flanc, une
   * cuisse, un museau, un canon de patte sont des troncs qui s'affinent. Une
   * boîte droite les rendait tous cubiques — c'est très exactement ce qui
   * faisait lire « caisse à pattes » plutôt qu'« animal ».
   *
   * @param {number} options.width      Largeur en bas.
   * @param {number} options.depth      Profondeur en bas.
   * @param {number} [options.widthTop] Largeur en haut (défaut : `width`).
   * @param {number} [options.depthTop] Profondeur en haut (défaut : `depth`).
   * @param {number} [options.shiftY]   Décalage vertical de la face du dessus.
   * @param {number} [options.shiftZ]   Décalage en Z de la face du dessus —
   *        c'est lui qui donne à une cuisse ou à un chanfrein son inclinaison
   *        sans qu'on ait à faire tourner la pièce entière.
   * @param {number} [options.shiftX]   Décalage en X de la face du dessus.
   */
  taper({
    width,
    height,
    depth,
    widthTop = null,
    depthTop = null,
    shiftX = 0,
    shiftZ = 0,
    color,
    colorTop = null,
    spin = 0,
    ...t
  }) {
    const wt = widthTop ?? width;
    const dt = depthTop ?? depth;
    const top = colorTop || color;
    const p = (x, y, z) => Kit.transform([x, y, z], t);

    const a = p(-width / 2, 0, -depth / 2);
    const b = p(width / 2, 0, -depth / 2);
    const c = p(width / 2, 0, depth / 2);
    const d = p(-width / 2, 0, depth / 2);
    const e = p(shiftX - wt / 2, height, shiftZ - dt / 2);
    const f = p(shiftX + wt / 2, height, shiftZ - dt / 2);
    const g = p(shiftX + wt / 2, height, shiftZ + dt / 2);
    const h = p(shiftX - wt / 2, height, shiftZ + dt / 2);

    this.quad(d, c, g, h, color, spin);
    this.quad(b, a, e, f, color, spin);
    this.quad(c, b, f, g, color, spin);
    this.quad(a, d, h, e, color, spin);
    this.quad(h, g, f, e, top, spin);
    this.quad(a, b, c, d, color, spin);
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

  /**
   * Crochet des sous-classes : elles y posent les attributs qui leur sont
   * propres (`animalKit` y met le membre, le pivot et le masque de robe).
   * Vide ici — le mobilier n'a que ses positions, ses normales et ses
   * couleurs.
   */
  decorate() {}

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
    this.decorate(THREE, geometry);
    geometry.computeBoundingSphere();
    geometry.name = name;
    return geometry;
  }
}
