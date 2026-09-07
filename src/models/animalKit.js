/*
 * animalKit — modeler une bête, et la rendre articulable.
 * ------------------------------------------------------
 * Deux problèmes que le mobilier n'a pas, et que ce module résout une fois
 * pour toutes.
 *
 * ## 1. Une bête n'est pas un empilement de boîtes
 *
 * Les animaux du catalogue étaient faits de six à douze boîtes droites. À
 * cinquante mètres c'était juste ; à quinze — la distance à laquelle un
 * cycliste croise une vache — c'était une caisse à pattes. Ce qui manque à une
 * boîte, ce n'est pas des triangles, c'est **du galbe** : un flanc se rétrécit
 * vers la croupe, un poitrail est plus profond qu'un ventre, un canon de patte
 * est plus fin qu'une cuisse.
 *
 * D'où deux primitives, et deux seulement :
 *
 * - `loft` — un corps décrit par ses **sections transversales** successives
 *   (garrot, poitrail, ventre, croupe), reliées par des facettes. Six pans
 *   suffisent à donner un dos rond et un ventre plat ;
 * - `bone` — un tronçon effilé entre deux points du plan (y, z), qui sert à
 *   tout ce qui est allongé : cuisse, canon, encolure, queue, merrain de bois.
 *
 * Le reste (oreilles, cornes, sabots, mufle) est du détail posé à la main sur
 * ces deux-là.
 *
 * ## 2. Une bête bouge, et l'instanciation l'interdit
 *
 * Un `InstancedMesh` partage **une** géométrie entre toutes ses instances : on
 * ne peut pas plier la patte d'une vache sans plier celle de toutes les
 * autres. Découper l'animal en un maillage par membre rendrait l'articulation
 * possible, au prix d'un appel de dessin par membre et par espèce — plus de
 * cent, là où tout le mobilier en coûte soixante.
 *
 * L'animation vit donc **dans le shader**, comme le vent de `groundCover` et
 * le rotor des éoliennes. Chaque sommet porte :
 *
 * - `aLimb`  — à quel membre il appartient (voir `LIMB`) ;
 * - `aPivot` — l'articulation autour de laquelle ce membre tourne, en
 *   coordonnées du modèle ;
 * - `aCoat`  — 1 s'il est de la robe, 0 s'il est d'une partie dont la couleur
 *   ne varie pas d'une bête à l'autre (sabot, corne, mufle, bois).
 *
 * Et chaque **instance** porte `aMotion = (phase, gait, graze)`, écrit par
 * `faunaLayer` à chaque image. Le shader en déduit l'angle de chaque membre.
 * Coût par bête et par image : une matrice et trois flottants — l'ordre de
 * grandeur de la fumée de `lifeLayer`, pas celui d'un squelette.
 *
 * Conséquence à ne pas défaire : **le pivot d'un membre doit être posé au
 * bon endroit**. Une patte dont le pivot est au sol tourne comme une aiguille
 * de montre au lieu de balancer depuis l'épaule, et rien dans le rendu ne le
 * signale — ça ressemble juste à une bête qui patine.
 *
 * Repère : origine au sol entre les quatre pieds, +Y en haut, +Z vers l'avant
 * (l'animal regarde vers +Z), mètres réels.
 */

import { Kit } from './kit.js';

/**
 * Les membres articulés. L'ordre compte : le shader teste des intervalles
 * (`aLimb` entre 1 et 4 = une patte), donc les quatre pattes doivent rester
 * contiguës et les antérieures avant les postérieures.
 */
export const LIMB = {
  /** Tronc, tête morte, tout ce qui ne bouge pas par rapport au corps. */
  BODY: 0,
  LEG_FRONT_LEFT: 1,
  LEG_FRONT_RIGHT: 2,
  LEG_REAR_LEFT: 3,
  LEG_REAR_RIGHT: 4,
  /** Encolure et tête d'un bloc : elles plient ensemble pour brouter. */
  HEAD: 5,
  TAIL: 6,
  EAR: 7,
};

/** Les quatre pattes, dans l'ordre où une bête les pose. */
export const LEGS = [LIMB.LEG_FRONT_LEFT, LIMB.LEG_FRONT_RIGHT, LIMB.LEG_REAR_LEFT, LIMB.LEG_REAR_RIGHT];

/** Noms des attributs de sommet propres à la faune. */
export const LIMB_ATTRIBUTE = 'aLimb';
export const PIVOT_ATTRIBUTE = 'aPivot';
export const COAT_ATTRIBUTE = 'aCoat';
/** Nom de l'attribut d'instance : (phase de foulée, amplitude, tête baissée). */
export const MOTION_ATTRIBUTE = 'aMotion';

/**
 * Couleur de robe, teintable par instance.
 *
 * Rend un gris — pas une couleur — parce que la teinte réelle vient de
 * l'instance (`setColorAt`) et que le shader **multiplie** les deux. Le
 * niveau de gris sert donc de modelé : `robe(1)` prend la teinte telle
 * quelle, `robe(0.55)` en donne une version assombrie au même endroit sur
 * toutes les bêtes — la croupe sombre d'une pie noire, l'ombre d'un ventre.
 *
 * Le drapeau voyage sur le tableau lui-même plutôt que dans un état de
 * l'assembleur : une couleur sait ainsi seule si elle est de la robe, et on
 * ne peut pas oublier de refermer un mode.
 *
 * @param {number} [shade] Modelé, de 0 (noir) à 1 (la teinte pleine).
 * @returns {number[]} Triplet marqué comme robe.
 */
export function robe(shade = 1) {
  const c = [shade, shade, shade];
  c.coat = 1;
  return c;
}

/** Assembleur d'animaux : les primitives de `Kit`, plus membres et robe. */
export class AnimalKit extends Kit {
  constructor(palette) {
    super(palette);
    /** @type {number[]} un membre par sommet. */
    this.limbs = [];
    /** @type {number[]} un pivot (x, y, z) par sommet. */
    this.pivots = [];
    /** @type {number[]} 1 si le sommet est de la robe. */
    this.coats = [];

    this._limb = LIMB.BODY;
    this._pivot = [0, 0, 0];

    /**
     * Bout du museau au repos, et articulation de l'encolure.
     *
     * Déclarés par l'espèce, ils servent à **calculer** l'angle de broutage
     * plutôt qu'à le régler à la main (voir `grazeAngleFor`). Sans eux, il
     * faudrait tenir un nombre par bête et le refaire à chaque retouche
     * d'encolure — et rien ne dirait qu'on l'a oublié, sinon une vache qui
     * broute trente centimètres au-dessus de l'herbe.
     *
     * Le museau seul est visé, et pas le point le plus bas de la tête : chez
     * un renne, ce sont les bois rabattus qui descendent le plus.
     */
    this.muzzlePoint = null;
    this.headPivot = null;
  }

  /** Déclare le bout du museau, au repos, en coordonnées du modèle. */
  muzzle(point) {
    this.muzzlePoint = point;
    return this;
  }

  /**
   * Pose ce qui suit sur un membre donné, tournant autour d'un pivot.
   *
   * @param {number} limb Un membre de `LIMB`.
   * @param {number[]} pivot Articulation `[x, y, z]` — épaule, hanche, garrot,
   *        naissance de la queue, base de l'oreille.
   * @param {Function} build Reçoit l'assembleur.
   */
  part(limb, pivot, build) {
    const limbBefore = this._limb;
    const pivotBefore = this._pivot;
    this._limb = limb;
    this._pivot = pivot;
    if (limb === LIMB.HEAD) this.headPivot = pivot;
    build(this);
    this._limb = limbBefore;
    this._pivot = pivotBefore;
    return this;
  }

  /** Comme `tri`, plus le membre, le pivot et l'appartenance à la robe. */
  tri(a, b, c, color, spin = 0) {
    const before = this.vertexCount;
    super.tri(a, b, c, color, spin);
    const coat = color && color.coat ? 1 : 0;
    for (let i = before; i < this.vertexCount; i++) {
      this.limbs.push(this._limb);
      this.pivots.push(this._pivot[0], this._pivot[1], this._pivot[2]);
      this.coats.push(coat);
    }
    return this;
  }

  /**
   * Un corps, décrit par ses sections transversales de la queue au museau.
   *
   * Chaque section est une ellipse approchée par `sides` pans, dans le plan
   * (x, y) à une cote `z` donnée. Entre deux sections voisines, un anneau de
   * facettes ; aux deux bouts, un obturateur en éventail.
   *
   * C'est la seule façon d'obtenir un galbe sans lissage : ce sont les arêtes
   * entre pans qui donnent au flanc sa lecture, et un `computeVertexNormals`
   * les effacerait.
   *
   * @param {Array<{z:number,y:number,w:number,h:number}>} sections Cote,
   *        hauteur de l'axe, demi-largeur, demi-hauteur. Au moins deux.
   * @param {number} [options.sides] Pans — 6 pour une bête ordinaire, 8 pour
   *        celles qu'on regarde de près (le cheval, l'ours).
   * @param {number} [options.roll] Rotation du corps entier autour de Z.
   */
  loft({ sections, sides = 6, color, colorBelly = null, cap = true, ...t }) {
    if (!sections || sections.length < 2) return this;
    const belly = colorBelly || color;
    const p = (x, y, z) => Kit.transform([x, y, z], t);

    // Déphasage d'un demi-pan : sans lui, un pan tombe pile sur le dos et un
    // autre pile sous le ventre, et la bête a une arête dorsale. Décalée, elle
    // a deux pans qui se rejoignent en crête — ce qu'a un vrai garrot.
    const phase = Math.PI / sides;
    const ring = (s) => {
      const out = [];
      for (let i = 0; i < sides; i++) {
        const a = phase + (i / sides) * Math.PI * 2;
        out.push(p(Math.cos(a) * s.w, s.y + Math.sin(a) * s.h, s.z));
      }
      return out;
    };

    const rings = sections.map(ring);
    for (let s = 0; s < rings.length - 1; s++) {
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        // Le bas du corps est plus sombre : un ventre ne reçoit pas le ciel.
        const a = phase + ((i + 0.5) / sides) * Math.PI * 2;
        this.quad(rings[s][i], rings[s][j], rings[s + 1][j], rings[s + 1][i], Math.sin(a) < -0.3 ? belly : color);
      }
    }

    if (cap) {
      const back = p(0, sections[0].y, sections[0].z);
      for (let i = 0; i < sides; i++) {
        this.tri(back, rings[0][(i + 1) % sides], rings[0][i], color);
      }
      const last = rings.length - 1;
      const front = p(0, sections[last].y, sections[last].z);
      for (let i = 0; i < sides; i++) {
        this.tri(front, rings[last][i], rings[last][(i + 1) % sides], color);
      }
    }
    return this;
  }

  /**
   * Tronçon effilé entre deux points du plan (y, z), à `x` constant.
   *
   * La brique de tout ce qui est allongé. `strutYZ` fait déjà ça pour la
   * crosse d'un lampadaire, mais à section constante : une patte à section
   * constante est un tube, et un tube n'a pas de genou.
   *
   * @param {{y:number,z:number}} options.from Extrémité fixe (l'épaule).
   * @param {{y:number,z:number}} options.to   Extrémité libre (le pied).
   */
  bone({ x = 0, from, to, width, depth = null, widthEnd = null, depthEnd = null, color, colorEnd = null }) {
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dy, dz);
    if (length <= 1e-6) return this;
    return this.taper({
      x,
      y: from.y,
      z: from.z,
      tilt: Math.atan2(dz, dy),
      width,
      depth: depth ?? width,
      widthTop: widthEnd ?? width,
      depthTop: depthEnd ?? depth ?? width,
      height: length,
      color,
      colorTop: colorEnd,
    });
  }

  /**
   * Une patte complète : cuisse, canon, pied — et le pivot à l'épaule.
   *
   * Le coude (ou le jarret) est ce qui distingue une patte d'un pilotis : la
   * cuisse part vers l'arrière, le canon revient vers l'avant. `bend` porte
   * cet écart, en mètres, compté vers +Z ; il est **négatif pour une patte
   * arrière**, dont le jarret pointe en arrière — c'est ce qui donne à un
   * cheval sa ligne de croupe et à un chien son allure.
   *
   * @param {number} options.limb Membre (`LIMB.LEG_*`), qui porte aussi le
   *        pivot : c'est autour de l'attache que la patte balance.
   */
  leg({
    limb,
    x,
    z,
    top,
    bend = 0.05,
    knee = 0.52,
    width,
    widthFoot = null,
    foot = null,
    footHeight = 0.1,
    color,
    footColor,
  }) {
    const thin = widthFoot ?? width * 0.62;
    const kneeY = top * (1 - knee);
    const footY = footHeight;
    return this.part(limb, [x, top, z], (k) => {
      k.bone({
        x,
        from: { y: top, z },
        to: { y: kneeY, z: z + bend },
        width,
        widthEnd: thin * 1.15,
        color,
      });
      k.bone({
        x,
        from: { y: kneeY, z: z + bend },
        to: { y: footY, z },
        width: thin * 1.15,
        widthEnd: thin,
        color,
      });
      // Sabot, patte ou serre : un talon plus large que le canon, posé au sol.
      // Sans lui la jambe se termine en pointe et la bête flotte.
      k.taper({
        x,
        z,
        width: (foot ?? thin) * 1.2,
        depth: (foot ?? thin) * 1.35,
        widthTop: foot ?? thin,
        depthTop: (foot ?? thin) * 1.1,
        height: footHeight,
        color: footColor,
      });
    });
  }

  /**
   * Paire d'oreilles, symétriques, articulées à leur base.
   *
   * Elles sont sur `LIMB.EAR` et non sur la tête : une bête qui broute garde
   * la tête au sol et remue les oreilles, c'est même à peu près le seul
   * mouvement qu'on lui voit de loin.
   */
  ears({ x, y, z, length, width, depth = null, tilt = 0, spread = 0.4, color }) {
    for (const side of [-1, 1]) {
      this.part(LIMB.EAR, [side * x, y, z], (k) => {
        k.taper({
          x: side * x,
          y,
          z,
          roll: side * spread,
          tilt,
          width,
          depth: depth ?? width * 0.5,
          widthTop: width * 0.45,
          depthTop: (depth ?? width * 0.5) * 0.5,
          height: length,
          color,
        });
      });
    }
    return this;
  }

  /** Paire de cornes recourbées : deux tronçons par côté, sur la tête. */
  horns({ x, y, z, length, width, sweep = 1, color }) {
    for (const side of [-1, 1]) {
      const midY = y + length * 0.6;
      const midZ = z - length * 0.25 * sweep;
      this.bone({
        x: side * x,
        from: { y, z },
        to: { y: midY, z: midZ },
        width,
        widthEnd: width * 0.8,
        color,
      });
      this.bone({
        x: side * x * 1.35,
        from: { y: midY, z: midZ },
        to: { y: midY + length * 0.3, z: midZ - length * 0.55 * sweep },
        width: width * 0.8,
        widthEnd: width * 0.45,
        color,
      });
    }
    return this;
  }

  /**
   * Bois de cervidé : un merrain montant et ses andouillers.
   *
   * Ce sont eux qu'on lit avant tout le reste dans un sous-bois — plus tôt
   * que la robe, plus tôt que la taille. Ils valent donc les quelques dizaines
   * de triangles qu'ils coûtent.
   *
   * @param {number} options.tines Andouillers par merrain.
   * @param {number} options.rake  Rabattement vers l'avant, en mètres au bout
   *        du merrain — nul pour un chevreuil, franc pour un renne.
   */
  antlers({ x, y, z, length, width, tines = 2, spread = 0.3, rake = 0, color }) {
    for (const side of [-1, 1]) {
      const tipY = y + length;
      const tipX = side * (x + spread * length);
      const tipZ = z + rake;
      this.bone({
        x: side * x,
        from: { y, z },
        to: { y: tipY, z: tipZ },
        width,
        widthEnd: width * 0.55,
        color,
      });
      // Le merrain penche en s'élevant : les andouillers sont posés le long de
      // la corde, pas sur une verticale, sinon ils partent du vide.
      for (let i = 0; i < tines; i++) {
        const t = 0.35 + (i / Math.max(1, tines)) * 0.5;
        const baseY = y + length * t;
        const baseZ = z + rake * t;
        const baseX = side * (x + spread * length * t);
        const grow = length * (0.4 - i * 0.08);
        this.bone({
          x: baseX,
          from: { y: baseY, z: baseZ },
          to: { y: baseY + grow * 0.55, z: baseZ + grow * 0.8 },
          width: width * 0.7,
          widthEnd: width * 0.35,
          color,
        });
      }
    }
    return this;
  }

  /**
   * Queue articulée à sa naissance, en un ou plusieurs tronçons.
   * `droop` est la part de la longueur qui tombe plutôt qu'elle ne suit le
   * corps : nulle pour un renard qui la porte à l'horizontale, franche pour un
   * cheval dont elle balaie près du sol.
   */
  tail({ y, z, length, width, widthEnd = null, droop = 0.8, tuft = null, color }) {
    const endY = y - length * droop;
    const endZ = z - length * Math.sqrt(Math.max(0, 1 - droop * droop));
    return this.part(LIMB.TAIL, [0, y, z], (k) => {
      k.bone({
        from: { y, z },
        to: { y: endY, z: endZ },
        width,
        widthEnd: widthEnd ?? width * 0.6,
        color,
      });
      // Le toupet : la vache et le cheval en ont un, le mouton non. C'est lui
      // qui fait qu'une queue se termine au lieu de s'arrêter.
      if (tuft) {
        k.taper({
          y: endY - tuft.length,
          z: endZ,
          width: tuft.width,
          depth: tuft.width,
          widthTop: tuft.width * 1.3,
          depthTop: tuft.width * 1.3,
          height: tuft.length,
          color: tuft.color || color,
        });
      }
    });
  }

  /** Les attributs propres à la faune, posés au moment de figer la géométrie. */
  decorate(THREE, geometry) {
    geometry.setAttribute(LIMB_ATTRIBUTE, new THREE.Float32BufferAttribute(this.limbs, 1));
    geometry.setAttribute(PIVOT_ATTRIBUTE, new THREE.Float32BufferAttribute(this.pivots, 3));
    geometry.setAttribute(COAT_ATTRIBUTE, new THREE.Float32BufferAttribute(this.coats, 1));
  }
}
