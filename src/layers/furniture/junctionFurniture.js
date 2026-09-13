/*
 * junctionFurniture — ce qu'un carrefour porte : le feu tricolore, et le
 * panneau de priorité à chaque bouche qui cède.
 *
 * Un carrefour est une propriété du **graphe** (`roadGraph`), pas une image :
 * la liste des nœuds est lue telle que le graphe la publie, jamais redécouverte
 * en cherchant où deux rubans se recouvrent. La priorité, elle, est décidée une
 * fois au carrefour (`roadJunctions.branchYields`) et lue deux fois : par la
 * ligne peinte au sol et par le panneau posé ici.
 */

import { branchYields } from '../roadJunctions.js';
import { MARKING_BAR_M, MOUTH_CROSSING_M } from '../roadMarkings.js';
import { pointInAreas } from '../settlement.js';
import { roadsideFurnitureFor, roadsideYaw, randomAt, PRIORITY_SIGN_PROFILES } from '../furniturePlacement.js';
import { FURNITURE_LIMITS, FURNITURE_RADIUS_M } from './catalog.js';

/** Recul d'un feu tricolore en amont du nœud de carrefour, en mètres. */
const TRAFFIC_LIGHT_SETBACK_M = 10;
/** Durée d'un cycle de feu tricolore, en secondes. */
export const TRAFFIC_CYCLE_S = 14;

/**
 * État d'un feu tricolore à un instant donné : quelle lentille est allumée.
 * Cycle asymétrique (le vert dure, l'orange passe). `phase` décale le cycle
 * d'un feu à l'autre, sinon deux feux voisins synchrones trahissent le procédural.
 *
 * @param {number} time  Secondes écoulées.
 * @param {number} phase Décalage propre au feu, en secondes.
 * @returns {number} indice dans `TRAFFIC_LENSES` (0 rouge, 1 orange, 2 vert).
 */
export function trafficPhaseAt(time, phase = 0) {
  const t = (((time + phase) % TRAFFIC_CYCLE_S) + TRAFFIC_CYCLE_S) % TRAFFIC_CYCLE_S;
  if (t < TRAFFIC_CYCLE_S * 0.52) return 2; // vert
  if (t < TRAFFIC_CYCLE_S * 0.6) return 1; // orange
  return 0; // rouge
}

/**
 * Feux tricolores, aux carrefours d'agglomération.
 *
 * Le schéma OpenMapTiles ne porte pas `highway=traffic_signals` — comme il ne
 * porte ni lampadaire ni panneau. Mais il porte les chaussées, et un carrefour
 * est une propriété du **graphe** routier : un nœud où plus de deux arêtes se
 * rejoignent. `roadGraph` le relève au moment où il recoud les chaussées, et
 * le publie ; c'est cette liste-là qu'on lit ici. Jamais une détection
 * géométrique : deux rubans qui se recouvrent donnent un croisement par ligne,
 * un nœud n'en donne qu'un, au centre.
 *
 * Deux conditions restent : le carrefour doit être en zone bâtie (une croisée
 * de départementales en pleine campagne porte un cédez-le-passage, pas un
 * feu), et sa chaussée dominante doit en mériter un (`plan`).
 */
export function buildCrossings(layer, context, junctions, roadIndex, builtUp) {
  // Relevé même quand la passe ne pose rien : `buildJunctionSigns` le lit
  // pour ne pas doubler un feu d'un cédez-le-passage.
  layer._signalled = [];
  if (!roadIndex || !Array.isArray(junctions)) return;
  const { placements, here } = context;
  let placed = 0;

  for (const junction of junctions) {
    if (placed >= FURNITURE_LIMITS.trafficLights) break;
    if (Math.hypot(junction.x - here.x, junction.z - here.z) > FURNITURE_RADIUS_M) continue;
    if (!pointInAreas(builtUp, junction.x, junction.z)) continue;
    if (!roadsideFurnitureFor(junction.profile, { builtUp: true }).trafficLight) continue;

    // La branche la plus large : c'est celle dont le feu règle l'accès, et
    // c'est sur elle que l'automobiliste le cherche.
    let branch = null;
    for (const candidate of junction.branches) {
      if (!branch || candidate.halfWidth > branch.halfWidth) branch = candidate;
    }
    if (!branch) continue;

    // Une dizaine de mètres en amont du nœud, sur la branche, et à droite —
    // c'est la position française. `branch` sort du carrefour, donc reculer
    // le long de la branche veut dire avancer dans son sens.
    const back = TRAFFIC_LIGHT_SETBACK_M;
    const px = junction.x + branch.x * back;
    const pz = junction.z + branch.z * back;
    // Sens de la marche : celui du trafic qui arrive au feu, donc l'inverse
    // de la direction sortante de la branche.
    const tx = -branch.x;
    const tz = -branch.z;
    const offset = -(junction.halfWidth + 1.2);
    const yaw = roadsideYaw(tx, tz, offset, 'traffic');

    // Altitude prise sur la plate-forme de la branche, pas sur le terrain :
    // le feu est au bord de la chaussée, qui est dressée de niveau.
    const deck = roadIndex.deckAt(roadIndex.query(px, pz, 1));

    const post = layer._place(placements, 'trafficLight', {
      x: px + tz * offset,
      z: pz - tx * offset,
      y: deck,
      yaw,
      exactY: deck != null,
    });
    // Le feu publie son point d'allumage : `advanceSignals` y pose la
    // lentille vive et son halo. La phase est tirée du **lieu**, donc deux
    // carrefours voisins ne passent jamais au vert ensemble, et un même
    // carrefour garde son rythme d'une reconstruction à l'autre.
    if (post) {
      layer._signals.push({
        x: post.x,
        y: post.y,
        z: post.z,
        yaw,
        phase: randomAt(post.x, post.z, 97) * TRAFFIC_CYCLE_S,
      });
    }
    layer._signalled.push(junction);
    placed++;
  }
}

/**
 * Les panneaux de priorité, aux bouches des carrefours.
 *
 * Un panneau ne se pose jamais parce qu'une intersection existe : la donnée ne porte pas de priorité, mais elle
 * porte la classe de chaque branche, donc sa largeur, et la règle de tracé
 * qui en découle suffit — on cède le passage à plus large que soi
 * (`branchYields`). Trois conséquences :
 *
 *   - un panneau par branche **qui cède**, et aucun sur celles qui ne cèdent
 *     pas. Une croisée de deux voies identiques n'en porte donc aucun, ce qui
 *     est le bon résultat ;
 *   - il est posé à sa **bouche**, à la hauteur de la ligne d'effet peinte au
 *     sol, et non au petit bonheur d'un espacement ;
 *   - c'est le **même fait** qui pose le panneau et qui peint la ligne. Un
 *     cédez-le-passage peint sans panneau, ou l'inverse, se lirait comme une
 *     faute.
 *
 * Un carrefour à feux n'en porte pas : c'est le feu qui règle l'accès.
 */
export function buildJunctionSigns(layer, context, areas, roadIndex, builtUp) {
  if (!roadIndex || !areas?.areas?.length) return;
  const { placements, here } = context;

  for (const area of areas.areas) {
    if (Math.hypot(area.x - here.x, area.z - here.z) > FURNITURE_RADIUS_M) continue;
    // Le nœud d'un feu et celui de son aire sont le **même** point, repris
    // tel quel par `junctionArea` : l'écart toléré ne couvre que le calcul
    // flottant, il n'élargit rien.
    if (layer._signalled?.some((j) => Math.hypot(j.x - area.x, j.z - area.z) < 0.5)) continue;

    for (const mouth of area.mouths || []) {
      if (!PRIORITY_SIGN_PROFILES.has(mouth.profile)) continue;
      if (!branchYields(area, mouth.halfWidth)) continue;

      // À hauteur de la ligne d'effet : la traversée d'abord, la ligne
      // ensuite, le panneau avec elle (voir `roadMarkings`). Mesuré **depuis
      // la bouche**, sur la direction que la chaussée y suit : c'est là que
      // le ruban reprend, et une branche qui oblique emporte son panneau
      // avec elle.
      const back = MOUTH_CROSSING_M + MARKING_BAR_M / 2;
      const px = mouth.centre.x + mouth.direction.x * back;
      const pz = mouth.centre.z + mouth.direction.z * back;
      // Le conducteur arrive **vers** le carrefour : sa marche est l'inverse
      // de la direction sortante de la bouche.
      const tx = -mouth.direction.x;
      const tz = -mouth.direction.z;
      const offset = -(mouth.halfWidth + 1.1);
      const deck = roadIndex.deckAt(roadIndex.query(px, pz, 1));

      layer._place(placements, 'signYield', {
        x: px + tz * offset,
        z: pz - tx * offset,
        y: deck,
        yaw: roadsideYaw(tx, tz, offset, 'traffic'),
        exactY: deck != null,
      });
    }
  }
}

