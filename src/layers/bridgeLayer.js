import { appendTunnelSeams } from './tunnelSeams.js';
import { vaultProfile, PORTAL_ARC_STEPS, PORTAL_CLEARANCE_M } from './tunnelGeometry.js';
export { vaultProfile, PORTAL_ARC_STEPS, PORTAL_CLEARANCE_M } from './tunnelGeometry.js';
import { ROAD_CUT_BLEND_M } from '../terrain/roadCut.js';
import { TunnelLighting } from './tunnelLighting.js';
/*
 * bridgeLayer — ce qui porte la chaussée quand le terrain ne la porte plus :
 * tabliers, piles, culées, parapets, et les têtes des tunnels.
 *
 * Cette couche ne lit **aucune tuile**. Elle lit les tronçons publiés par
 * `roadNetwork` — leur tracé, leur plate-forme et leurs drapeaux d'ouvrage —,
 * exactement comme `streetLayer` lit les mêmes tronçons pour ses trottoirs. Il
 * n'y a donc qu'un seul endroit qui décide où passe un pont : le réseau.
 * Ses portions suspendues non cartographiées portent aussi un tablier ; les
 * dalles de carrefour ont une sous-face commune et des bouches ouvertes. Ici
 * on ne fait que l'habiller. Les appuis lisent le terrain final et laissent
 * libres les corridors inférieurs publiés par les terrassements. Les tunnels
 * lisent les enveloppes communes publiées par transportTunnels ; leurs
 * ouvertures et leur éclairage ne sont jamais dupliqués par chaussée. Les
 * coutures des portails suivent les triangles du terrain final publié.
 *
 * ## L'ouvrage n'est pas une route de plus
 *
 * `roadWorks.levelWorkSpans` a déjà tendu la plate-forme entre les deux appuis
 * de chaque travée ; le ruban de chaussée est posé dessus, et `furnitureLayer`
 * a laissé ces lignes tranquilles (ni mur de soutènement, ni talus, ni haie
 * dans le vide). Il reste à montrer **pourquoi** la route tient en l'air :
 *
 *   - le **tablier**, une section balayée sous la chaussée, corniche comprise ;
 *   - les **piles**, des voiles en travers, du terrain jusqu'à la sous-face ;
 *   - les **culées**, la même chose aux deux bouts, plus épaisses ;
 *   - les **parapets**, de part et d'autre, seule protection de la travée ;
 *   - les **têtes de tunnel** : deux piédroits, un linteau, et une voûte sombre
 *     enfoncée de quelques mètres — sans quoi la chaussée s'arrêterait net au
 *     pied de la colline.
 *
 * Tout est balayé avec `appendVariableWall` (hauteur variable : une pile fait
 * douze mètres au milieu du gave et deux à la culée) sauf le tablier et la
 * voûte, qui ont une section constante et passent par `appendProfile`.
 *
 * ## Le style vient du pays, pas de l'ouvrage
 *
 * La famille — maçonnerie, béton, acier — se tire au sol par `worksStyleAt`,
 * sur la maille qui décide déjà de la palette d'un bourg. Deux ponts d'une
 * même vallée sont donc du même bureau d'études, et un ouvrage ne change pas
 * de matériau d'une reconstruction à l'autre. Le tirage est pris **au premier
 * point de la travée**, pas au milieu : le milieu bouge avec le découpage.
 */

import {
  appendProfile,
  appendVariableWall,
  createProfileBuffer,
  toColoredGeometry,
  pathFrames,
} from './ribbonGeometry.js';
import { junctionRibbonRuns, junctionSurface, junctionDeckAt } from './roadJunctions.js';
import { ROAD_LIFT_M } from './roadNetwork.js';
import { workRuns, WORK_BRIDGE, WORK_TUNNEL } from './roadWorks.js';
import { worksStyleAt } from './townStyle.js';
import { facetJitter } from './facetJitter.js';
import { defaultTheme } from '../themes/default.js';
import { DECOR_STABLE_RADIUS_M, reachedRadius } from '../core/decorReach.js';

/** Portée des ouvrages autour du point de reconstruction, en mètres (celle de la voirie). */
export const BRIDGE_RADIUS_M = DECOR_STABLE_RADIUS_M;

/** Hauteur en deçà de laquelle une travée ne mérite ni pile ni culée (un simple ponceau). */
export const BRIDGE_MIN_RISE_M = 1.1;

/** Profondeur de la voûte enfoncée derrière une tête de tunnel, en mètres. */
export const PORTAL_DEPTH_M = 18;


/** Sel du grain d'un parapet plein (`facetJitter`). */
const PARAPET_SEED = 6143;

/**
 * Section d'un tablier, dans le repère (travers, hauteur) d'`appendProfile`.
 * L'origine est la **surface** de la chaussée : le tablier descend donc en
 * négatif, et sa face supérieure reste cachée sous le ruban.
 *
 * La sous-face est rentrante (elle ne va pas jusqu'à la corniche) : c'est ce
 * décrochement qui fait lire un ouvrage plutôt qu'une dalle, et il porte
 * l'ombre qui détache le tablier du paysage.
 *
 * @param {number} halfWidth Demi-largeur de la chaussée, en mètres.
 * @param {Object} deck Tranche `deck` d'une famille d'ouvrage (couleurs linéaires).
 * @returns {Array<{across:number, up:number, color:number[]}>}
 */
export function deckProfile(halfWidth, deck) {
  const rim = halfWidth + deck.overhang;
  const soffit = Math.max(0.4, halfWidth * 0.78);
  const edge = deck.edge;
  const under = deck.color;

  // Ordre de parcours : de la gauche de la marche vers la droite, comme toutes
  // les sections fermées du projet (rail, haie, muret). C'est lui qui décide du
  // sens des normales.
  return [
    { across: -rim, up: 0, color: edge },
    { across: -rim, up: -deck.edgeDepth, color: edge },
    { across: -soffit, up: -deck.thickness, color: under },
    { across: soffit, up: -deck.thickness, color: under },
    { across: rim, up: -deck.edgeDepth, color: edge },
    { across: rim, up: 0, color: edge },
  ];
}


export class BridgeLayer {
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
    this.counts = { spans: 0, piers: 0, portals: 0 };
    this.tunnelMouths = [];
    this.tunnelFixtures = [];

    // Une seule matière : tout est coloré au sommet. `DoubleSide` parce qu'on
    // regarde une voûte de tunnel par l'intérieur.
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    this.material.name = 'bridge-works';

    this.lighting = THREE.PointLight ? new TunnelLighting(THREE, scene, theme.tunnelLights ?? defaultTheme.tunnelLights) : null;
    this.mesh = null;
    this.geometry = null;
  }

  /**
   * Rebâtit les ouvrages depuis les tronçons publiés par le réseau.
   *
   * @param {Array<Object>} roadSegments Tronçons de `roadNetwork.roadSegments`.
   * @param {{x:number,z:number}} here Position locale de l'observateur.
   * @returns {boolean} vrai si quelque chose a été posé.
   */
  rebuild(roadSegments, here, { earthworks = null, areas = null, roadIndex = null } = {}) {
    if (this.disposed || !this.bubble?.frame) return false;

    const bubble = this.bubble;
    // Les appuis rejoignent le terrain final, sans barrer le passage creusé.
    this._earthworks = earthworks;
    this._roadIndex = roadIndex;
    const sampleElevation = (x, z) => bubble.surfaceElevationAtLocal(x, z, 0) * bubble.verticalScale;

    const buffer = createProfileBuffer();
    this.counts = { spans: 0, piers: 0, portals: 0 };
    this.tunnelMouths = [];
    this.tunnelFixtures = [];

    const radius = reachedRadius(BRIDGE_RADIUS_M, bubble);
    for (const segment of roadSegments || []) {
      if (!segment?.works || !segment.path || segment.path.length < 2) continue;
      const inReach = (run) =>
        Math.hypot(segment.path[run.from].x - here.x, segment.path[run.from].z - here.z) <= radius ||
        Math.hypot(segment.path[run.to].x - here.x, segment.path[run.to].z - here.z) <= radius ||
        segment.path.slice(run.from,run.to+1).some(p=>Math.hypot(p.x-here.x,p.z-here.z)<=radius);

      for (const run of workRuns(segment.works, WORK_BRIDGE)) {
        if (!inReach(run)) continue;
        this._buildSpan(buffer, segment, run, sampleElevation);
      }
      for (const run of workRuns(segment.supports, WORK_BRIDGE)) {
        if (!inReach(run)) continue;
        const pieces = areas ? junctionRibbonRuns(segment, areas, [run]) : [{
          path: segment.path.slice(run.from, run.to + 1), platform: segment.platform.slice(run.from, run.to + 1),
        }];
        for (const piece of pieces) {
          const origin = piece.path[0].distance;
          const frames = pathFrames(piece.path);
          let row = 0;
          piece.path.forEach((p, r) => {
            while (row + 1 < segment.path.length && segment.path[row].distance < p.distance - .000001) row++;
            if (!p.section && segment.frames && Math.abs(segment.path[row].distance - p.distance) < .000001) {
              frames.set(segment.frames.subarray(row * 4, row * 4 + 4), r * 4);
            }
          });
          const path = piece.path.map(p => ({ ...p, distance: p.distance - origin }));
          this._buildSpan(buffer, { ...segment, path, platform: piece.platform, frames },
            { from: 0, to: path.length - 1 }, sampleElevation);
        }
      }
      for (const structure of segment.tunnelStructures ?? []) {
        if (!structure.path.some(p => Math.hypot(p.x-here.x,p.z-here.z)<=radius)) continue;
        this._buildTunnelHeads(buffer, structure, { from: 0, to: structure.path.length-1 }, sampleElevation);
      }
      for (const run of segment.tunnelStructures ? [] : workRuns(segment.works, WORK_TUNNEL)) {
        if (!inReach(run)) continue;
        this._buildTunnelHeads(buffer, segment, run, sampleElevation);
      }
    }

    for (const area of areas?.areas ?? []) {
      if (!area.supported || Math.hypot(area.x - here.x, area.z - here.z) > radius) continue;
      this._buildJunctionSupport(buffer, area, sampleElevation);
    }
    this._apply(buffer);
    this.lighting?.rebuild(this.tunnelFixtures);
    this.lighting?.update(here);
    return this.counts.spans > 0 || this.counts.portals > 0;
  }

  /** Le tracé d'une plage de lignes, distances remises à zéro à son début. */
  _runPath(segment, run) {
    const origin = segment.path[run.from].distance;
    const out = [];
    for (let r = run.from; r <= run.to; r++) {
      out.push({ ...segment.path[r], distance: segment.path[r].distance - origin });
    }
    return out;
  }

  /** Tablier, parapets, piles et culées d'une travée. */
  _buildSpan(buffer, segment, run, sampleElevation) {
    const path = this._runPath(segment, run);
    if (path.length < 2) return;

    const { halfWidth } = segment;
    const style = worksStyleAt(path[0].x, path[0].z, this.theme.works);
    // Surface de la chaussée : le ruban est décollé de `ROAD_LIFT_M` au-dessus
    // de la plate-forme, et une corniche arasée sur la plate-forme laisserait
    // une saignée le long de la rive.
    const surface = new Float32Array(path.length);
    for (let i = 0; i < path.length; i++) surface[i] = segment.platform[run.from + i] + ROAD_LIFT_M;

    appendProfile(buffer, {
      path,
      profile: deckProfile(halfWidth, style.deck),
      sampleElevation,
      baseHeights: surface,
      frames: segment.frames?.slice(run.from * 4, (run.to + 1) * 4),
      closed: true,
      // Déjà tendue par `levelWorkSpans` : relisser courberait le tablier.
      smoothRadius: 0,
    });
    this.counts.spans++;

    this._buildParapets(buffer, path, surface, halfWidth, style, segment.frames?.slice(run.from * 4, (run.to + 1) * 4));
    this._buildSupports(buffer, path, surface, halfWidth, style, sampleElevation);
  }

  _buildJunctionSupport(buffer, area, sampleElevation) {
    const style = worksStyleAt(area.x, area.z, this.theme.works);
    const slab = junctionSurface(area, ROAD_LIFT_M - style.deck.thickness, { base: buffer.positions.length / 3 });
    if (!slab) return;
    buffer.positions.push(...slab.positions);
    for (let i = 0; i < slab.positions.length / 3; i++) buffer.colors.push(...style.deck.color);
    buffer.indices.push(...slab.indices);
    for (const edge of area.edges) {
      const path = edge.points.map((p, i) => ({ ...p, distance: i ? Math.hypot(p.x - edge.points[0].x, p.z - edge.points[0].z) : 0 }));
      const surface = Float32Array.from(path, p => p.y + ROAD_LIFT_M);
      appendVariableWall(buffer, { path, base: surface.map(y => y - style.deck.thickness), top: surface,
        thickness: style.parapet.thickness, coping: 0, colorFoot: style.deck.color, colorTop: style.deck.edge });
      appendVariableWall(buffer, { path, base: surface, top: surface.map(y => y + style.parapet.height),
        thickness: style.parapet.thickness, coping: style.parapet.coping,
        colorFoot: style.parapet.color, colorTop: style.parapet.colorTop });
    }
    const path = [{ x: area.x - 1, z: area.z, distance: 0 }, { x: area.x + 1, z: area.z, distance: 2 }];
    const surface = Float32Array.from(path, p => (junctionDeckAt(area, p.x, p.z) ?? area.deck) + ROAD_LIFT_M);
    this._buildSupports(buffer, path, surface, 1, style, sampleElevation);
    this.counts.spans++;
  }

  /**
   * Les deux parapets. Ils remplacent la glissière que `furnitureLayer` ne pose
   * plus ici : sur une travée, c'est le seul garde-corps qu'il y ait.
   */
  _buildParapets(buffer, path, surface, halfWidth, style, frames = null) {
    const { parapet, deck } = style;
    // Le couronnement déborde de part et d'autre : l'axe recule d'autant, pour
    // que la face extérieure du parapet affleure la corniche du tablier.
    const offset = halfWidth + deck.overhang - parapet.thickness / 2 - parapet.coping;
    const rows = path.length;

    for (const side of [1, -1]) {
      // Un sel par rive, sinon les deux parapets se répondraient en miroir.
      const grain = parapet.grain ? facetJitter(path, PARAPET_SEED + (side > 0 ? 0 : 50), parapet.grain) : null;
      const top = new Float32Array(rows);
      const lateral = new Float32Array(rows);
      const batter = new Float32Array(rows);
      for (let i = 0; i < rows; i++) {
        const height = parapet.height * (grain ? grain.height[i] : 1);
        top[i] = surface[i] + height;
        if (!grain) continue;
        // Le grain ne joue que côté chaussée : côté vide, la face affleure la corniche.
        lateral[i] = (-side * parapet.thickness * (grain.thickness[i] - 1)) / 2;
        batter[i] = -side * grain.batter[i] * height;
      }
      appendVariableWall(buffer, {
        path,
        frames,
        base: surface,
        top,
        offset: side * offset,
        thickness: parapet.thickness,
        coping: parapet.coping,
        colorFoot: parapet.color,
        colorTop: parapet.colorTop,
        scaleAcross: grain ? grain.thickness : null,
        lateralJitter: grain ? lateral : null,
        batter: grain ? batter : null,
        flat: Boolean(grain),
      });
    }
  }

  /**
   * Piles et culées : des voiles en travers de l'ouvrage, du terrain jusqu'à
   * la sous-face du tablier.
   *
   * Une pile est un mur de deux lignes, balayé perpendiculairement à la route :
   * `appendVariableWall` travaille alors en travers, et son épaisseur se compte
   * dans le sens de la marche. C'est exactement une pile-voile, et ça évite un
   * volume paramétrique de plus pour un objet qu'on a déjà.
   *
   * L'espacement se compte depuis le début de la travée, qui est un point du
   * sol : deux reconstructions posent les piles au même endroit.
   */
  _buildSupports(buffer, path, surface, halfWidth, style, sampleElevation) {
    const { pier, abutment, deck } = style;
    const frames = pathFrames(path);
    const length = path[path.length - 1].distance;

    /** Un voile en travers, à l'abscisse `i` du tracé, sur `span` de largeur. */
    const blade = (i, span, thickness, colorFoot, colorTop) => {
      const px = frames[i * 4 + 2];
      const pz = frames[i * 4 + 3];
      const reach = (halfWidth + deck.overhang) * span;
      const across = [
        { x: path[i].x + px * reach, z: path[i].z + pz * reach },
        { x: path[i].x - px * reach, z: path[i].z - pz * reach },
      ];
      if (this._roadIndex) {
        const [a, b] = across;
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
        for (let j = 0; j <= steps; j++) {
          const t = steps ? j / steps : 0;
          const hits = this._roadIndex.queryAll(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 1);
          if (hits.some(hit => this._roadIndex.deckAt(hit) < surface[i] - deck.thickness - 1)) return false;
        }
      }
      if (this._earthworks) {
        const [a, b] = across;
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
        for (let j = 0; j <= steps; j++) {
          const t = steps ? j / steps : 0;
          const hits = this._earthworks.index.queryAll(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 1);
          if (hits.some((hit) => hit.segment.delta[hit.row] < -0.001)) return false;
        }
      }
      // Sous-face du tablier, prise dans le même repère que lui : `surface`,
      // pas la plate-forme (le tablier est arasé sur la chaussée).
      const crown = surface[i] - deck.thickness;
      // Chaque extrémité du voile se fonde sur **son** terrain : un pied unique
      // pris au plus bas des deux fait, sur un versant, une plaque pleine du
      // côté haut — un pan de mur qui descend la montagne au lieu d'une pile.
      // Plafonné à la sous-face : un bout de voile enterré ne se voit pas, un
      // bout qui la dépasse crève le tablier.
      const foot = new Float32Array([
        Math.min(sampleElevation(across[0].x, across[0].z), crown),
        Math.min(sampleElevation(across[1].x, across[1].z), crown),
      ]);
      // Le voile se juge sur sa plus grande hauteur : une pile qui n'émerge que
      // d'un côté reste une pile, et c'est précisément le cas sur un versant.
      if (crown - Math.min(foot[0], foot[1]) < BRIDGE_MIN_RISE_M) return false;

      return appendVariableWall(buffer, {
        path: across,
        base: foot,
        top: new Float32Array([crown, crown]),
        thickness,
        coping: 0.08,
        colorFoot,
        colorTop,
      });
    };

    // La culée est au front du creux : le bout cartographié du pont peut
    // encore reposer sur la rive. On avance jusqu'au premier appui visible.
    const middle = (path.length - 1) / 2;
    for (const side of [1, -1]) {
      const start = side > 0 ? 0 : path.length - 1;
      for (let i = start; side > 0 ? i < middle : i > middle; i += side) {
        if (blade(i, 1, abutment.thickness, abutment.colorFoot, abutment.colorTop)) {
          this.counts.piers++;
          break;
        }
        if (!this._earthworks) break;
      }
    }

    // Piles : à intervalle régulier entre les deux culées. Une travée trop
    // courte pour en porter une n'en porte aucune, plutôt qu'une au milieu.
    const spacing = Math.max(6, pier.spacing);
    for (let d = spacing; d < length - spacing * 0.5; d += spacing) {
      let i = 0;
      while (i < path.length - 1 && path[i + 1].distance < d) i++;
      if (blade(i, pier.span, pier.thickness, pier.colorFoot, pier.colorTop)) this.counts.piers++;
    }
  }

  /**
   * Les deux têtes d'un tunnel : piédroits, linteau et voûte.
   *
   * Le front est fait de trois murs plutôt que d'un seul percé : le trou d'une
   * ouverture coûterait une triangulation à part, alors que deux piédroits et
   * un linteau se balaient avec l'outil qui pose déjà les piles.
   *
   * Le mur monte jusqu'au terrain qui domine l'entrée, plafonné : sur une
   * falaise, une tête qui suivrait le relief ferait un barrage de trente
   * mètres.
   */
  _buildTunnelHeads(buffer, segment, run, sampleElevation) {
    const { halfWidth }=segment;
    const path=this._runPath(segment,run);
    if(path.length<2)return;
    const style=worksStyleAt(path[0].x,path[0].z,this.theme.works);
    const surface=new Float32Array(path.map((_,i)=>segment.platform[run.from+i]+ROAD_LIFT_M));
    const spacing = (this.theme.tunnelLights ?? defaultTheme.tunnelLights).spacingM;
    const profile = segment.kind === 'underpass' ? [
      { across: -halfWidth-PORTAL_CLEARANCE_M, up: 0, color: style.portal.arch },
      { across: -halfWidth-PORTAL_CLEARANCE_M, up: segment.roofHeight, color: style.portal.arch },
      { across: halfWidth+PORTAL_CLEARANCE_M, up: segment.roofHeight, color: style.portal.arch },
      { across: halfWidth+PORTAL_CLEARANCE_M, up: 0, color: style.portal.arch },
    ] : vaultProfile(halfWidth, style.portal);
    const lampHeight = Math.max(...profile.map(p=>p.up)) - .18;
    const total = path.at(-1).distance;
    const apron = Math.max(6,(this.bubble.cutBenchM??0)+ROAD_CUT_BLEND_M);
    let distance = path[0].distance ?? 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i-1], b = path[i];
      const length = Math.hypot(b.x-a.x,b.z-a.z);
      for (let d = Math.ceil(distance / spacing) * spacing; d < distance + length; d += spacing) {
        if (segment.kind === 'building' || d < spacing || d > total-spacing) continue;
        const t = length ? (d-distance)/length : 0;
        this.tunnelFixtures.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,
          y:surface[i-1]+(surface[i]-surface[i-1])*t+lampHeight});
      }
      distance += length;
    }
    // Profil ouvert : aucune face ne bouche l'entrée ou la sortie.
    appendProfile(buffer,{path,profile,sampleElevation,baseHeights:surface,closed:false,smoothRadius:0});
    // Le radier ferme aussi le dégagement du masque devant les seuils.
    const floorPath=path.map(p=>({...p,distance:p.distance+apron}));
    const floorHeights=Array.from(surface,h=>h-ROAD_LIFT_M);
    for(const end of [0,1]) {
      if (segment.tunnelPortals ? !segment.tunnelPortals[end] : end ? run.to===segment.path.length-1 : run.from===0) continue;
      const i=end?path.length-1:0,j=end?i-1:1;
      const length=Math.hypot(path[i].x-path[j].x,path[i].z-path[j].z);
      if(!length) continue;
      const p={x:path[i].x+(path[i].x-path[j].x)*apron/length,z:path[i].z+(path[i].z-path[j].z)*apron/length,
        distance:end?total+2*apron:0};
      const h=surface[i]-ROAD_LIFT_M+(surface[i]-surface[j])*apron/length;
      if(end){floorPath.push(p);floorHeights.push(h);}else{floorPath.unshift(p);floorHeights.unshift(h);}
    }
    appendProfile(buffer, { path:floorPath, profile: [
      { across: -halfWidth-PORTAL_CLEARANCE_M, up: 0, color: style.portal.arch },
      { across: halfWidth+PORTAL_CLEARANCE_M, up: 0, color: style.portal.arch },
    ], sampleElevation, baseHeights: Float32Array.from(floorHeights), closed:false, smoothRadius:0 });
    for(const mouth of [run.from,run.to]) {
      // Une limite de streaming n'est pas une entrée de tunnel.
      if (segment.tunnelPortals ? !segment.tunnelPortals[mouth===run.from?0:1] : mouth===0 || mouth===segment.path.length-1) continue;
      const inward=mouth===run.from?1:-1;
      const p=segment.path[mouth], q=segment.path[mouth+inward];
      const length=Math.hypot(q.x-p.x,q.z-p.z);
      if(!length)continue;
      const opening = {x:p.x,z:p.z,y:segment.platform[mouth]+ROAD_LIFT_M,radius:halfWidth+PORTAL_CLEARANCE_M,steps:PORTAL_ARC_STEPS,apron,roofHeight:segment.kind==='underpass'?segment.roofHeight:0,dx:(q.x-p.x)/length,dz:(q.z-p.z)/length,slope:(segment.platform[mouth+inward]-segment.platform[mouth])/length};
      this.tunnelMouths.push(opening);
      appendTunnelSeams(buffer, opening, profile, this.bubble.plantSupportTiles?.(p.x,p.z,apron+halfWidth+PORTAL_CLEARANCE_M) ?? [], ROAD_LIFT_M);
      this._buildPortalFace(buffer,path,surface,halfWidth,style,mouth===run.from?0:path.length-1,sampleElevation,profile);
      this.counts.portals++;
    }
  }

  /** Le front d'une tête : deux piédroits et le linteau qui les relie. */
  _buildPortalFace(buffer, path, surface, halfWidth, style, at, sampleElevation, profile = vaultProfile(halfWidth, style.portal)) {
    const { portal } = style;
    const frames = pathFrames(path);
    const px = frames[at * 4 + 2];
    const pz = frames[at * 4 + 3];
    const opening = halfWidth + PORTAL_CLEARANCE_M;
    const outer = opening + portal.jamb;
    const base = surface[at];
    // Terrain au-dessus de l'entrée, plafonné : la tête habille la colline,
    // elle ne la remplace pas.
    const above = Math.min(
      sampleElevation(path[at].x, path[at].z),
      base + opening + portal.crown + 3
    );
    const crest = Math.max(base + Math.max(...profile.map(p=>p.up)) + portal.crown, above);

    const at2 = (a, b) => [
      { x: path[at].x + px * a, z: path[at].z + pz * a },
      { x: path[at].x + px * b, z: path[at].z + pz * b },
    ];

    for (const [a, b] of [
      [opening, outer],
      [-opening, -outer],
    ]) {
      appendVariableWall(buffer, {
        path: at2(a, b),
        base: new Float32Array([base, base]),
        top: new Float32Array([crest, crest]),
        thickness: 0.9,
        coping: 0.12,
        colorFoot: portal.face,
        colorTop: portal.face,
      });
    }

    // Remplit aussi les écoinçons entre l'arc et le front rectangulaire.
    const arc = profile.slice(1, -1);
    for (let i = 1; i < arc.length; i++) {
      const a = arc[i-1], b = arc[i];
      appendVariableWall(buffer, {
        path: at2(a.across, b.across),
        base: new Float32Array([base+a.up, base+b.up]),
        top: new Float32Array([crest, crest]),
        thickness: .9, coping: 0,
        colorFoot: portal.face, colorTop: portal.face,
      });
    }
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
      mesh.name = 'bridge';
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      this.scene.add(mesh);
      this.mesh = mesh;
    }
    this.geometry = geometry;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
      this.geometry = null;
    }
    this.material.dispose();
    this.lighting?.dispose();
  }
}
