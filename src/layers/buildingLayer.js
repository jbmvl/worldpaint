/*
 * buildingLayer — le bâti, extrudé depuis les tuiles vectorielles.
 * ------------------------------------------------------------------
 * Traverser un village qui n'existe qu'en photo était le manque le plus
 * visible.
 *
 * Les empreintes viennent de la couche `building` des tuiles vectorielles,
 * chargées par `vectorTileSource` **pour la bulle** — et non par interrogation
 * d'une carte 2D voisine, qui ne rendrait que ce que sa propre fenêtre a
 * chargé. La portée du décor ne dépend ainsi que du décor.
 */

import { lngToTileX, latToTileY } from '../core/tileMath.js';
import { srgb } from '../core/color.js';
import { buildingStyleAt } from './townStyle.js';
import { orientedBox, roofTriangles, roofRise, ringArea } from './roofGeometry.js';
import { defaultTheme } from '../themes/default.js';

/** Couche vectorielle portant les empreintes. */
export const BUILDING_SOURCE_LAYER = 'building';

/**
 * Rayon autour de l'observateur au-delà duquel on ignore un bâtiment, en mètres.
 * La bulle porte à ~2 km ; au-delà de ce rayon, le brouillard a déjà fondu le
 * décor dans l'horizon.
 */
export const BUILDING_RADIUS_M = 1500;
/** Déplacement de l'observateur avant reconstruction, en mètres. */
export const BUILDING_REBUILD_M = 200;
/** Hauteur retenue quand la donnée n'en porte aucune. */
export const BUILDING_DEFAULT_HEIGHT = 7;
/** Hauteur d'un niveau, quand seule `building:levels` est connue. */
export const BUILDING_LEVEL_HEIGHT = 3.2;
/** Plafond de sécurité : au-delà, la donnée est suspecte. */
export const BUILDING_MAX_HEIGHT = 120;
/**
 * Nombre maximal de bâtiments retenus par reconstruction.
 *
 * Le plafond ne protège pas le rendu — quinze cents empreintes font quelques
 * dizaines de milliers de sommets, ce qui n'est rien — mais le temps de
 * reconstruction. Il s'applique **après tri par distance** : appliqué dans
 * l'ordre d'arrivée, c'est-à-dire dans l'ordre des tuiles, il dépensait tout le
 * budget sur le coin nord-ouest de la bulle et laissait un trou juste à côté
 * de l'observateur.
 */
export const BUILDING_MAX_COUNT = 1500;

/**
 * Fenêtres allumées : portée, et plafond de panneaux.
 *
 * Une nuit sans fenêtre allumée est le moment où le décor cesse d'être crédible :
 * on traverse un village entier de blocs éteints. C'est aussi le seul éclairage
 * qui ne coûte rien — pas de lumière, pas d'ombre, juste des panneaux émissifs
 * qu'on n'allume que la nuit.
 *
 * La portée est bien plus courte que celle du bâti : à cinq cents mètres, une
 * fenêtre fait un quart de pixel, et il en faudrait des dizaines de milliers
 * pour couvrir toute la bulle.
 */
export const WINDOW_RADIUS_M = 420;
export const WINDOW_MAX_COUNT = 2600;

/**
 * Fenêtres **de jour** : portée, et plafond de baies.
 *
 * Elles sont une couche différente de celles de la nuit, et il faut le dire,
 * parce que ça ne se devine pas : la nuit, une fenêtre est une *lumière*, donc
 * un panneau additif, donc seulement celles qui sont allumées existent. Le
 * jour, une fenêtre est un *trou sombre* dans le mur — et elles existent
 * toutes. Un village de jour dont les murs sont lisses du sol à la gouttière
 * n'est pas un village, c'est un empilement de cartons, et c'était exactement
 * ce qu'on voyait.
 *
 * Ces baies-là vont donc dans la géométrie **opaque** du bâti, avec le mur
 * qu'elles percent : elles sont éclairées par le soleil comme lui, elles
 * s'assombrissent avec lui, et elles ne coûtent pas un appel de dessin de plus.
 *
 * La portée est plus courte que celle des fenêtres allumées : de jour, une baie
 * n'est qu'un contraste, et un contraste d'un demi-pixel n'est rien — là où une
 * fenêtre allumée dans la nuit se voit de loin.
 */
export const PANE_RADIUS_M = 300;
export const PANE_MAX_COUNT = 4200;

/** Débord de l'encadrement autour de la baie, en mètres. */
export const WINDOW_FRAME_M = 0.08;

/**
 * Le vitrage vu de dehors, de jour.
 *
 * Une vitre n'est pas noire et n'est pas uniforme : elle est sombre en bas, où
 * elle ne renvoie que l'intérieur de la pièce, et claire en haut, où elle
 * renvoie le ciel. Ce dégradé-là ne coûte rien — deux couleurs de sommet sur le
 * même quadrilatère — et c'est lui qui fait qu'une baie se lit comme du verre
 * plutôt que comme un rectangle de peinture.
 */
export const GLASS_DEEP = srgb('#39424c');
export const GLASS_SKY = srgb('#7f8d99');
/** L'encadrement : toujours plus clair que le mur, quel que soit le mur. */
export const WINDOW_FRAME_TINT = srgb('#f2eee4');

/**
 * Volets : largeur d'un battant en part de la baie, et part de fenêtres closes.
 *
 * Un battant ouvert vaut la moitié de la baie — c'est ce qu'il faut pour la
 * couvrir une fois refermé, et c'est ce qui donne au groupe « volet, fenêtre,
 * volet » sa proportion reconnaissable.
 *
 * Quelques fenêtres sont **fermées**, et elles comptent double : ce sont elles
 * qui donnent l'heure et la saison à une façade. Elles ne s'allument évidemment
 * pas la nuit.
 */
export const SHUTTER_WIDTH_RATIO = 0.5;
export const SHUTTER_CLOSED_SHARE = 0.14;
/**
 * Décollement du mur : encadrement, vitrage, volets. En mètres.
 *
 * Les trois plans sont espacés de trois à quatre centimètres, ce qui est plus
 * que ce qu'il faudrait pour l'œil et exactement ce qu'il faut pour le tampon
 * de profondeur : à trois cents mètres — la portée des baies — sa résolution
 * est de l'ordre du centimètre, et deux plans plus rapprochés que ça se
 * disputeraient le pixel. Les cotes restent plausibles : un volet **est** en
 * saillie sur une façade.
 */
export const WINDOW_LIFT_M = { frame: 0.04, glass: 0.075, shutter: 0.11 };

/**
 * Soubassement : hauteur de la plinthe, et sa part de la couleur du mur.
 *
 * Une vraie bande, avec une arête horizontale nette à sa cote — une arête ne
 * s'obtient pas en interpolant deux couleurs, elle s'obtient en posant deux
 * quadrilatères.
 */
export const PLINTH_HEIGHT_M = 0.62;
export const PLINTH_SHADE = 0.72;

/** Tirage déterministe dans [0, 1[ attaché à un lieu et à un rang. Pure. */
export function windowDraw(x, z, salt) {
  let h = (Math.round(x * 4) * 73856093) ^ (Math.round(z * 4) * 19349663) ^ ((salt | 0) * 83492791);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Grille de fenêtres d'un pan de mur : rangs et niveaux effectivement posables.
 *
 * Fonction pure, et séparée parce que c'est le seul endroit où une erreur
 * d'arithmétique produirait des fenêtres à cheval sur l'arête d'un mur ou
 * flottant au-dessus de la gouttière.
 *
 * @param {number} length Longueur du pan, en mètres.
 * @param {number} height Hauteur du bâtiment, en mètres.
 * @returns {{columns:number, levels:number, spacing:number}}
 */
export function windowGrid(length, height, windows = defaultTheme.windows) {
  const spacing = windows.widthM * 2.6;
  // Une marge d'un demi-entraxe à chaque bout : une fenêtre n'est jamais au ras
  // de l'angle du mur.
  const columns = Math.floor((length - spacing) / spacing);
  const levels = Math.floor((height - windows.sillM - windows.heightM) / windows.levelM) + 1;
  return { columns: Math.max(0, columns), levels: Math.max(0, levels), spacing };
}

/**
 * Pousse un panneau vertical entre deux points au sol, dans un accumulateur.
 *
 * Tout ce qui est vertical dans cette couche passe par ici : un pan de mur, une
 * bande de soubassement, un encadrement, une vitre, un battant de volet, une
 * fenêtre allumée. C'est le même quadrilatère à chaque fois, et l'enroulement
 * est la seule chose délicate — notre plan (x, z) est de chiralité opposée au
 * plan (x, y) usuel, donc l'ordre « naturel » donnerait des faces visibles
 * seulement de l'intérieur du bâtiment.
 *
 * `a` et `b` portent leurs coordonnées au sol en `x` et `y` (l'axe `y` d'un
 * `Vector2` d'empreinte, qui est le `z` de la scène).
 *
 * @param {{positions:number[], normals:number[], colors:number[]}} buffer
 * @param {{x:number, y:number}} a
 * @param {{x:number, y:number}} b
 * @param {number} bottom Cote basse.
 * @param {number} top    Cote haute.
 * @param {number} nx     Normale, composante x.
 * @param {number} nz     Normale, composante z.
 * @param {number[]} low  Couleur du bas.
 * @param {number[]} high Couleur du haut.
 */
export function pushPanel(buffer, a, b, bottom, top, nx, nz, low, high) {
  const corners = [
    [a.x, bottom, a.y, low],
    [b.x, top, b.y, high],
    [b.x, bottom, b.y, low],
    [a.x, bottom, a.y, low],
    [a.x, top, a.y, high],
    [b.x, top, b.y, high],
  ];
  for (const [x, y, z, color] of corners) {
    buffer.positions.push(x, y, z);
    buffer.normals.push(nx, 0, nz);
    buffer.colors.push(color[0], color[1], color[2]);
  }
}

/**
 * Cote du haut du soubassement, ou `null` s'il n'y a pas lieu d'en poser.
 *
 * Fonction pure. Deux cas l'écartent, et les deux se voient : une partie de
 * bâtiment **en surplomb** (`min_height`, un porche, un passage couvert) n'a pas
 * de plinthe parce qu'elle ne touche pas le sol, et un mur trop bas n'en a pas
 * non plus parce que la bande mangerait tout le mur — un abri de jardin
 * entièrement en soubassement ne ressemble à rien.
 *
 * @param {number} base      Assise du bâtiment, en mètres.
 * @param {number} minHeight Hauteur du dessous, en mètres.
 * @param {number} eaves     Cote de l'égout.
 * @returns {number|null}
 */
export function plinthTopFor(base, minHeight, eaves) {
  if (minHeight > 0.2) return null;
  const top = base + PLINTH_HEIGHT_M;
  return top < eaves - 1 ? top : null;
}

/**
 * Hauteur d'un bâtiment d'après ses attributs, en mètres.
 * Fonction pure : les schémas de tuiles varient d'un fournisseur à l'autre, et
 * c'est exactement le genre d'endroit où une régression passe inaperçue.
 */
export function buildingHeight(properties = {}) {
  const candidates = [
    properties.render_height,
    properties.height,
    properties['building:height'],
  ];
  for (const raw of candidates) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return Math.min(value, BUILDING_MAX_HEIGHT);
  }

  const levels = Number(properties.render_levels ?? properties.levels ?? properties['building:levels']);
  if (Number.isFinite(levels) && levels > 0) {
    return Math.min(levels * BUILDING_LEVEL_HEIGHT, BUILDING_MAX_HEIGHT);
  }
  return BUILDING_DEFAULT_HEIGHT;
}

/** Hauteur du dessous du bâtiment (passages couverts, `min_height`). */
export function buildingMinHeight(properties = {}) {
  const value = Number(properties.render_min_height ?? properties.min_height ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.min(value, BUILDING_MAX_HEIGHT) : 0;
}

/**
 * Aire algébrique d'un anneau (formule du lacet). Le signe donne le sens de
 * parcours, dont dépend l'orientation des murs.
 * @param {Array<[number, number]>} ring
 */
export function ringSignedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

/** Centre approximatif d'un anneau, en moyenne de ses sommets. */
export function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  // Le dernier point répète le premier dans un anneau GeoJSON fermé.
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1
    : ring.length;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

/** Extrait les anneaux extérieurs d'une géométrie GeoJSON de bâtiment. */
export function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.slice(0, 1);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((polygon) => polygon[0]).filter(Boolean);
  return [];
}

/**
 * Perce un pan de mur : encadrement, vitrage, volets — et, la nuit, la
 * lumière de celles qui sont allumées.
 *
 * ## Pourquoi tout n'est pas dans le même maillage
 *
 * Ce qui est **matière** — l'encadrement, la vitre, les volets — va dans la
 * géométrie opaque du bâti : c'est du mur, ça reçoit le soleil, ça
 * s'assombrit quand il tombe. Ce qui est **lumière** — la fenêtre allumée —
 * va dans le maillage additif, qui ne s'allume que la nuit. Mélanger les deux
 * donnerait soit des vitres qui brillent en plein jour, soit un village qui
 * ne s'allume jamais.
 *
 * ## Les décollements
 *
 * Les panneaux sont décollés du mur de quelques centimètres, en trois plans :
 * coplanaires, ils se disputeraient le pixel avec le mur et entre eux, et
 * clignoteraient. L'écart est trop petit pour se voir, et il est porté par la
 * normale du mur, donc il reste correct quelle que soit son orientation.
 *
 * ## Le déterminisme
 *
 * Quelle fenêtre est allumée, laquelle a ses volets tirés, de quelle teinte
 * est son ampoule : tout ne dépend **que de la position au sol et du rang**.
 * Le village garde donc les mêmes fenêtres allumées et les mêmes volets clos
 * d'une reconstruction à l'autre, là où un tirage libre les ferait clignoter
 * tous les 200 mètres parcourus.
 *
 * Fonction pure : elle ne lit que ses arguments, ce qui la rend testable sous
 * Node — et c'est le genre d'endroit où une erreur d'arithmétique produit une
 * fenêtre à cheval sur l'angle d'un mur ou un volet posé à l'envers.
 *
 * @param {Object} openings Budget : `{panes, budget, lit}`.
 * @param {Object} walls    Accumulateur de la géométrie opaque.
 * @param {{x:number, y:number}} a Début du pan, au sol.
 * @param {{x:number, y:number}} b Fin du pan, au sol.
 * @param {number} nx Normale sortante du mur, composante x.
 * @param {number} nz Normale sortante du mur, composante z.
 * @param {number} base      Assise du bâtiment.
 * @param {number} height    Hauteur du mur, de l'assise à l'égout.
 * @param {number} minHeight Hauteur du dessous (surplomb).
 * @param {Object} style    Habillage rendu par `buildingStyleAt`.
 * @param {Object} [look]   Dimensions de fenêtre du thème (`theme.windows`).
 */
export function appendOpenings(
  openings,
  walls,
  a,
  b,
  nx,
  nz,
  base,
  height,
  minHeight,
  style,
  look = defaultTheme.windows
) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const storeys = height - minHeight;
  if (length < 3 || storeys < look.sillM + look.heightM) return;

  const grid = windowGrid(length, storeys, look);
  if (grid.columns === 0 || grid.levels === 0) return;

  // Vecteur unitaire le long du mur, et sa normale déjà fournie.
  const ux = (b.x - a.x) / length;
  const uz = (b.y - a.y) / length;
  const half = look.widthM / 2;
  const frameHalf = half + WINDOW_FRAME_M;
  const shutterWidth = look.widthM * SHUTTER_WIDTH_RATIO;

  // Un point du mur, décalé le long de lui et décollé de lui.
  const at = (along, lift) => ({
    x: a.x + ux * along + nx * lift,
    z: a.y + uz * along + nz * lift,
  });

  for (let c = 0; c < grid.columns; c++) {
    const along = grid.spacing * (c + 1);

    for (let level = 0; level < grid.levels; level++) {
      if (openings.panes >= openings.budget) return;

      const anchor = at(along, 0);
      const sill = base + minHeight + look.sillM + level * look.levelM;
      const head = sill + look.heightM;
      const closed = style.shutters && windowDraw(anchor.x, anchor.z, level + 71) < SHUTTER_CLOSED_SHARE;

      // 1. L'encadrement : une bande claire tout autour de la baie. Sans lui,
      //    une fenêtre est un rectangle sombre collé sur un mur ; avec lui,
      //    c'est un percement. Il coûte un quadrilatère.
      const frame = at(along, WINDOW_LIFT_M.frame);
      pushPanel(
        walls,
        { x: frame.x - ux * frameHalf, y: frame.z - uz * frameHalf },
        { x: frame.x + ux * frameHalf, y: frame.z + uz * frameHalf },
        sill - WINDOW_FRAME_M,
        head + WINDOW_FRAME_M,
        nx,
        nz,
        WINDOW_FRAME_TINT,
        WINDOW_FRAME_TINT
      );

      // 2. Le vitrage — sauf volets clos, où il n'y a rien à voir derrière.
      if (!closed) {
        const glass = at(along, WINDOW_LIFT_M.glass);
        pushPanel(
          walls,
          { x: glass.x - ux * half, y: glass.z - uz * half },
          { x: glass.x + ux * half, y: glass.z + uz * half },
          sill,
          head,
          nx,
          nz,
          GLASS_DEEP,
          GLASS_SKY
        );
      }

      // 3. Les volets : deux battants, ouverts de part et d'autre de la baie,
      //    ou rabattus dessus. Seules les maisons en portent — un immeuble ou
      //    un hangar n'en a pas, et c'est ce qui les distingue de loin.
      if (style.shutters) {
        const leaf = at(along, WINDOW_LIFT_M.shutter);
        // Ouverts, les battants sont contre l'encadrement, dehors ; fermés,
        // ils se rejoignent au milieu de la baie.
        const inner = closed ? 0 : frameHalf;
        const outer = closed ? half : frameHalf + shutterWidth;
        // Les deux bornes sont **toujours** passées dans l'ordre croissant le
        // long du mur : l'enroulement de `pushPanel` en dépend, et un battant
        // pris à l'envers a sa face avant tournée vers l'intérieur — donc
        // supprimé par le tri des faces arrière, donc invisible.
        for (const [from, to] of [
          [-outer, -inner],
          [inner, outer],
        ]) {
          pushPanel(
            walls,
            { x: leaf.x + ux * from, y: leaf.z + uz * from },
            { x: leaf.x + ux * to, y: leaf.z + uz * to },
            sill - WINDOW_FRAME_M,
            head + WINDOW_FRAME_M,
            nx,
            nz,
            style.shutter,
            style.shutter
          );
        }
      }

      openings.panes++;

      // 4. La lumière. Une fenêtre aux volets clos ne s'allume pas : c'est
      //    précisément ce qu'on voit d'une rue de village la nuit.
      const lit = openings.lit;
      if (!lit || closed) continue;
      if (lit.positions.length / 9 >= WINDOW_MAX_COUNT) continue;
      const glow = at(along, WINDOW_LIFT_M.glass);
      if (windowDraw(glow.x, glow.z, level + 1) > look.litShare) continue;

      // Teinte de l'ampoule : du blanc froid au jaune franc, tirée par
      // fenêtre. Toutes de la même couleur, un village ressemble à un écran.
      const warmth = windowDraw(glow.x, glow.z, level + 41);
      const color = [0.95, 0.78 + warmth * 0.16, 0.42 + warmth * 0.3];
      pushPanel(
        lit,
        { x: glow.x - ux * half, y: glow.z - uz * half },
        { x: glow.x + ux * half, y: glow.z + uz * half },
        sill,
        head,
        nx,
        nz,
        color,
        color
      );
    }
  }
}

export class BuildingLayer {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {Object} options.bubble Instance `TerrainBubble`.
   */
  constructor({ THREE, scene, bubble, theme = defaultTheme }) {
    this.THREE = THREE;
    this.theme = theme;
    this.scene = scene;
    this.bubble = bubble;
    this.disposed = false;
    this.mesh = null;
    this.geometry = null;
    this._anchor = null;
    this._frame = null;
    this.count = 0;
    this.windowCount = 0;
    this.paneCount = 0;
    /**
     * Maisons de la dernière reconstruction, publiées pour `gardenLayer` :
     * leur centre et le rectangle orienté qui porte déjà leur toit.
     * @type {Array<{x:number,z:number,box:Object}>}
     */
    this.houses = [];

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });

    // Fenêtres allumées : un matériau à part, non éclairé et additif, dont
    // l'opacité suit l'heure. Un `MeshBasicMaterial` suffit — une fenêtre
    // allumée émet sa lumière, elle n'en reçoit pas.
    this.windowMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Le brouillard s'applique : une fenêtre à trois cents mètres dans la
      // brume doit s'y noyer comme le mur qui la porte.
      fog: true,
    });
    this.windowMaterial.name = 'building-windows';
    this.windowMesh = null;
    this.windowGeometry = null;
  }

  /** Vrai si l'observateur s'est assez éloigné pour justifier une reconstruction. */
  needsRebuild(x, z) {
    if (this._frame !== this.bubble?.frame) return true;
    if (!this._anchor) return true;
    return Math.hypot(x - this._anchor.x, z - this._anchor.z) >= BUILDING_REBUILD_M;
  }

  /**
   * Reconstruit le bâti depuis les tuiles déjà décodées.
   * @param {Object} source Instance `VectorTileSource`.
   * @param {Array} tiles   Tuiles à parcourir.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   * @returns {boolean} vrai si des bâtiments ont été produits.
   */
  rebuild(source, tiles, here) {
    if (this.disposed || !this.bubble?.frame || !source) return false;
    this._build(source, tiles, here);
    this._anchor = { x: here.x, z: here.z };
    this._frame = this.bubble.frame;
    return this.count > 0;
  }

  _build(source, tiles, here) {
    const { THREE, bubble } = this;
    const frame = bubble.frame;
    const { origin, scale, zoom } = frame;

    const walls = { positions: [], normals: [], colors: [] };
    const lamps = { positions: [], normals: [], colors: [] };
    const houses = [];
    // Les empreintes sont découpées par les tuiles : une même bâtisse revient
    // d'une tuile à l'autre. On dédoublonne sur un centre au demi-mètre, croisé
    // avec le nombre de sommets — deux bâtisses voisines peuvent partager un
    // centre arrondi, pas une silhouette.
    const seen = new Set();
    const candidates = [];

    source.forEachFeature(BUILDING_SOURCE_LAYER, tiles, (geometry, properties) => {
      for (const ring of outerRings(geometry)) {
        if (!Array.isArray(ring) || ring.length < 4) continue;

        const [cLng, cLat] = ringCentroid(ring);
        const x = (lngToTileX(cLng, zoom) - origin.x) * scale;
        const z = (latToTileY(cLat, zoom) - origin.y) * scale;
        const distance = Math.hypot(x - here.x, z - here.z);
        if (distance > BUILDING_RADIUS_M) continue;

        const key = `${Math.round(x * 2)},${Math.round(z * 2)},${ring.length}`;
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({ ring, properties, distance });
      }
    });

    // Le tri est ce qui rend le plafond acceptable : ce qui saute est toujours
    // le plus lointain, jamais ce qui est sous les yeux.
    candidates.sort((a, b) => a.distance - b.distance);
    if (candidates.length > BUILDING_MAX_COUNT) {
      console.info(
        `[buildingLayer] ${candidates.length} empreintes dans ${BUILDING_RADIUS_M} m, ` +
          `plafonnées à ${BUILDING_MAX_COUNT} — les plus lointaines sont écartées`
      );
      candidates.length = BUILDING_MAX_COUNT;
    }

    let built = 0;
    let panes = 0;
    for (const candidate of candidates) {
      // Deux portées, et elles ne sont pas les mêmes : de jour la baie n'est
      // qu'un contraste dans un mur, de nuit c'est une lumière dans le noir. La
      // seconde porte donc bien plus loin que la première.
      const openings =
        candidate.distance <= PANE_RADIUS_M && panes < PANE_MAX_COUNT
          ? {
              panes: 0,
              lit: candidate.distance <= WINDOW_RADIUS_M && lamps.positions.length / 9 < WINDOW_MAX_COUNT
                ? lamps
                : null,
              budget: PANE_MAX_COUNT - panes,
            }
          : null;
      if (this._appendBuilding(candidate.ring, candidate.properties, walls, openings, houses)) built++;
      if (openings) panes += openings.panes;
    }

    this.count = built;
    this.paneCount = panes;
    this.windowCount = lamps.positions.length / 9;
    this.houses = houses;
    this._applyWindows(lamps);
    if (walls.positions.length === 0) {
      this._clearMesh();
      return;
    }

    const geometryBuffer = new THREE.BufferGeometry();
    geometryBuffer.setAttribute('position', new THREE.Float32BufferAttribute(walls.positions, 3));
    geometryBuffer.setAttribute('normal', new THREE.Float32BufferAttribute(walls.normals, 3));
    geometryBuffer.setAttribute('color', new THREE.Float32BufferAttribute(walls.colors, 3));
    geometryBuffer.computeBoundingSphere();

    if (this.mesh) {
      this.geometry.dispose();
      this.mesh.geometry = geometryBuffer;
    } else {
      const mesh = new THREE.Mesh(geometryBuffer, this.material);
      mesh.name = 'buildings';
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      this.scene.add(mesh);
      this.mesh = mesh;
    }
    this.geometry = geometryBuffer;
  }

  /**
   * @param {Object} walls Accumulateur de la géométrie opaque — murs, toits,
   *        et les baies de jour, qui sont du mur percé et non de la lumière.
   * @param {Object|null} openings Budget d'ouvertures, ou `null` pour un
   *        bâtiment trop lointain pour en mériter.
   * @param {Array} houses Maisons publiées pour la couche des jardins.
   * @returns {boolean} vrai si le bâtiment a produit de la géométrie.
   */
  _appendBuilding(ring, properties, walls, openings = null, houses = null) {
    const { THREE, bubble } = this;
    const { origin, scale, zoom } = bubble.frame;

    // Anneau en mètres locaux, sans le point de fermeture répété.
    const points = [];
    const closed =
      ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    const last = closed ? ring.length - 1 : ring.length;
    for (let i = 0; i < last; i++) {
      const [lng, lat] = ring[i];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
      points.push(new THREE.Vector2((lngToTileX(lng, zoom) - origin.x) * scale, (latToTileY(lat, zoom) - origin.y) * scale));
    }
    if (points.length < 3) return false;

    // Assise : le point le plus bas de l'empreinte. Sur une pente, poser le
    // bâtiment à l'altitude de son centre le ferait flotter d'un côté.
    let base = Infinity;
    for (const p of points) {
      const ground = bubble.surfaceElevationAtLocal(p.x, p.y) * bubble.verticalScale;
      if (ground < base) base = ground;
    }
    if (!Number.isFinite(base)) return false;

    const height = buildingHeight(properties);
    const minHeight = buildingMinHeight(properties);
    const bottom = base + minHeight - 0.6; // un peu enterré : pas de jour sous les murs
    const top = base + height;

    // Sens de parcours : il détermine de quel côté regardent les murs.
    const area = ringSignedArea(points.map((p) => [p.x, p.y]));
    const ordered = area < 0 ? points.slice().reverse() : points;

    // Couleur et forme du toit : celles du **bourg**, avec une variation par
    // maison. Voir `townStyle` — les tuiles ne portent ni matériau ni forme de
    // toit, mais la vraie régularité du bâti n'est pas à l'échelle de la maison,
    // elle est à celle du pays.
    const footprint = ordered.map((p) => ({ x: p.x, z: p.y }));
    const box = orientedBox(footprint);
    const ground = ringArea(footprint);
    const style = buildingStyleAt(
      footprint[0].x,
      footprint[0].z,
      { area: ground, height },
      this.theme.towns
    );
    const wallColor = style.wall;
    const roofColor = style.roof;

    // Publication des maisons : la couche des jardins en a besoin, et elle n'a
    // aucun moyen de les retrouver seule — c'est ici, et seulement ici, que
    // l'empreinte, l'assise et le rectangle orienté existent en même temps.
    // Rien n'est branché : `worldComposer` passe la liste, comme il passe les
    // cheminées du mobilier à `lifeLayer`.
    if (houses && box && style.house) {
      houses.push({ x: box.cx, z: box.cz, box });
    }

    // Un toit pentu prend sa hauteur **sur** le bâtiment, pas au-dessus : sinon
    // toutes les maisons grandissent d'un étage et le village change d'échelle.
    // L'égout descend donc de la hauteur du comble, dans la limite du
    // raisonnable — un bâtiment d'un seul niveau n'a pas de murs négatifs.
    const shape = box && box.fill >= 0.62 ? style.shape : 'flat';
    const rise = shape === 'flat' ? 0 : roofRise(box.short, this.theme.roofs);
    const eaves = Math.max(bottom + 2.4, top - rise);

    // Soubassement : une bande sombre, arête franche, à sa cote. Voir
    // `plinthTopFor` — il n'y en a ni sous un surplomb ni sur un mur trop bas.
    const plinthTop = plinthTopFor(base, minHeight, eaves);
    const plinthColor = wallColor.map((c) => c * PLINTH_SHADE);

    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i];
      const b = ordered[(i + 1) % ordered.length];
      let nx = b.y - a.y;
      let nz = -(b.x - a.x);
      const length = Math.hypot(nx, nz) || 1;
      nx /= length;
      nz /= length;

      // Enroulement choisi pour que la face avant regarde vers l'extérieur :
      // notre plan (x, z) est de chiralité opposée au plan (x, y) usuel, donc
      // l'ordre « naturel » donnerait des murs visibles seulement de l'intérieur.
      if (plinthTop !== null) {
        pushPanel(walls, a, b, bottom, plinthTop, nx, nz, plinthColor, plinthColor);
        pushPanel(walls, a, b, plinthTop, eaves, nx, nz, wallColor, wallColor);
      } else {
        pushPanel(walls, a, b, bottom, eaves, nx, nz, wallColor, wallColor);
      }

      if (openings) {
        appendOpenings(openings, walls, a, b, nx, nz, base, eaves - base, minHeight, style, this.theme.windows);
      }
    }

    if (shape === 'flat') {
      // Toit-terrasse : triangulation par oreilles, fournie par three. Une
      // empreinte dégénérée la fait échouer — un bâtiment sans toit vaut mieux
      // qu'une scène sans bâtiments.
      let faces = [];
      try {
        faces = THREE.ShapeUtils.triangulateShape(ordered, []) || [];
      } catch (e) {
        faces = [];
      }
      // Ordre inversé pour la même raison que les murs : la toiture doit
      // regarder le ciel.
      for (const [i0, i1, i2] of faces) {
        for (const index of [i0, i2, i1]) {
          const p = ordered[index];
          walls.positions.push(p.x, eaves, p.y);
          walls.normals.push(0, 1, 0);
          walls.colors.push(...roofColor);
        }
      }
      return true;
    }

    // Comble : faîtière, croupe ou pyramide, bâti sur le rectangle englobant
    // orienté de l'empreinte (voir `roofGeometry`).
    const roof = roofTriangles(box, eaves, shape, this.theme.roofs);
    for (let i = 0; i < roof.positions.length; i += 3) {
      walls.positions.push(roof.positions[i], roof.positions[i + 1], roof.positions[i + 2]);
      walls.normals.push(roof.normals[i], roof.normals[i + 1], roof.normals[i + 2]);
      walls.colors.push(...roofColor);
    }

    return true;
  }

  /** (Ré)alimente le maillage des fenêtres allumées. */
  _applyWindows(windows) {
    const { THREE } = this;

    if (windows.positions.length === 0) {
      this._clearWindows();
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(windows.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(windows.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(windows.colors, 3));
    geometry.computeBoundingSphere();

    if (this.windowMesh) {
      this.windowGeometry?.dispose();
      this.windowMesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.windowMaterial);
      mesh.name = 'building-windows';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      // Après les murs : un panneau additif sans écriture de profondeur doit
      // être dessiné une fois le mur en place.
      mesh.renderOrder = 6;
      mesh.visible = this.windowMaterial.opacity > 0.01;
      this.scene.add(mesh);
      this.windowMesh = mesh;
    }
    this.windowGeometry = geometry;
  }

  /**
   * Allume les fenêtres.
   * @param {number} mix 0 en plein jour, 1 en pleine nuit.
   */
  setNight(mix) {
    const value = Math.min(1, Math.max(0, Number(mix) || 0));
    this.windowMaterial.opacity = value;
    if (this.windowMesh) this.windowMesh.visible = value > 0.01;
  }

  _clearWindows() {
    if (!this.windowMesh) return;
    this.scene.remove(this.windowMesh);
    this.windowGeometry?.dispose();
    this.windowMesh = null;
    this.windowGeometry = null;
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
    this._clearWindows();
    this.material.dispose();
    this.windowMaterial.dispose();
  }
}
