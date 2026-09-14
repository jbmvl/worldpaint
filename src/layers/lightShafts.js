/*
 * lightShafts — les rayons de soleil qui percent une houppe. Ce ne sont pas
 * des volumes éclairés : ce sont des panneaux additifs, tendus le long de
 * l'axe du soleil, qui pivotent autour de cet axe pour rester face à la
 * caméra. Aucune brume n'est requise, aucune passe supplémentaire non plus.
 *
 * ## Pourquoi ici et pas dans `environment/`
 *
 * Un rayon n'existe que sous un couvert, et c'est la carte du sol qui dit où
 * il y en a un (`groundClass.woodAt`) : le lieu décide, comme pour les arbres
 * et l'herbe. Ce qui vient du ciel — direction, couleur et force de la lumière
 * directe — est passé par le compositeur (`setSunlight`), au même titre que la
 * nuit et le vent ; cette couche ne va jamais le chercher.
 *
 * ## Trois décisions à ne pas défaire
 *
 * 1. **Le semis est un anneau autour de l'observateur** (`SHAFT_BANDS`),
 *    redistribué en marchant comme le sous-étage : un rayon est un effet de
 *    premier plan, à cent cinquante mètres il ne reste qu'un trait pâle.
 * 2. **Le pied est au sol, la trouée en l'air.** Le panneau va du sol vers le
 *    soleil, pas l'inverse : c'est ce qui fait qu'un rayon s'arrête sur la
 *    litière et que le relief le coupe (profondeur testée, jamais écrite). Sa
 *    longueur est bornée par la hauteur de la trouée (`ceilingM`) : soleil
 *    haut, un faisceau de pleine longueur sortirait du couvert par le dessus.
 * 3. **L'emprise routière n'est pas lue.** Un rayon traverse une clairière et
 *    une route comme il traverse tout le reste — c'est de la lumière, pas un
 *    objet posé au sol. La seule question est « y a-t-il une houppe au-dessus ».
 *
 * La matière n'a ni brouillard ni temps : un rayon ne bat pas, et le mélange
 * additif s'accommoderait mal du brouillard de scène (il ajouterait sa couleur
 * au lieu de l'éteindre). C'est le fondu de bande qui l'efface au loin.
 */

import { randomAt } from './furniturePlacement.js';
import { coverBand, coverBandRing, coverBandFade, coverBandsRadius } from './coverBands.js';
import { defaultTheme } from '../themes/default.js';

/**
 * L'anneau où les rayons existent. Une seule bande : contrairement à l'herbe,
 * il n'y a pas de masse à tenir au loin — un rayon lointain ne se remplace
 * pas, il s'efface. Le fondu d'entrée compte autant que celui de sortie : un
 * panneau à deux mètres de l'œil est un mur, pas un rayon.
 */
export const SHAFT_BANDS = [
  coverBand({ from: 0, to: 150, cell: 16, perCell: 2, fadeIn: 26, fadeOut: 55, salt: 733 }),
];
/** Portée des rayons, en mètres. */
export const SHAFT_RADIUS_M = coverBandsRadius(SHAFT_BANDS);
/** Plafond d'instances : un thème généreux sature ici, pas dans la mémoire. Budget d'images, pas un réglage de thème. */
export const SHAFT_COUNT = 420;
/** Déplacement de l'observateur avant redistribution, en mètres. */
export const SHAFT_REBUILD_M = 10;
/** Décollement du pied, en mètres : sans lui un rayon se coupe dans la pente qui le porte. */
export const SHAFT_FOOT_LIFT_M = 0.4;

/**
 * Part de bois en deçà de laquelle aucun rayon. Haute, et c'est le fond de
 * l'affaire : il faut une houppe fermée au-dessus pour qu'une trouée veuille
 * dire quelque chose. Une lisière laisse passer le jour partout, elle ne
 * fabrique pas de faisceau.
 */
export const SHAFT_WOOD_MIN = 0.55;

/** Rangs des tirages d'un rayon. */
const SLOT_PRESENCE = 0;
const SLOT_X = 1;
const SLOT_Z = 2;
const SLOT_LENGTH = 3;
const SLOT_WIDTH = 4;
const SLOT_GLOW = 5;
/** Tirages réservés à un rayon. Le changer redistribue tous les semis. */
export const SHAFT_SLOTS = 6;

/**
 * Part des tirages d'une maille qui donnent un rayon, de 0 à 1. Le couvert
 * entre en fondu au-dessus du seuil, sinon le bord du bois serait une
 * frontière nette entre « plein de rayons » et « aucun ». Fonction pure.
 *
 * @param {number} wood Part de bois de la maille (`groundClass.woodAt`).
 * @param {Object} look Tranche `theme.shafts`.
 * @param {Object} band Bande (`coverBand`).
 */
export function shaftShare(wood, look, band) {
  if (!(wood >= SHAFT_WOOD_MIN)) return 0;
  const cover = Math.min(1, (wood - SHAFT_WOOD_MIN) / (1 - SHAFT_WOOD_MIN));
  const perCell = (look.perHectare || 0) * ((band.cell * band.cell) / 10000);
  return Math.min(1, (perCell * cover) / band.perCell);
}

/** Longueur d'un rayon, du sol à la trouée, en mètres. Fonction pure. */
export function shaftLength(look, draw) {
  return look.minLengthM + draw * (look.maxLengthM - look.minLengthM);
}

/** Largeur d'un rayon au pied, en mètres — elle suit sa longueur. Fonction pure. */
export function shaftWidth(length, look, draw) {
  return length * look.widthRatio * (1 + (draw - 0.5) * 2 * look.widthJitter);
}

/** Quadrilatère de référence : `x` en travers du faisceau, `y` du pied (0) à la trouée (1). */
function shaftQuad(THREE) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]),
      3
    )
  );
  geometry.setIndex([0, 1, 2, 2, 3, 0]);
  return geometry;
}

function shaftMaterial(THREE) {
  const uniforms = {
    /** Direction du soleil, repère monde. Le panneau pivote autour d'elle. */
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uColor: { value: new THREE.Color(1, 1, 1) },
    /** Opacité de crête, thème et lumière du moment confondus. */
    uAmount: { value: 0 },
    /** Hauteur de la trouée au-dessus du sol, en mètres. Voir le sommet. */
    uCeiling: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false, // additif : l'ordre n'a pas à être décidé
    blending: THREE.AdditiveBlending,
    // Le panneau se retourne en suivant la caméra : lui laisser une face
    // arrière évite d'avoir à raisonner sur le sens d'enroulement.
    side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 aFoot;
      attribute vec3 aShaft; // longueur, largeur au pied, éclat propre

      uniform vec3 uSunDir;
      uniform float uCeiling;

      varying float vAlong;
      varying float vAcross;
      varying float vFacing;
      varying float vGlow;

      void main() {
        vec3 axis = normalize(uSunDir);
        // Le faisceau s'arrête à la trouée : soleil haut, un rayon de sa
        // longueur pleine sortirait du couvert et se verrait de dehors.
        float reach = min(aShaft.x, uCeiling / max(axis.y, 0.15));
        vec3 spine = aFoot + axis * (reach * position.y);

        // Panneau tourné autour de l'axe du faisceau, pas autour de la
        // verticale : c'est ce qui garde un rayon plein quel que soit le cap.
        vec3 toEye = cameraPosition - spine;
        vec3 side = cross(axis, toEye);
        float span = length(side);
        side = span > 1e-4 ? side / span : vec3(1.0, 0.0, 0.0);

        // Le faisceau s'évase en descendant : la trouée est son ouverture.
        float taper = mix(1.0, 0.55, position.y);

        vAlong = position.y;
        vAcross = position.x * 2.0;
        // Sinus de l'angle entre le regard et l'axe : le panneau s'efface
        // quand on le regarde par la tranche, au lieu de disparaître d'un coup.
        vFacing = clamp(span / max(length(toEye), 1e-4), 0.0, 1.0);
        vGlow = aShaft.z;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(spine + side * (position.x * aShaft.y * taper), 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAmount;

      varying float vAlong;
      varying float vAcross;
      varying float vFacing;
      varying float vGlow;

      void main() {
        // Section adoucie : un rayon n'a pas de bord.
        float across = 1.0 - vAcross * vAcross;
        if (across <= 0.0) discard;

        // Vif sous la trouée, éteint au sol, refermé à la source même.
        float along = smoothstep(0.0, 0.2, vAlong) * mix(0.2, 1.0, vAlong) * (1.0 - smoothstep(0.85, 1.0, vAlong));
        float alpha = across * across * along * vFacing * vGlow * uAmount;
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  return { material, uniforms };
}

/**
 * Les rayons de soleil d'un sous-bois. Un seul maillage, jamais réalloué :
 * `instanceCount` suit ce qui a été semé, comme le sous-étage des arbres.
 */
export class LightShafts {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble` — le pied d'un rayon est au sol.
   * @param {Object} [options.groundClass] Instance `GroundClassMap`. Sans elle,
   *        rien n'est semé : on ne devine pas une houppe.
   * @param {Object} [options.theme]
   */
  constructor({ THREE, scene, bubble, groundClass = null, theme = defaultTheme }) {
    this.scene = scene;
    this.bubble = bubble;
    this.groundClass = groundClass;
    this.look = theme.shafts || defaultTheme.shafts;
    this.disposed = false;

    // Groupe jamais déplacé : les positions écrites sont celles de la scène,
    // ce dont le sommet a besoin pour comparer avec `cameraPosition`.
    this.group = new THREE.Group();
    this.group.name = 'light-shafts';
    scene.add(this.group);

    const { material, uniforms } = shaftMaterial(THREE);
    this.material = material;
    this.uniforms = uniforms;
    this.uniforms.uCeiling.value = this.look.ceilingM;

    this.geometry = shaftQuad(THREE);
    this._feet = new Float32Array(SHAFT_COUNT * 3);
    this._shafts = new Float32Array(SHAFT_COUNT * 3);
    this.geometry.setAttribute(
      'aFoot',
      new THREE.InstancedBufferAttribute(this._feet, 3).setUsage(THREE.DynamicDrawUsage)
    );
    this.geometry.setAttribute(
      'aShaft',
      new THREE.InstancedBufferAttribute(this._shafts, 3).setUsage(THREE.DynamicDrawUsage)
    );
    this.geometry.instanceCount = 0;

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'light-shafts';
    this.mesh.frustumCulled = false; // toujours autour de la caméra
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.group.add(this.mesh);

    this._cells = coverBandRing(SHAFT_BANDS);
    this._anchor = null;
    this._frame = null;
  }

  /**
   * Pose la lumière directe du moment. Éteint le maillage quand il n'en arrive
   * rien — la nuit, sous un ciel bouché, ou soleil sous l'horizon.
   *
   * @param {Object} sunlight Voir `SceneEnvironment.sunlight`.
   * @param {{x:number,y:number,z:number}} sunlight.direction
   * @param {[number,number,number]} sunlight.color Couleur linéaire de la lumière directe.
   * @param {number} sunlight.amount Part de lumière directe qui arrive au sol, de 0 à 1.
   */
  setSunlight({ direction, color, amount }) {
    if (this.disposed) return;
    const tint = this.look.tint;
    this.uniforms.uSunDir.value.set(direction.x, direction.y, direction.z);
    this.uniforms.uColor.value.setRGB(color[0] * tint[0], color[1] * tint[1], color[2] * tint[2]);
    this.uniforms.uAmount.value = amount * this.look.opacity;
    this.mesh.visible = amount > 0 && this.geometry.instanceCount > 0;
  }

  /**
   * Redistribue les rayons si l'observateur s'est assez éloigné. À appeler une
   * fois par image, comme le sous-étage.
   *
   * @param {number} x Position locale de l'observateur.
   * @param {number} z
   * @returns {boolean} vrai si une redistribution a eu lieu.
   */
  update(x, z, { force = false } = {}) {
    if (this.disposed || !this.bubble?.frame) return false;

    const frameChanged = this._frame !== this.bubble.frame;
    if (!force && !frameChanged && this._anchor) {
      if (Math.hypot(x - this._anchor.x, z - this._anchor.z) < SHAFT_REBUILD_M) return false;
    }

    this._scatter(x, z);
    this._anchor = { x, z };
    this._frame = this.bubble.frame;
    return true;
  }

  /** Sème les rayons, maille par maille. */
  _scatter(centerX, centerZ) {
    const { bubble, groundClass } = this;
    const look = this.look;
    let placed = 0;

    if (groundClass) {
      // Un centre arrondi par bande : les mailles retenues ne dépendent que du sol.
      const bases = SHAFT_BANDS.map((band) => ({
        x: Math.round(centerX / band.cell),
        z: Math.round(centerZ / band.cell),
      }));

      for (const cell of this._cells) {
        if (placed >= SHAFT_COUNT) break;

        const band = SHAFT_BANDS[cell.band];
        const fade = coverBandFade(cell.distance, band);
        if (fade <= 0.02) continue;

        const base = bases[cell.band];
        const cellX = (base.x + cell.gx) * band.cell;
        const cellZ = (base.z + cell.gz) * band.cell;
        const centreX = cellX + band.cell * 0.5;
        const centreZ = cellZ + band.cell * 0.5;

        const share = shaftShare(groundClass.woodAt(centreX, centreZ), look, band);
        if (share <= 0) continue;

        for (let i = 0; i < band.perCell && placed < SHAFT_COUNT; i++) {
          const slot = i * SHAFT_SLOTS;
          if (this._draw(cellX, cellZ, band, slot + SLOT_PRESENCE) >= share) continue;

          const x = cellX + this._draw(cellX, cellZ, band, slot + SLOT_X) * band.cell;
          const z = cellZ + this._draw(cellX, cellZ, band, slot + SLOT_Z) * band.cell;
          const length = shaftLength(look, this._draw(cellX, cellZ, band, slot + SLOT_LENGTH));
          const width = shaftWidth(length, look, this._draw(cellX, cellZ, band, slot + SLOT_WIDTH));

          const o = placed * 3;
          this._feet[o] = x;
          this._feet[o + 1] =
            bubble.surfaceElevationAtLocal(x, z) * bubble.verticalScale + SHAFT_FOOT_LIFT_M;
          this._feet[o + 2] = z;
          this._shafts[o] = length;
          this._shafts[o + 1] = width;
          // L'éclat porte le fondu de bande : au bord, un rayon pâlit au lieu de s'éteindre.
          this._shafts[o + 2] =
            fade * (0.55 + this._draw(cellX, cellZ, band, slot + SLOT_GLOW) * 0.45);
          placed++;
        }
      }
    }

    this.geometry.instanceCount = placed;
    this.geometry.getAttribute('aFoot').needsUpdate = true;
    this.geometry.getAttribute('aShaft').needsUpdate = true;
    this.mesh.visible = placed > 0 && this.uniforms.uAmount.value > 0;
  }

  /** Tirage numéro `k` d'une maille, ancré au sol par le sel de la bande. */
  _draw(cellX, cellZ, band, k) {
    return randomAt(cellX, cellZ, band.salt + k);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.remove(this.mesh);
    this.scene.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
