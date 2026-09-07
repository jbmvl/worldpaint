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
 * - quatre flottants — où en est la foulée, de combien elle ouvre, de combien
 *   l'encolure est rabattue, et si la bête trotte ou bondit.
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
 *
 * ## Deux populations, et une seule mécanique de rendu
 *
 * Le décor pose des bêtes ; l'application, elle, peut en **déclencher** une
 * (voir `WorldComposer.crossFauna`) : une traversée devant l'observateur, au
 * moment où elle le décide. Cette bête-là n'est pas déterministe — c'est un
 * événement, pas un lieu —, et c'est la seule chose qui la distingue :
 *
 * - elle porte son propre instant d'origine (`t0`), parce qu'elle commence
 *   quand on la demande et non à l'origine des temps ;
 * - son circuit ne se referme pas, donc elle se fige à l'arrivée (`finish`) au
 *   lieu de revenir d'un bond à son point de départ ;
 * - elle survit aux reconstructions du décor, et n'est oubliée qu'une fois sa
 *   traversée jouée **et** l'observateur passé au large.
 *
 * Tout le reste — matrice, foulée, encolure — est écrit par le même code.
 */

import { defaultTheme } from '../themes/default.js';
import { createFaunaGeometries, createFaunaMaterial, FAUNA_SPECIES, FAUNA_KINDS } from '../models/fauna/index.js';
import { MOTION_ATTRIBUTE, MOTION_SIZE } from '../models/animalKit.js';
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

/**
 * Part de l'allure vive à laquelle le bond est entier.
 *
 * Le bond n'est pas une autre façon de marcher : c'est ce que fait une bête
 * qui détale. En deçà, un cervidé va en diagonale comme tout le monde — et le
 * fondu entre les deux évite qu'une bête change d'allure d'une image à
 * l'autre en franchissant un seuil.
 */
export const BOUND_FULL = 0.6;

/** Hauteur du bond, en part du balancement ordinaire. */
export const BOUND_LIFT = 3.2;

/**
 * Traversées déclenchées vivantes au plus.
 *
 * Une application qui en demande à chaque événement de jeu ne doit pas pouvoir
 * remplir le pré : au-delà, la plus ancienne cède la place.
 */
export const FAUNA_CROSSING_MAX = 8;

/**
 * Distance à laquelle une traversée déjà jouée est oubliée, en mètres.
 *
 * Une bête ne s'évapore pas sous les yeux de l'observateur : elle finit sa
 * course, s'arrête, et n'est retirée que lorsqu'il est passé assez loin. C'est
 * plus large que la portée d'animation, exprès — mieux vaut garder une bête
 * immobile de trop que la faire disparaître dans le champ de vision.
 */
export const CROSSING_FORGET_M = 300;

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
    /** @type {Object[]} les bêtes du décor retenues, avant regroupement. */
    this.decor = [];
    /** @type {Object[]} les traversées déclenchées par l'application. */
    this.crossings = [];

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

    this.decor = kept;
    // Première pose immédiate : sans elle, les bêtes restent une image
    // empilées à l'origine de la scène, comme le faisaient les oiseaux.
    this._regroup();
  }

  /**
   * Déclenche la traversée d'une bête devant l'observateur.
   *
   * L'appelant fournit une bête déjà tracée — espèce, circuit, robe, taille —
   * exactement comme le mobilier en publie : cette couche ne connaît ni le
   * terrain ni les routes, et ce n'est pas ici qu'on décide où passe la
   * traversée (voir `WorldComposer.crossFauna`, qui a la bulle sous la main).
   *
   * La bête est jouée **depuis maintenant** : c'est la seule du décor dont
   * l'origine des temps ne soit pas celle du monde.
   *
   * @param {Object} animal `{ kind, x, z, circuit, tint, scale }`.
   * @returns {Object|null} La bête posée, ou `null` si l'espèce est inconnue.
   */
  addCrossing(animal) {
    if (this.disposed || !animal || !FAUNA_SPECIES[animal.kind] || !animal.circuit) return null;

    const crossing = { ...animal, t0: this.time };
    this.crossings.push(crossing);
    // La plus ancienne cède la place : une application qui en demande à chaque
    // événement ne doit pas pouvoir remplir le pré.
    while (this.crossings.length > FAUNA_CROSSING_MAX) this.crossings.shift();
    this._regroup();
    return crossing;
  }

  /** Retire une traversée avant son terme. @returns {boolean} vrai si retirée. */
  cancelCrossing(crossing) {
    const at = this.crossings.indexOf(crossing);
    if (at < 0) return false;
    this.crossings.splice(at, 1);
    this._regroup();
    return true;
  }

  /**
   * Range décor et traversées par espèce, et remet les maillages d'accord.
   *
   * Les traversées passent **après** le décor : leur rang décide de l'index
   * d'instance auquel `_sync` écrit la robe, et une bête déclenchée ne doit
   * pas décaler les autres à chaque fois qu'on en ajoute une.
   */
  _regroup() {
    const byKind = new Map();
    for (const kind of FAUNA_KINDS) byKind.set(kind, []);
    for (const animal of this.decor) {
      const bucket = byKind.get(animal.kind);
      // Une espèce inconnue est ignorée en silence plutôt que de faire
      // tomber la reconstruction du décor pour une bête.
      if (bucket) bucket.push(animal);
    }
    for (const crossing of this.crossings) byKind.get(crossing.kind)?.push(crossing);

    this.animals = byKind;
    for (const [kind, animals] of byKind) this._sync(kind, animals);
    this._writeFrame();
  }

  /**
   * Oublie les traversées jouées, une fois l'observateur passé au large.
   *
   * Les deux conditions comptent : une bête qui disparaît pendant sa course
   * est un raté visible, et une bête qui disparaît devant l'observateur l'est
   * tout autant. Sans position connue, on garde — mieux vaut une bête de trop
   * qu'une bête qui s'évapore.
   *
   * @returns {boolean} vrai si la population a changé.
   */
  _forgetCrossings(at) {
    if (this.crossings.length === 0) return false;
    const before = this.crossings.length;
    this.crossings = this.crossings.filter((crossing) => {
      const finish = crossing.circuit.finish;
      if (finish == null || this.time - crossing.t0 <= finish) return true;
      if (!at) return true;
      return Math.hypot(crossing.x - at.x, crossing.z - at.z) < CROSSING_FORGET_M;
    });
    return this.crossings.length !== before;
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
      const motion = new Float32Array(capacity * MOTION_SIZE);
      geometry.setAttribute(MOTION_ATTRIBUTE, new THREE.InstancedBufferAttribute(motion, MOTION_SIZE));
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
   *
   * @param {number} delta Secondes écoulées.
   * @param {{x:number,z:number}} [at] Position de l'observateur, qui ne sert
   *        qu'à décider quand oublier une traversée déjà jouée. Omise, aucune
   *        n'est oubliée : c'est le repli sûr.
   */
  advance(delta, at = null) {
    if (this.disposed || !Number.isFinite(delta)) return;
    this.time += delta;
    // Une population qui change remet aussi les maillages d'accord, et
    // `_regroup` écrit l'image : inutile de l'écrire deux fois.
    if (this._forgetCrossings(at)) this._regroup();
    else this._writeFrame();
  }

  /** Écrit une image : une matrice et quatre flottants par bête. */
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
        // Une traversée déclenchée commence quand on l'a demandée, et se fige
        // à l'arrivée : son circuit ne se referme pas, et le laisser courir
        // au-delà la ramènerait d'un bond à son point de départ.
        const elapsed = time - (animal.t0 || 0);
        const finish = animal.circuit.finish;
        const state = faunaStateAt(animal.circuit, finish == null ? elapsed : Math.min(elapsed, finish));

        // Ouverture du balancier : nulle à l'arrêt, pleine au pas, un peu
        // plus au galop. C'est le même nombre qui dit « elle est immobile ».
        const gait = Math.min(GAIT_MAX, state.speed / Math.max(0.05, spec.walkMS));
        const swing = spec.swingRad * gait;
        const bound = boundMix(state.speed, spec);
        // La foulée suit le chemin réellement parcouru, jamais le temps : une
        // bête qui ralentit ralentit ses pattes, et rien ne patine.
        const phase = (state.distance / spec.strideM) * Math.PI * 2;
        // Le corps monte et descend deux fois par foulée : c'est ce qui fait
        // qu'un quadrupède marche au lieu de glisser. Le bond, lui, n'est pas
        // un balancement mais une envolée par foulée — et elle ne va que vers
        // le haut, sinon la bête s'enfoncerait dans le sol à chaque battue.
        const swayed = Math.sin(phase * 2);
        const leapt = BOUND_LIFT * Math.max(0, Math.sin(phase));
        const bob =
          gait > 0 ? BODY_BOB * spec.strideM * gait * (swayed + (leapt - swayed) * bound) : 0;

        this._position.set(state.x, state.y + bob - FAUNA_SINK_M, state.z);
        this._euler.set(0, state.heading, 0);
        this._quaternion.setFromEuler(this._euler);
        this._scale.setScalar(animal.scale);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        mesh.setMatrixAt(i, this._matrix);

        const slot = i * MOTION_SIZE;
        motion[slot] = phase;
        motion[slot + 1] = swing;
        motion[slot + 2] = state.head * graze;
        motion[slot + 3] = bound;
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
    this.decor = [];
    this.crossings = [];
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}

/**
 * Part de bond d'une bête à une vitesse donnée, de 0 (trot) à 1 (bond entier).
 *
 * Deux choses en sortent, et c'est voulu qu'elles sortent du même nombre :
 * une espèce qui ne bondit pas ne bondit jamais, et une espèce qui bondit ne
 * le fait qu'une fois lancée — au pas, tout quadrupède va en diagonale.
 *
 * Fonction pure.
 *
 * @param {number} speed Vitesse au sol, en mètres par seconde.
 * @param {{bound?:boolean, walkMS:number, runMS:number}} spec Voir `FAUNA_SPECIES`.
 * @returns {number} Dans [0, 1].
 */
export function boundMix(speed, spec) {
  if (!spec?.bound) return 0;
  const from = spec.walkMS;
  const to = Math.max(from + 0.1, spec.runMS * BOUND_FULL);
  return Math.max(0, Math.min(1, (speed - from) / (to - from)));
}
