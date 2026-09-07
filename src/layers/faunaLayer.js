/*
 * faunaLayer — les bêtes, et le peu de travail qu'elles coûtent par image.
 * ------------------------------------------------------------------------
 * Les animaux étaient du mobilier : posés une fois, immobiles jusqu'à la
 * reconstruction suivante, à deux cent cinquante mètres de là. Un pré en
 * était crédible sur une photo et faux dès qu'on s'arrêtait de pédaler.
 *
 * Cette couche les en sort. Elle est la sœur au sol de `lifeLayer` : même
 * principe — le peu qui doit vivre par image vit à part —, mais deux
 * différences qui décident de tout le reste.
 *
 * ## Elles sont ancrées au monde, les oiseaux non
 *
 * Un vol d'oiseaux suit l'observateur, et c'est assumé (voir `lifeLayer`) :
 * personne ne peut vérifier la position d'un oiseau. Une vache, si. Elle est
 * dans **ce** pré, elle y était au passage précédent, et elle y sera au
 * suivant. Son circuit est donc une fonction pure de sa position au sol
 * (`faunaMotion`), et le déterminisme spatial du projet tient.
 *
 * ## Elles sont articulées, les oiseaux non
 *
 * Un oiseau est deux triangles dont l'écartement suffit à faire un
 * battement. Une bête a quatre pattes, une encolure, une queue et des
 * oreilles, qui ne bougent ni ensemble ni dans le même sens.
 *
 * L'articulation ne peut pas être faite ici : un `InstancedMesh` partage une
 * géométrie, et un maillage par membre coûterait plus d'appels de dessin que
 * tout le mobilier réuni. Elle est donc **dans le shader** (voir `animalKit`
 * et `models/fauna`), et cette couche n'écrit par bête et par image que :
 *
 * - une matrice — position au sol, cap, taille ;
 * - trois flottants — où en est la foulée, de combien elle ouvre, de combien
 *   l'encolure est rabattue.
 *
 * Soit, au plafond (`FAUNA_ANIMATED_MAX`), l'ordre de grandeur du budget déjà
 * consenti à la fumée des cheminées. Ce qui coûte, dans une bête, ce n'est
 * pas de l'animer : c'est de la placer — et ça, `furnitureLayer` le fait une
 * fois tous les 250 mètres, avec le reste du décor.
 *
 * ## Le temps ne se replie pas
 *
 * `lifeLayer` ramène le sien dans une plage courte, parce que ses oiseaux
 * dérivent en fonction du temps absolu. Ici c'est interdit : la foulée se
 * déduit du **chemin parcouru**, qui croît avec le temps ; le replier ferait
 * sauter les pattes de toutes les bêtes en même temps. La précision d'un
 * flottant double reste très largement suffisante — à onze jours de marche
 * continue, l'erreur sur la phase est de l'ordre du milliardième de radian.
 */

import { defaultTheme } from '../themes/default.js';
import { createFaunaGeometries, createFaunaMaterial, FAUNA_SPECIES, FAUNA_KINDS } from '../models/fauna/index.js';
import { MOTION_ATTRIBUTE } from '../models/animalKit.js';
import { faunaStateAt } from './faunaMotion.js';

/**
 * Bêtes animées au plus, les plus proches d'abord.
 *
 * Ce n'est pas le nombre de bêtes du décor — `furnitureLayer` en pose
 * davantage sur les 700 mètres de sa bulle —, c'est le nombre de celles qui
 * bougent. Une bête écartée par ce plafond n'est pas invisible : elle est
 * hors de sa portée, donc à plus de trois cents mètres, où le mouvement ne se
 * lit plus de toute façon.
 */
export const FAUNA_ANIMATED_MAX = 240;

/** Enfoncement dans le sol, en mètres — même raison que pour le mobilier : un pied qui affleure flotte. */
export const FAUNA_SINK_M = 0.05;

/**
 * Plafond du rapport allure/pas, qui règle l'ouverture du balancier.
 *
 * Une bête au galop n'ouvre pas quatre fois plus qu'au pas : elle change
 * d'allure, ce qu'un seul balancier ne sait pas rendre. Le plafond garde le
 * mouvement lisible au lieu de faire des moulins.
 */
export const GAIT_MAX = 1.9;

/** Amplitude du balancement du corps au pas, en part de la foulée. */
export const BODY_BOB = 0.012;

export class FaunaLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} [options.theme]
   */
  constructor({ THREE, scene, theme = defaultTheme }) {
    this.THREE = THREE;
    this.scene = scene;
    this.theme = theme;
    this.disposed = false;
    this.time = 0;

    this.group = new THREE.Group();
    this.group.name = 'fauna';
    scene.add(this.group);

    const { geometries, grazeRad } = createFaunaGeometries(THREE, theme.fauna.colors);
    this.geometries = geometries;
    /** Rabattement maximal de l'encolure, par espèce — déduit du modèle. */
    this.grazeRad = grazeRad;
    this.material = createFaunaMaterial(THREE);

    /** @type {Map<string, Object>} un `InstancedMesh` par espèce. */
    this.meshes = new Map();
    /** @type {Map<string, Object[]>} les bêtes retenues, par espèce. */
    this.animals = new Map();
    /** @type {Map<string, Float32Array>} le tampon d'animation, par espèce. */
    this.motions = new Map();

    /** Robes tirées une fois pour toutes, converties en linéaire. */
    this.coats = theme.fauna.coats;

    this.counts = { placed: 0, dropped: 0 };

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._euler = new THREE.Euler();
    this._color = new THREE.Color();
  }

  /**
   * Retient les bêtes à animer : les plus proches de l'observateur, et pas
   * plus que le budget n'en porte.
   *
   * Le tri se fait sur l'**ancre** du circuit et non sur la position courante
   * de la bête : celle-ci change à chaque image, et un tri qui en dépend
   * réordonnerait les instances en permanence — c'est-à-dire ferait clignoter
   * les robes, qui sont écrites par index.
   *
   * @param {Array<Object>} list Bêtes publiées par `furnitureLayer`, chacune
   *        portant son espèce, son circuit et sa robe.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   */
  setAnimals(list, here) {
    if (this.disposed) return;
    const all = Array.isArray(list) ? list.slice() : [];
    all.sort(
      (a, b) =>
        Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z)
    );

    const kept = all.slice(0, FAUNA_ANIMATED_MAX);
    this.counts.placed = kept.length;
    this.counts.dropped = all.length - kept.length;

    const byKind = new Map();
    for (const kind of FAUNA_KINDS) byKind.set(kind, []);
    for (const animal of kept) {
      const bucket = byKind.get(animal.kind);
      // Une espèce inconnue est ignorée en silence plutôt que de faire
      // tomber la reconstruction du décor pour une bête.
      if (bucket) bucket.push(animal);
    }

    this.animals = byKind;
    for (const [kind, animals] of byKind) this._sync(kind, animals);
    // Première pose immédiate : sans elle, les bêtes restent une image
    // empilées à l'origine de la scène, comme le faisaient les oiseaux.
    this._writeFrame();
  }

  /**
   * Ajuste le maillage d'une espèce à son effectif, et y écrit les robes.
   *
   * Les robes sont écrites ici et pas dans `advance` : elles ne changent pas
   * d'une image à l'autre, et `instanceColor` est un tampon qu'il faut
   * renvoyer au GPU à chaque écriture.
   */
  _sync(kind, animals) {
    const { THREE } = this;
    let mesh = this.meshes.get(kind);

    if (animals.length === 0) {
      if (mesh) mesh.count = 0;
      return;
    }

    if (!mesh || mesh.instanceMatrix.count < animals.length) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.dispose?.();
      }
      const capacity = Math.ceil(animals.length * 1.3) + 4;
      const geometry = this.geometries[kind];
      mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
      mesh.name = `fauna-${kind}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Les bêtes se déplacent entre deux reconstructions : une sphère
      // englobante calculée à la pose serait fausse dès la seconde suivante,
      // et une bête disparaîtrait au bord du champ de vision.
      mesh.frustumCulled = false;

      // Le tampon d'animation appartient à la géométrie, qui n'est portée que
      // par ce maillage-ci : le remplacer avec lui les garde d'accord.
      const motion = new Float32Array(capacity * 3);
      geometry.setAttribute(MOTION_ATTRIBUTE, new THREE.InstancedBufferAttribute(motion, 3));
      this.motions.set(kind, motion);

      this.group.add(mesh);
      this.meshes.set(kind, mesh);
    }

    animals.forEach((animal, index) => {
      this._color.setRGB(animal.tint[0], animal.tint[1], animal.tint[2]);
      mesh.setColorAt(index, this._color);
    });
    mesh.count = animals.length;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Avance l'animation d'une image.
   * @param {number} delta Secondes écoulées.
   */
  advance(delta) {
    if (this.disposed || !Number.isFinite(delta)) return;
    this.time += delta;
    this._writeFrame();
  }

  /** Écrit une image : une matrice et trois flottants par bête. */
  _writeFrame() {
    const time = this.time;

    for (const [kind, animals] of this.animals) {
      if (animals.length === 0) continue;
      const mesh = this.meshes.get(kind);
      const motion = this.motions.get(kind);
      if (!mesh || !motion) continue;

      const spec = FAUNA_SPECIES[kind];
      const graze = this.grazeRad[kind] || 0;

      for (let i = 0; i < animals.length; i++) {
        const animal = animals[i];
        const state = faunaStateAt(animal.circuit, time);

        // Ouverture du balancier : nulle à l'arrêt, pleine au pas, un peu
        // plus au galop. C'est le même nombre qui dit « elle est immobile ».
        const gait = Math.min(GAIT_MAX, state.speed / Math.max(0.05, spec.walkMS));
        const swing = spec.swingRad * gait;
        // La foulée suit le chemin réellement parcouru, jamais le temps : une
        // bête qui ralentit ralentit ses pattes, et rien ne patine.
        const phase = (state.distance / spec.strideM) * Math.PI * 2;
        // Le corps monte et descend deux fois par foulée : c'est ce qui fait
        // qu'un quadrupède marche au lieu de glisser.
        const bob = gait > 0 ? BODY_BOB * spec.strideM * gait * Math.sin(phase * 2) : 0;

        this._position.set(state.x, state.y + bob - FAUNA_SINK_M, state.z);
        this._euler.set(0, state.heading, 0);
        this._quaternion.setFromEuler(this._euler);
        this._scale.setScalar(animal.scale);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        mesh.setMatrixAt(i, this._matrix);

        const slot = i * 3;
        motion[slot] = phase;
        motion[slot + 1] = swing;
        motion[slot + 2] = state.head * graze;
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.getAttribute(MOTION_ATTRIBUTE).needsUpdate = true;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      mesh.dispose?.();
    }
    this.meshes.clear();
    this.animals.clear();
    this.motions.clear();
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}
