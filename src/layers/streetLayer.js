/*
 * streetLayer — la voirie : caniveau, bordure, trottoir.
 * ------------------------------------------------------
 * Une zone résidentielle sortait comme un aplat minéral autour des maisons. Le
 * gris venait de la carte d'occupation du sol (voir `groundClassFor`, qui ne le
 * peint plus), mais l'aplat ne venait pas que de là : il venait de ce que la
 * chaussée s'arrêtait net sur le sol, sans rien entre les deux. Or ce qu'on
 * reconnaît d'une rue n'est pas son bitume — c'est sa **bordure**. Une route de
 * campagne et une rue de village ont le même revêtement ; ce qui les sépare
 * tient en quatorze centimètres de béton.
 *
 * Cette couche compose donc, le long des chaussées qui le méritent, la section
 * complète d'une rue :
 *
 *     chaussée │ caniveau │ bordure │ trottoir │ jupe
 *              └ creux    └ marche  └ plat     └ enterré
 *
 * ## Ce qu'elle refuse de faire
 *
 * Elle ne pose **pas** un trottoir partout où `landuse=residential`. Ce serait
 * refaire l'erreur qu'elle corrige, à un objet près : un périmètre résidentiel
 * contient des prés, des chemins de fond de parcelle et des routes de sortie de
 * bourg qui n'ont jamais été bordées. Trois conditions doivent tenir
 * **ensemble**, ligne par ligne et côté par côté :
 *
 *   1. **la chaussée s'y prête** — une rue est une voie de desserte ou une
 *      traversée ; une voie rapide n'a pas de trottoir, un chemin
 *      d'exploitation ni un sentier non plus ;
 *   2. **le périmètre l'autorise** — la ligne tombe dans une emprise habitée
 *      (`settlement.pointInAreas`) ;
 *   3. **le bâti le confirme** — il y a réellement des maisons de ce côté-ci de
 *      la route (`settlement.FabricIndex`). C'est la condition qui manquait, et
 *      c'est elle qui fait la différence entre une traversée de bourg et la
 *      route qui longe le stade du même bourg.
 *
 * S'y ajoute une quatrième, tirée du relief : pas de trottoir sur un devers
 * marqué. Une bordure y serait un mur de soutènement, et le mobilier en pose
 * déjà un — voir `furnitureLayer._buildRoadsideRelief`.
 *
 * Et une cinquième, tirée des **autres** chaussées : un trottoir se pose à deux
 * ou trois mètres de la rive de sa rue, ce qui le met en plein sur la chaussée
 * voisine dès que deux rues se longent ou se rejoignent en Y. Chaque ligne
 * sonde donc l'emprise à l'endroit où le trottoir irait réellement, sa propre
 * chaussée exceptée — la même règle, et le même mécanisme, que la haie de
 * bas-côté du mobilier.
 *
 * ## Le côté est décidé par le lieu, pas par le découpage
 *
 * Chaque côté est jugé **séparément**, et sur un disque de bâti centré à
 * quinze mètres de l'axe, du côté examiné. Une rue bâtie d'un seul côté n'a
 * donc de trottoir que de ce côté-là, ce qui est le cas le plus fréquent en
 * entrée de village. Le critère ne dépend que de coordonnées au sol : il donne
 * la même réponse quel que soit l'endroit où le découpage a coupé la chaîne, et
 * le trottoir ne change donc pas de bord d'une reconstruction à l'autre.
 *
 * ## Le trottoir est posé sur la plate-forme, pas sur le terrain
 *
 * C'est ce qui le rend solidaire de la rue plutôt que posé à côté d'elle : il
 * reçoit le `platform` du tronçon — l'altitude déjà dressée de niveau et
 * lissée sur laquelle roule l'observateur — et le décollement exact de la
 * chaussée (`roadLiftFor`). Bordure et chaussée ne peuvent donc pas diverger,
 * même sur un dos-d'âne ou dans un raccord de carrefour.
 *
 * ## Le coût
 *
 * Sept sommets de section, un balayage par portion continue, tout fusionné dans
 * un maillage unique refait avec le réseau routier. La section est
 * volontairement pauvre : un trottoir stylisé se lit à sa marche et à son
 * ombre, pas à son nombre de facettes.
 */

import { appendProfile, createProfileBuffer, toColoredGeometry } from './ribbonGeometry.js';
import { roadLiftFor } from './roadNetwork.js';
import { RoadIndex } from './roadGraph.js';
import { contiguousRuns, crossSlope, randomAt, STEEP_CROSS_SLOPE } from './furniturePlacement.js';
import { pointInAreas } from './settlement.js';
import { inCorridor } from './roadCorridor.js';
import { streetSurfaceAt } from './townStyle.js';
import { defaultTheme } from '../themes/default.js';

/**
 * Chaussées qui peuvent porter un trottoir.
 *
 * Une voie rapide en est exclue par nature — on n'y marche pas —, un chemin et
 * un sentier parce qu'ils ne sont pas revêtus, une piste cyclable parce qu'elle
 * *est* déjà l'aménagement. Reste ce qui dessert des maisons.
 */
export const STREET_PROFILES = new Set(['major', 'minor', 'lane']);

/**
 * Portée de la voirie, en mètres.
 *
 * Une bordure cesse d'être lisible bien avant, mais la portée n'est pas fixée
 * par la lisibilité : elle doit dépasser la distance parcourue entre deux
 * reconstructions (250 m pour les chaussées) **plus** ce qu'on veut voir, sinon
 * le trottoir s'arrêterait net devant l'observateur à la fin de chaque
 * intervalle. C'est la même règle que pour le mobilier, à une échelle plus
 * modeste — un trottoir ne se voit pas à sept cents mètres.
 */
export const STREET_RADIUS_M = 450;
/** Décalage du disque de lecture du bâti, au-delà de la rive. */
export const STREET_PROBE_M = 15;
/** Rayon de ce disque. Un front bâti de village tient dans trente mètres. */
export const STREET_FABRIC_RADIUS_M = 30;
/** Bâtiments exigés dans le disque. Deux : une maison isolée ne fait pas une rue. */
export const STREET_FABRIC_MIN = 2;
/**
 * Devers au-delà duquel la bordure deviendrait un mur de soutènement.
 *
 * C'est **le seuil du mobilier**, repris tel quel et non recopié : au-delà,
 * `furnitureLayer` habille déjà la rive d'un mur de déblai ou de remblai, et
 * poser une bordure par-dessus donnerait deux ouvrages pour une seule rive.
 */
export const STREET_MAX_CROSS_SLOPE = STEEP_CROSS_SLOPE;
/** Lignes contiguës exigées : en deçà, c'est un artefact du découpage. */
export const STREET_MIN_RUN = 5;

/**
 * Vrai si un côté de chaussée mérite sa bordure, à cet endroit.
 *
 * Les trois conditions sont réunies ici et nulle part ailleurs, pour qu'on
 * puisse les lire d'un bloc — et les tester sans monter une scène. Fonction
 * pure.
 *
 * @param {Object} context
 * @param {boolean} context.builtUp    La ligne est dans une emprise habitée.
 * @param {number} context.buildings   Bâtiments comptés du côté examiné.
 * @param {number} context.crossSlope  Pente en travers, sans dimension.
 * @returns {boolean}
 */
export function kerbQualifies({ builtUp = false, buildings = 0, crossSlope = 0 } = {}) {
  if (!builtUp) return false;
  if (buildings < STREET_FABRIC_MIN) return false;
  return Math.abs(crossSlope) <= STREET_MAX_CROSS_SLOPE;
}

/**
 * Largeur du trottoir en un point, en mètres.
 *
 * Tirée du lieu et non de la portion : deux reconstructions successives
 * donnent la même largeur au même endroit, et une rue ne change pas de gabarit
 * quand on revient sur ses pas. Fonction pure.
 */
export function walkWidthAt(x, z, streets = defaultTheme.streets) {
  const [min, max] = streets.walkWidth;
  return min + randomAt(x, z, 197) * (max - min);
}

/**
 * Section d'une rue, d'un côté, en mètres dans le repère (travers, hauteur).
 *
 * `up` se compte **depuis la surface de la chaussée**, pas depuis le terrain :
 * l'appelant passe le décollement de la chaussée en `lift`, donc le zéro de
 * cette section est le bitume sur lequel on roule. Un caniveau creuse donc en
 * négatif et une bordure monte en positif, exactement comme on les mesure.
 *
 * `side` vaut +1 à gauche de la marche et -1 à droite. Les sommets sont émis
 * dans l'ordre inverse à droite : la section reste ainsi parcourue dans le même
 * sens de rotation des deux côtés, donc les normales sortent du même côté.
 *
 * Fonction pure.
 *
 * @param {Object} options
 * @param {number} options.halfWidth  Demi-largeur de la chaussée.
 * @param {number} options.walkWidth  Largeur du trottoir.
 * @param {number} options.side       +1 ou -1.
 * @param {Object} options.tones      Retour de `streetSurfaceAt`.
 * @param {Object} [streets]          Tranche `theme.streets`.
 * @returns {Array<{across:number, up:number, color:number[]}>}
 */
export function kerbProfile({ halfWidth, walkWidth, side, tones }, streets = defaultTheme.streets) {
  const { gutterWidth, gutterDepth, kerbHeight, kerbNose, walkFall, skirtWidth, skirtDepth } = streets;

  // Le fil d'eau est un peu plus sombre que la bordure au-dessus : c'est là que
  // l'eau et la terre s'accumulent, et cette ligne sombre est la moitié de ce
  // qui fait lire un caniveau.
  const gutterEdge = tones.gutter.map((c, i) => c * 0.5 + tones.kerb[i] * 0.12);
  // La face de la bordure prend le jour de biais : plus sombre que son dessus,
  // sans quoi la marche disparaît sous un soleil haut.
  const kerbFace = tones.kerb.map((c) => c * 0.78);

  const foot = halfWidth - 0.06; // léger recouvrement : pas de fente à la rive
  const lip = halfWidth + gutterWidth;

  const section = [
    // Le recouvrement de la chaussée, au ras du bitume.
    { across: foot, up: -0.004, color: tones.gutter },
    // Le fil d'eau.
    { across: halfWidth + gutterWidth * 0.55, up: -gutterDepth, color: gutterEdge },
    // Le pied de bordure.
    { across: lip, up: -0.008, color: tones.gutter },
    // La face de bordure, verticale : c'est elle qui porte l'ombre.
    { across: lip, up: kerbHeight, color: kerbFace },
    // Le nez, chanfreiné.
    { across: lip + kerbNose, up: kerbHeight + 0.004, color: tones.kerb },
    // Le dessus du trottoir, en contre-pente vers le caniveau.
    { across: lip + kerbNose + walkWidth, up: kerbHeight + 0.004 + walkFall, color: tones.walk },
    // La jupe arrière, enterrée : un bord de trottoir en l'air se voit de loin.
    { across: lip + kerbNose + walkWidth + skirtWidth, up: -skirtDepth, color: tones.joint },
  ];

  const signed = section.map((vertex) => ({ ...vertex, across: vertex.across * side }));
  return side >= 0 ? signed : signed.reverse();
}

/**
 * Décalage et demi-largeur de la bande revêtue, pour l'index publié.
 *
 * L'herbe ne doit pas pousser au travers du trottoir, et elle n'a aucun moyen
 * de le savoir seule : ce que la couche publie, c'est cette bande-là. Fonction
 * pure.
 */
export function pavementBand({ halfWidth, walkWidth, side }, streets = defaultTheme.streets) {
  const inner = halfWidth;
  const outer = halfWidth + streets.gutterWidth + streets.kerbNose + walkWidth;
  return { offset: side * ((inner + outer) / 2), halfWidth: (outer - inner) / 2 };
}

/**
 * Vrai si le trottoir de ce côté-ci empiéterait sur une **autre** chaussée.
 *
 * Un trottoir se pose à deux ou trois mètres de la rive de sa rue. Dès que deux
 * rues se longent ou se rejoignent en Y, c'est en plein sur la chaussée voisine
 * qu'il atterrit — et ça se voit d'autant plus qu'il est clair et qu'il porte
 * une bordure. La question est donc posée là où le trottoir irait réellement,
 * sa propre chaussée exceptée : celle-là, il la borde, c'est sa place.
 *
 * La bande sondée est la **plus large** que ce côté puisse porter. La largeur
 * réellement tirée dépend de la portion, qui n'existe pas encore quand on juge
 * ligne par ligne ; refuser un trottoir un peu trop souvent est le seul sens
 * dans lequel se tromper ne se voit pas.
 *
 * C'est la chaussée stricte qui est interrogée, pas l'emprise : un trottoir
 * dont la jupe mord l'accotement d'à côté est enterré, il ne se voit pas.
 *
 * Fonction pure.
 *
 * @param {Object} at Point de l'axe (`x`, `z`), sa perpendiculaire (`px`, `pz`),
 *        la demi-largeur de la chaussée, le côté, et le tronçon qui la porte.
 * @param {Object|null} roadIndex `RoadIndex` des chaussées.
 * @param {Object} [streets] Section `streets` du thème.
 * @returns {boolean}
 */
export function pavementOnOtherRoad(
  { x, z, px, pz, halfWidth, side, segment = null },
  roadIndex,
  streets = defaultTheme.streets
) {
  if (!roadIndex) return false;
  const band = pavementBand({ halfWidth, walkWidth: streets.walkWidth[1], side }, streets);
  const others = segment ? (other) => other !== segment : null;
  // Les deux rives de la bande et son milieu : une chaussée qui la coupe le
  // fait par un bord ou par le travers, jamais autrement.
  const inner = band.offset - side * band.halfWidth;
  const outer = band.offset + side * band.halfWidth;
  for (const offset of [inner, band.offset, outer]) {
    if (inCorridor(roadIndex, x + px * offset, z + pz * offset, 0, others)) return true;
  }
  return false;
}

export class StreetLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   * @param {Object} [options.theme] Direction artistique.
   */
  constructor({ THREE, scene, bubble, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.disposed = false;
    this.mesh = null;
    this.geometry = null;
    /** Portions de trottoir posées lors de la dernière reconstruction. */
    this.count = 0;
    /**
     * Bande revêtue, au format de `RoadIndex` : l'herbe l'interroge comme elle
     * interroge la chaussée. Réutiliser l'index routier plutôt que d'en écrire
     * un second évite deux façons de répondre à la même question.
     * @type {RoadIndex|null}
     */
    this.index = null;

    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      // Le caniveau recouvre la rive de la chaussée de six centimètres : sans
      // décalage de profondeur, les deux se disputeraient le pixel. Le
      // recouvrement est voulu — c'est ce qui évite une fente à la rive — et le
      // décalage tranche en faveur de la bordure, qui est l'ouvrage le plus
      // haut des deux.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });
    this.material.name = 'streets';
  }

  /**
   * Recompose la voirie à partir des tronçons de chaussée et de ce que la
   * géographie dit du lieu.
   *
   * @param {Array} roadSegments Tronçons publiés par `RoadNetwork`.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   * @param {Object} [context]
   * @param {Array} [context.builtUp] Emprises habitées (`collectBuiltUpAreas`).
   * @param {Object} [context.fabric] `FabricIndex` du bâti publié.
   * @param {Object} [context.roadIndex] `RoadIndex` des chaussées : un trottoir
   *        ne se pose pas sur la rue d'à côté.
   * @returns {boolean} vrai si de la voirie a été posée.
   */
  rebuild(
    roadSegments = [],
    here = { x: 0, z: 0 },
    { builtUp = [], fabric = null, roadIndex = null } = {}
  ) {
    if (this.disposed || !this.bubble?.frame) return false;

    const buffer = createProfileBuffer();
    const bands = [];
    let built = 0;

    // Sans emprise habitée ni bâti relevé, il n'y a pas de rue à composer : la
    // couche ne pose rien et le dit, plutôt que de deviner.
    if (builtUp.length > 0 && fabric && fabric.count > 0) {
      for (const segment of roadSegments) {
        if (!STREET_PROFILES.has(segment.profile)) continue;
        built += this._buildSegment(buffer, bands, segment, here, builtUp, fabric, roadIndex);
      }
    }

    this.count = built;
    this.index = bands.length > 0 ? new RoadIndex(bands, { margin: 0 }) : null;
    this._apply(buffer);
    return built > 0;
  }

  /** Les deux côtés d'un tronçon. @returns {number} portions posées. */
  _buildSegment(buffer, bands, segment, here, builtUp, fabric, roadIndex = null) {
    const { path, platform, edges, probeSpan, halfWidth, profile } = segment;
    const rows = path.length;
    if (rows < STREET_MIN_RUN || !platform || !edges) return 0;

    const frames = segment.frames;
    // Le décollement exact de la chaussée : la bordure se mesure depuis le
    // bitume, pas depuis la plate-forme nue.
    const lift = roadLiftFor(profile);
    const streets = this.theme.streets;
    let built = 0;

    // Le périmètre et le devers ne dépendent pas du côté : une seule lecture
    // pour les deux, là où le disque de bâti en demande une par côté.
    const shared = [];
    for (let r = 0; r < rows; r++) {
      const point = path[r];
      // Hors de portée, on ne lit rien : une chaîne de chaussée traverse la
      // bulle sur neuf cents mètres, et le lancer de rayon sur les emprises
      // coûte trop cher pour être fait sur ce qu'on ne verra pas.
      const inReach = Math.hypot(point.x - here.x, point.z - here.z) <= STREET_RADIUS_M;
      shared.push({
        r,
        x: point.x,
        z: point.z,
        inReach,
        builtUp: inReach && pointInAreas(builtUp, point.x, point.z),
        slope: inReach ? crossSlope(edges[r * 2], edges[r * 2 + 1], probeSpan).slope : 0,
      });
    }

    for (const side of [1, -1]) {
      const qualifies = (row) => {
        if (!row.inReach || !row.builtUp) return false;
        const px = frames[row.r * 4 + 2];
        const pz = frames[row.r * 4 + 3];

        // Pas de trottoir sur la rue d'à côté — voir `pavementOnOtherRoad`.
        const onRoad = pavementOnOtherRoad(
          { x: row.x, z: row.z, px, pz, halfWidth, side, segment },
          roadIndex,
          streets
        );
        if (onRoad) return false;

        // Disque de lecture du bâti, posé du côté examiné : c'est ce qui fait
        // qu'une rue bâtie d'un seul côté n'est bordée que de ce côté-là.
        const reach = side * (halfWidth + STREET_PROBE_M);
        return kerbQualifies({
          builtUp: true,
          buildings: fabric.countWithin(
            row.x + px * reach,
            row.z + pz * reach,
            STREET_FABRIC_RADIUS_M,
            STREET_FABRIC_MIN
          ),
          crossSlope: row.slope,
        });
      };

      for (const run of contiguousRuns(shared, qualifies, STREET_MIN_RUN)) {
        this._appendKerb(buffer, bands, { run, segment, side, lift, streets, halfWidth });
        built++;
      }
    }

    return built;
  }

  /** Une portion continue de bordure et son trottoir. */
  _appendKerb(buffer, bands, { run, segment, side, lift, streets, halfWidth }) {
    const { platform } = segment;
    const runPath = run.map((row) => ({ x: row.x, z: row.z }));
    const deck = new Float32Array(run.map((row) => platform[row.r]));

    // Largeur et revêtement se tirent au **premier point de la portion**, donc
    // au sol : deux reconstructions rendent le même trottoir, et la commune
    // d'à côté n'a pas le même béton.
    const anchor = run[0];
    const walkWidth = walkWidthAt(anchor.x, anchor.z, streets);
    const tones = streetSurfaceAt(anchor.x, anchor.z, streets);

    appendProfile(buffer, {
      path: runPath,
      profile: kerbProfile({ halfWidth, walkWidth, side, tones }, streets),
      sampleElevation: null,
      baseHeights: deck,
      lift,
      // La plate-forme est déjà lissée par `collectRoadSegments` : la relisser
      // arrondirait la bordure dans les raccords de carrefour, là où la
      // chaussée, elle, garde son angle.
      smoothRadius: 0,
    });

    const band = pavementBand({ halfWidth, walkWidth, side }, streets);
    const frames = segment.frames;
    bands.push({
      path: run.map((row, i) => {
        const px = frames[row.r * 4 + 2];
        const pz = frames[row.r * 4 + 3];
        return {
          x: runPath[i].x + px * band.offset,
          z: runPath[i].z + pz * band.offset,
        };
      }),
      halfWidth: band.halfWidth,
    });
  }

  _apply(buffer) {
    const { THREE } = this;
    const geometry = toColoredGeometry(THREE, buffer);

    if (!geometry) {
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh = null;
        this.geometry = null;
      }
      return;
    }

    if (this.mesh) {
      this.geometry.dispose();
      this.mesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = 'streets';
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      this.scene.add(mesh);
      this.mesh = mesh;
    }
    this.geometry = geometry;
  }

  /**
   * Mouille trottoirs et caniveaux.
   *
   * La voirie est peinte par couleurs de sommet : `material.color` les
   * multiplie toutes d'un coup, donc le contraste entre la bordure et le
   * caniveau — ce qui fait lire l'ouvrage — survit intact. Un peu moins sombre
   * que la chaussée : une dalle de trottoir boit l'eau, le bitume la garde en
   * surface.
   *
   * @param {number} value De 0 (sec) à 1 (trempé).
   */
  setWetness(value) {
    const wet = Math.min(1, Math.max(0, value || 0));
    const shade = 1 - wet * 0.3;
    this.material.color.setRGB(shade, shade, shade + wet * 0.04);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.index = null;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
      this.geometry = null;
    }
    this.material.dispose();
  }
}
