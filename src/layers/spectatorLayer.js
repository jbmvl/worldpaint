/*
 * spectatorLayer — les spectateurs qui encouragent, joués par image.
 * -----------------------------------------------------------------
 * Ce qu'ils sont et où ils se tiennent vient de `spectatorPlacement` ; cette
 * couche ne fait que les animer : un sautillement, des bras levés qui
 * s'agitent. Une matrice par corps et par bras et par image, dans des
 * `InstancedMesh` par tenue — le nombre de tracés ne dépend pas du nombre de
 * spectateurs.
 *
 * Un groupe s'oublie de lui-même une fois l'observateur passé au large
 * (`CHEER_FORGET_M`), comme une traversée de bête : l'application n'a pas à
 * le retirer. Il s'oublie aussi quand la bulle change de repère — ses
 * coordonnées locales n'y voudraient plus rien dire.
 */

import { defaultTheme } from '../themes/default.js';
import {
  composeOutfits,
  createPersonArmGeometry,
  createPersonBodyGeometry,
  SHOULDER,
} from '../models/people.js';

/** Tenues distinctes : autant de paires de tracés. */
export const SPECTATOR_OUTFITS = 6;
/** Spectateurs affichés au plus, tous groupes confondus. */
export const SPECTATOR_MAX = 96;
/** Au-delà de cette distance à l'observateur, un groupe est oublié. */
export const CHEER_FORGET_M = 600;
/** Hauteur d'un sautillement, en mètres. */
const HOP_M = 0.1;
/** Bras levé : angle depuis la verticale basse, et amplitude de l'agitation. */
const ARM_UP_RAD = 2.7;
const ARM_WAVE_RAD = 0.35;
/** Bras au repos, légèrement écarté du corps. */
const ARM_DOWN_RAD = 0.12;

export class SpectatorLayer {
  constructor({ THREE, scene, theme = defaultTheme }) {
    this.THREE = THREE;
    this.time = 0;
    this._groups = [];
    this._frame = null;
    // Un thème qui remplace la tranche `life` sans nuancier de spectateurs garde celui par défaut.
    const outfits = composeOutfits(theme.life?.people ?? defaultTheme.life.people, SPECTATOR_OUTFITS);
    this.outfitCount = outfits.length;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.name = 'spectator';
    this._bodies = [];
    this._arms = [];
    for (const outfit of outfits) {
      const body = new THREE.InstancedMesh(createPersonBodyGeometry(THREE, outfit), this.material, SPECTATOR_MAX);
      const arm = new THREE.InstancedMesh(createPersonArmGeometry(THREE, outfit), this.material, SPECTATOR_MAX * 2);
      for (const mesh of [body, arm]) {
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        scene.add(mesh);
      }
      this._bodies.push(body);
      this._arms.push(arm);
    }
    this._m = new THREE.Matrix4();
    this._body = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  /**
   * Ajoute un groupe composé par `planCheer`. Rend une poignée à repasser à
   * `cancel`, ou `null` si le groupe est vide.
   */
  addGroup(people, frame = null) {
    if (!people.length) return null;
    if (frame && frame !== this._frame) {
      this._groups = [];
      this._frame = frame;
    }
    const x = people.reduce((sum, p) => sum + p.x, 0) / people.length;
    const z = people.reduce((sum, p) => sum + p.z, 0) / people.length;
    const group = { people, x, z };
    this._groups.push(group);
    return group;
  }

  cancel(group) {
    this._groups = this._groups.filter((g) => g !== group);
  }

  get groupCount() {
    return this._groups.length;
  }

  /**
   * @param {number} delta
   * @param {{x:number, z:number}|null} at Position de l'observateur.
   * @param {Object|null} frame Repère courant de la bulle.
   */
  advance(delta, at = null, frame = null) {
    this.time += delta;
    if (frame && this._frame && frame !== this._frame) this._groups = [];
    if (frame) this._frame = frame;
    if (at) {
      this._groups = this._groups.filter((g) => Math.hypot(g.x - at.x, g.z - at.z) <= CHEER_FORGET_M);
    }

    const bodyCounts = new Array(this.outfitCount).fill(0);
    const armCounts = new Array(this.outfitCount).fill(0);
    let shown = 0;
    for (const group of this._groups) {
      for (const person of group.people) {
        if (shown >= SPECTATOR_MAX) break;
        shown++;
        this._writePerson(person, bodyCounts, armCounts);
      }
    }
    for (let i = 0; i < this.outfitCount; i++) {
      this._bodies[i].count = bodyCounts[i];
      this._arms[i].count = armCounts[i];
      this._bodies[i].instanceMatrix.needsUpdate = true;
      this._arms[i].instanceMatrix.needsUpdate = true;
    }
  }

  _writePerson(person, bodyCounts, armCounts) {
    const t = this.time * person.rate * Math.PI * 2 + person.phase;
    const hop = Math.max(0, Math.sin(t)) * HOP_M;
    this._p.set(person.x, person.y + hop, person.z);
    this._e.set(0, person.yaw, 0);
    this._q.setFromEuler(this._e);
    this._body.compose(this._p, this._q, this._s);
    const o = person.outfit;
    this._bodies[o].setMatrixAt(bodyCounts[o]++, this._body);

    // Bras droit (x > 0) levé en premier : un spectateur à un seul bras levé l'agite de ce côté.
    for (const sideSign of [1, -1]) {
      const raised = person.arms === 2 || sideSign === 1;
      const wave = Math.sin(t * 2 + (sideSign > 0 ? 0 : 1.3)) * ARM_WAVE_RAD;
      const angle = raised ? ARM_UP_RAD + wave : ARM_DOWN_RAD;
      // Rotation autour de Z : le bras pivote dans le plan du corps, vers l'extérieur.
      this._e.set(0, 0, sideSign * angle);
      this._q.setFromEuler(this._e);
      this._p.set(sideSign * SHOULDER.x, SHOULDER.y, SHOULDER.z);
      this._m.compose(this._p, this._q, this._s).premultiply(this._body);
      this._arms[o].setMatrixAt(armCounts[o]++, this._m);
    }
  }

  dispose() {
    for (const mesh of [...this._bodies, ...this._arms]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose?.();
    }
    this.material.dispose();
    this._groups = [];
  }
}
