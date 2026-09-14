/*
 * roadsideRelief — les ouvrages que le relief impose à une chaussée : la
 * falaise du déblai en amont, le mur de soutènement en aval, la glissière ou
 * le garde-corps qui borde le vide, et le talus de remblai.
 *
 * Rien ici n'est décidé par le type de route : c'est le relief lu dans le MNT
 * — devers, surplomb, courbure — qui déclenche chaque ouvrage. Seule la
 * largeur du profil dit si la chaussée est aménagée au point d'en porter
 * (`profileTakesGuardrail`).
 *
 * Les lignes d'ouvrage d'art (pont, tunnel) n'arrivent pas jusqu'ici :
 * `buildRoadside` les a déjà écartées, un tablier n'a ni talus ni mur.
 */

import {
  appendProfile,
  appendVariableWall,
  appendRockCut,
  smoothColumns,
  pathFrames,
} from '../ribbonGeometry.js';
import { facetJitter } from '../facetJitter.js';
import { ROAD_LIFT_M } from '../roadNetwork.js';
import { ROAD_CUT_M, ROAD_CUT_BLEND_M } from '../../terrain/roadCut.js';
import {
  spacedAlongPath,
  guardrailStyleFor,
  roadsideYaw,
  contiguousRuns,
  STEEP_CROSS_SLOPE,
  EMBANKMENT_MIN_DROP_M,
} from '../furniturePlacement.js';

/**
 * Hauteur dont le versant doit dominer la plate-forme pour qu'on ait taillé
 * dedans, en mètres.
 *
 * C'est le seul déclencheur de la falaise, et il ne parle pas de devers : une
 * route qui coupe une croupe est en déblai des deux côtés sans qu'aucune
 * section ne soit en travers d'un versant. Le seuil est bien au-dessus du
 * bruit du MNT, qui donne quelques décimètres partout ; il est aussi ce qui
 * garde la roche pour les vraies entailles — le raccord du déblai fait cinq
 * mètres de large quelle que soit sa profondeur, et une falaise d'un demi-mètre
 * couvrirait donc de roche cinq mètres d'un versant qui n'a rien de rocheux.
 */
export const ROCK_CUT_MIN_RISE_M = 1.5;
/** Graine du fruit de la paroi : une falaise n'est pas une plaque extrudée. */
const ROCK_CUT_SEED = 9137;
/** Graines du grain du mur de soutènement et du talus (`facetJitter`). */
const FILL_WALL_SEED = 9241;
const EMBANKMENT_SEED = 9311;

/**
 * Ce que le relief impose : les ouvrages qui tiennent la chaussée sur un
 * versant, plus la glissière qui borde le vide.
 *
 * Rien de tout cela n'est décidé par le type de route — c'est le relief, lu
 * dans le MNT, qui le déclenche.
 *
 * ## La géométrie, et pourquoi les deux rives ne se ressemblent pas
 *
 * La plate-forme est dressée **à mi-hauteur** de la section (`levelRow`) et
 * aplanie en long (`flattenGrade`), c'est-à-dire là où un terrassier la met :
 * le déblai d'un côté paie le remblai de l'autre, et la pente se tend au lieu
 * de suivre le sol. La chaussée est donc à la fois encaissée et portée — mais
 * les deux rives n'appellent pas le même ouvrage :
 *
 * - **en amont**, le terrain domine la rive. Le terrain lui-même est entaillé
 *   le long de la chaussée (`terrainBubble.cutElevation`), et ce qui borde la
 *   route est la roche de cette entaille : une falaise (`buildRockCut`), pas
 *   un parement maçonné. On ne construit rien du côté haut, on y taille.
 * - **en aval**, la rive surplombe le vide. Là, il y a bien un ouvrage : le
 *   mur descend de la plate-forme jusqu'au sol, et la glissière se pose dessus.
 *
 * @returns {Set<number>} lignes déjà tenues par un mur de remblai — le talus
 *          de rase campagne ne doit pas s'y ajouter.
 */
export function buildRoadsideRelief(layer, context, segment, rowsInfo) {
  const { buffers, sampleElevation } = context;
  const { platform, halfWidth, profile } = segment;
  const walled = new Set();

  // Ouvrages et glissière ne concernent que les chaussées aménagées : un
  // sentier de montagne n'a ni l'un ni l'autre, il passe.
  if (!profileTakesGuardrail(profile)) return walled;

  buildParapets(layer, context, segment, rowsInfo);
  buildRockCut(layer, context, segment, rowsInfo);

  for (const run of contiguousRuns(rowsInfo, (row) => row.slope >= STEEP_CROSS_SLOPE, 5)) {
    const side = run[Math.floor(run.length / 2)].uphill;
    // Distances ramenées à zéro : un tronçon extrait au kilomètre 3 doit
    // s'espacer depuis son propre début, pas depuis celui de la chaussée.
    const origin = run[0].distance;
    const runPath = run.map((row) => ({ x: row.x, z: row.z, distance: row.distance - origin }));
    const deck = new Float32Array(run.map((row) => platform[row.r]));

    // --- Aval : le parement du remblai, et la glissière dessus ------------
    const fill = layer.specs.wallSpecs.fill;
    const offset = -side * (halfWidth + fill.thickness / 2);
    const frames = pathFrames(runPath);
    const grain = facetJitter(runPath, FILL_WALL_SEED, fill.grain);
    const fillBase = new Float32Array(run.length);
    // L'arase affleure la **surface** de la chaussée, pas sa plate-forme : le
    // ruban est décollé de `ROAD_LIFT_M`, et une arase posée sur la plate-forme
    // laisserait une saignée de quatorze centimètres le long de la rive.
    const fillTop = new Float32Array(run.length);
    for (let i = 0; i < run.length; i++) {
      fillTop[i] = deck[i] + ROAD_LIFT_M;
      // Terrain sous le pied du mur, et non sous la rive : c'est là qu'il
      // repose, et la différence vaut plusieurs décimètres sur un versant.
      const ground = sampleElevation(
        runPath[i].x + frames[i * 4 + 2] * offset,
        runPath[i].z + frames[i * 4 + 3] * offset
      );
      // Plancher : le mur ne descend jamais plus bas que son plafond, et ne
      // remonte jamais au-dessus de la plate-forme qu'il porte.
      fillBase[i] = Math.max(deck[i] - fill.maxHeight, Math.min(ground, deck[i]));
      walled.add(run[i].r);
    }
    smoothColumns(fillBase, run.length, 1, 2);

    // Le grain ne joue que côté vide : l'épaisseur gagne vers l'aval et le
    // pied s'y écarte, le parement côté chaussée reste sur la rive.
    const lateral = new Float32Array(run.length);
    const batter = new Float32Array(run.length);
    for (let i = 0; i < run.length; i++) {
      lateral[i] = (-side * fill.thickness * (grain.thickness[i] - 1)) / 2;
      batter[i] = -side * grain.batter[i] * Math.max(0, fillTop[i] - fillBase[i]);
      // Écarté vers l'aval, le pied flotterait au-dessus du versant : il
      // descend au terrain de son nouvel aplomb.
      const outer = -side * (halfWidth + fill.thickness * grain.thickness[i]) + batter[i];
      const ground = sampleElevation(
        runPath[i].x + frames[i * 4 + 2] * outer,
        runPath[i].z + frames[i * 4 + 3] * outer
      );
      fillBase[i] = Math.max(deck[i] - fill.maxHeight, Math.min(fillBase[i], ground));
    }
    appendVariableWall(buffers.fillWall, {
      path: runPath,
      base: fillBase,
      top: fillTop,
      offset,
      thickness: fill.thickness,
      coping: fill.coping,
      colorFoot: fill.colorFoot,
      colorTop: fill.colorTop,
      scaleAcross: grain.thickness,
      lateralJitter: lateral,
      batter,
    });

  }

  return walled;
}

/**
 * La falaise du déblai : la roche que la route a entaillée du côté amont.
 *
 * ## Pourquoi ce n'est pas un mur
 *
 * Une route de corniche n'est pas bordée d'un parement maçonné du côté haut :
 * on n'a rien construit là, on a coupé le versant. Ce qui la borde est donc
 * une paroi rocheuse, et ce qui la surmonte, la roche du talus jusqu'au
 * terrain naturel. Le mur, lui, reste en aval : c'est là qu'il y a quelque
 * chose à porter.
 *
 * ## Ce qui la déclenche
 *
 * Le devers ne dit rien du déblai : une route qui coupe une croupe est en
 * tranchée des deux côtés sans qu'aucune section ne soit en travers d'un
 * versant, et l'aplanissement du profil en long (`flattenGrade`) ne fait
 * qu'accentuer le cas. Le déclencheur est donc la seule hauteur dont le
 * terrain domine la plate-forme (`ROCK_CUT_MIN_RISE_M`).
 *
 * ## Les trois altitudes qu'elle lit, et pourquoi trois
 *
 * - **au pied** (`e`, le bord du fond plat de l'entaille), le terrain
 *   *naturel* : c'est la hauteur de la paroi franche, celle qu'un
 *   terrassier a réellement coupée. La lire plus loin la ferait dépasser du
 *   versant comme une lame ;
 * - **au raccord** (`ROAD_CUT_BLEND_M` plus loin), le terrain naturel encore :
 *   c'est là que la roche rejoint le versant intact ;
 * - **entre les deux**, la surface *affichée* — le talus que l'entaille a
 *   laissé. La roche le couvre en s'y appuyant : ni table plate au-dessus de
 *   lui, ni paroi qui le traverse.
 */
export function buildRockCut(layer, context, segment, rowsInfo) {
  const { buffers, rawElevation, sampleElevation } = context;
  const { platform, halfWidth } = segment;
  const spec = layer.specs.rockCut;

  // Un tronçon par côté, et non le côté du milieu retenu pour tout le
  // tronçon : le versant peut changer de main au passage d'un col, et la
  // paroi se retrouverait alors à sonder le vide en aval.
  const uphill = (row, wanted) => row.uphill === wanted && row.rise >= ROCK_CUT_MIN_RISE_M;
  for (const side of [1, -1]) {
    for (const run of contiguousRuns(rowsInfo, (row) => uphill(row, side), 5)) {
      const rows = run.length;
      const origin = run[0].distance;
      const runPath = run.map((row) => ({ x: row.x, z: row.z, distance: row.distance - origin }));
      const frames = pathFrames(runPath);
      const deck = new Float32Array(run.map((row) => platform[row.r]));

      const crest = new Float32Array(rows);
      const shelf = new Float32Array(rows);
      const cap = new Float32Array(rows);
      const reach = new Float32Array(rows);
      const capOut = new Float32Array(rows);
      const breakUp = new Float32Array(rows);
      const breakOut = new Float32Array(rows);
      const footOut = new Float32Array(rows);

      // Le pied se dresse au bord du **fond plat** de l'entaille, pas au ras
      // de la chaussée : entre les deux, il y a l'accotement excavé.
      const offset = side * (halfWidth + ROAD_CUT_M);
      const capReach = ROAD_CUT_BLEND_M;

      const grain = facetJitter(runPath, ROCK_CUT_SEED + 1, spec.grain);
      const along = (i, distance) => ({
        x: runPath[i].x + frames[i * 4 + 2] * (offset + side * distance),
        z: runPath[i].z + frames[i * 4 + 3] * (offset + side * distance),
      });

      // Les deux altitudes du terrain naturel, lissées avant usage : la
      // silhouette de la falaise ne doit pas porter le bruit métrique du MNT,
      // elle a son propre grain.
      const face = new Float32Array(rows);
      const rear = new Float32Array(rows);
      for (let i = 0; i < rows; i++) {
        capOut[i] = grain.capOut[i];
        const foot = along(i, 0);
        // Altitude lue au raccord même, jamais à la rallonge : la rallonge
        // n'est là que pour enfoncer l'arrière dans le versant, et lui donner
        // son altitude à elle le ferait ressortir au lieu de s'y perdre.
        const back = along(i, capReach);
        face[i] = rawElevation(foot.x, foot.z);
        rear[i] = rawElevation(back.x, back.z);
      }
      smoothColumns(face, rows, 1, 2);
      smoothColumns(rear, rows, 1, 2);

      for (let i = 0; i < rows; i++) {
        const height = Math.min(Math.max(face[i] - deck[i], 0), spec.maxHeight);
        // Arase dentelée, vers le haut seulement : vers le bas, la roche
        // passerait sous le talus qu'elle est censée couvrir.
        crest[i] = deck[i] + height + grain.crest[i] * height;
        reach[i] = Math.min(
          Math.max(height * spec.batter * grain.reach[i], spec.minReach),
          capReach * 0.7
        );
        breakUp[i] = spec.breakUp * grain.breakUp[i];
        breakOut[i] = spec.breakOut * grain.breakOut[i];
        // Débord du pied vers le versant seulement : l'accotement excavé est
        // étroit, et un pied tiré vers la chaussée mordrait dessus.
        footOut[i] = grain.foot[i];
        // Le raccord au versant, rehaussé du débord : la maille du terrain
        // coupe le raccord en droites qui peuvent le dépasser, et une arase
        // pile au niveau du versant laisserait la terre déborder par-dessus.
        cap[i] = deck[i] + Math.min(Math.max(rear[i] - deck[i], 0), spec.maxHeight) + spec.crown;

        // Le dos de la falaise s'appuie sur le talus du raccord : on lit sa
        // surface affichée à l'aplomb, et la roche se tient entre lui et la
        // ligne du terrain naturel, qui joint le haut de la paroi au raccord.
        const width = capReach + capOut[i];
        const mid = reach[i] + (width - reach[i]) * spec.shelfAt;
        const at = along(i, mid);
        const ramp = sampleElevation(at.x, at.z);
        const natural = deck[i] + height + (cap[i] - spec.crown - deck[i] - height) * (mid / width);
        const bank = Math.min(1, Math.max(0, spec.bank * grain.bank[i]));
        shelf[i] = ramp + (Math.max(natural, ramp) - ramp) * bank;
      }

      appendRockCut(buffers.rockCut, {
        path: runPath,
        base: deck,
        crest,
        shelf,
        cap,
        offset,
        side,
        reach,
        capReach,
        capOut,
        shelfAt: spec.shelfAt,
        breakUp,
        breakOut,
        footOut,
        colorFoot: spec.colorFoot,
        colorBreak: spec.colorBreak,
        colorTop: spec.colorTop,
      });
    }
  }
}

/**
 * Les parapets : glissière métallique ou garde-corps de bois, là où la rive
 * aval surplombe vraiment quelque chose.
 *
 * ## Pourquoi ils sont séparés des murs
 *
 * Ce n'est pas la même question : un mur tient la **plate-forme**, un parapet
 * protège d'un **vide**. Un devers seul ne suffit donc pas — au bruit d'un MNT
 * à trente mètres, il y en a sur des kilomètres de plaine. Ils ont leurs
 * propres tronçons, et leur propre règle
 * (`guardrailStyleFor`), qui exige un surplomb réel et, en plus, soit un
 * versant franc, soit une courbe.
 *
 * ## Deux matières
 *
 * L'acier sur les grands axes, le bois sur les petites routes et les chemins
 * de montagne — là où une glissière métallique fait autoroute. Le garde-corps
 * de bois est fait de deux lisses et de piquets, la glissière d'une lisse en W
 * et de poteaux galvanisés.
 */
export function buildParapets(layer, context, segment, rowsInfo) {
  const { buffers, placements, sampleElevation } = context;
  const { platform, halfWidth, profile } = segment;

  const styleOf = (row) =>
    guardrailStyleFor({ profile, slope: row.slope, curvature: row.curvature, drop: row.drop });

  // Un tronçon par matière : mélanger acier et bois sur la même longueur
  // produirait un raccord au milieu de la courbe, qu'on ne voit nulle part.
  for (const family of ['steel', 'wood']) {
    for (const run of contiguousRuns(rowsInfo, (row) => styleOf(row) === family, 6)) {
      const side = run[Math.floor(run.length / 2)].uphill;
      const origin = run[0].distance;
      const runPath = run.map((row) => ({ x: row.x, z: row.z, distance: row.distance - origin }));
      const deck = new Float32Array(run.map((row) => platform[row.r]));
      const offset = -side * (halfWidth + 0.35);

      const rails = family === 'steel' ? ['guardrailBeam'] : ['woodRail', 'woodRailTop'];
      for (const rail of rails) {
        appendProfile(buffers[rail], {
          path: runPath,
          profile: layer.specs.profiles[rail],
          sampleElevation,
          offset,
          baseHeights: deck,
          closed: true,
        });
      }

      const post = family === 'steel' ? 'guardrailPost' : 'fencePostWood';
      const spacing = family === 'steel' ? 4 : 2.4;
      for (const p of spacedAlongPath(runPath, spacing, { margin: 1 })) {
        // Le poteau se pose sur la plate-forme, pas sur le terrain : la rive
        // aval surplombe le vide, et un poteau posé au sol pendrait sous la
        // lisse.
        const row = Math.min(deck.length - 1, Math.max(0, p.row));
        layer._place(placements, post, {
          x: p.x + p.tz * offset,
          z: p.z - p.tx * offset,
          y: deck[row],
          yaw: roadsideYaw(p.tx, p.tz, offset),
          exactY: true,
        });
      }
    }
  }
}

/**
 * Talus de remblai, là où la plate-forme surplombe le terrain sans qu'un mur
 * ne s'en charge — un simple remblai de rase campagne, en terre et non en
 * pierre. Les lignes déjà tenues par un mur en sont exclues : les deux
 * ouvrages se superposeraient au même endroit.
 *
 * ## Les deux rives, et pas seulement l'aval
 *
 * Sur un versant, une seule rive surplombe : la route est encaissée en amont
 * et portée en aval, et un talus d'un côté suffit. Mais une plate-forme peut
 * dominer le terrain **des deux côtés** — c'est un remblai en pleine terre,
 * et c'est exactement ce qu'est la rampe d'accès d'un pont, que la travée
 * relève sur trente mètres (`roadWorks.BRIDGE_RAMP_M`). Sans le second
 * talus, la route montait vers son pont en ruban volant, l'air visible
 * dessous : le défaut le plus voyant d'un petit ouvrage.
 *
 * Les deux rives sont donc traitées de la même façon, chacune avec son
 * propre surplomb.
 */
export function buildEmbankment(layer, context, segment, rowsInfo, walled) {
  const { buffers, sampleElevation } = context;
  const { platform, halfWidth } = segment;

  // `drop` est le surplomb de la rive aval, `perch` celui de la rive amont —
  // négatif dès qu'il y a un vrai versant, donc le second talus n'apparaît
  // que sur un remblai.
  for (const [dropOf, sideOf] of [
    [(row) => row.drop, (row) => -row.uphill],
    [(row) => row.perch, (row) => row.uphill],
  ]) {
    const keep = (row) => dropOf(row) >= EMBANKMENT_MIN_DROP_M && !walled.has(row.r);
    for (const run of contiguousRuns(rowsInfo, keep, 4)) {
      const side = sideOf(run[Math.floor(run.length / 2)]);
      const drop = run.reduce((max, row) => Math.max(max, dropOf(row)), 0);
      const path = run.map((row) => ({ x: row.x, z: row.z, distance: row.distance }));
      // Un sel par rive : les deux talus d'un remblai en pleine terre partagent
      // leurs lignes, et se creuseraient sinon en miroir.
      const grain = facetJitter(path, EMBANKMENT_SEED + (side > 0 ? 0 : 50), layer.specs.embankmentGrain);
      appendProfile(buffers.embankment, {
        path,
        // La section descend du côté où elle est posée : sur la rive gauche,
        // une section orientée à droite repartirait par-dessus la chaussée.
        profile: layer.specs.embankmentProfile(Math.min(drop, 6), side),
        sampleElevation,
        offset: side * halfWidth,
        baseHeights: new Float32Array(run.map((row) => platform[row.r])),
        scaleUp: grain.up,
        scaleAcross: grain.across,
      });
    }
  }
}

/** Les profils assez larges pour porter une glissière réglementaire. */
export function profileTakesGuardrail(profile) {
  return profile === 'express' || profile === 'major' || profile === 'minor';
}
