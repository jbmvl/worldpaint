/*
 * Deux thèmes dans la même page.
 * ------------------------------
 * Le décor se change par injection : `createWorld({ theme })` résout un thème
 * et le descend jusqu'aux couches, qui le gardent chacune sur leur instance.
 * Rien n'en tient de copie ailleurs — c'est ce qui permet à deux mondes de
 * directions artistiques différentes de vivre côte à côte.
 *
 * Ce fichier vérifie cette promesse là où elle peut se rompre, et nulle part
 * ailleurs : aux **points de lecture** du thème (les fonctions pures que les
 * couches appellent) et aux **mémoires** (les caches faibles qui évitent de
 * reconvertir une palette à chaque bâtiment). Un cache indexé par autre chose
 * que la donnée d'entrée ferait exactement le bogue qu'on cherche : le second
 * monde peint avec les couleurs du premier.
 *
 * Chaque lecture est donc appelée **en alternance** A, B, A, B. Une valeur qui
 * dérive à la deuxième passe dénonce un état partagé ; un test qui appellerait
 * A puis B ne verrait rien.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { defaultTheme } from '../src/themes/default.js';
import { resolveTheme } from '../src/themes/theme.js';
import { townPaletteAt, buildingStyleAt, streetSurfaceAt } from '../src/layers/townStyle.js';
import { kerbProfile } from '../src/layers/streetLayer.js';
import { roofRise, roofTriangles, orientedBox } from '../src/layers/roofGeometry.js';
import { waterwayStyleFor } from '../src/layers/waterLayer.js';
import { grassVariantFor } from '../src/layers/groundCover.js';
import { windowGrid } from '../src/layers/buildingLayer.js';
import { forestTypeAt, variantsFor } from '../src/layers/vegetationLayer.js';
import { roadStyleFor } from '../src/layers/roadNetwork.js';
import { furnitureSpecsFor, FURNITURE_BUILDERS } from '../src/layers/furnitureKit.js';
import { hedgeStyleFor, hedgeClumps } from '../src/layers/hedgeGeometry.js';
import { resamplePath } from '../src/layers/ribbonGeometry.js';
import { DEFAULT_SKY_PALETTE } from '../src/environment/sceneEnvironment.js';

/** Un thème contraire au défaut sur chaque tranche qu'on sait lire. */
const OTHER = resolveTheme({
  towns: [
    { name: 'béton', walls: ['#101010', '#202020'], roofs: ['#050505', '#060606'], roofShapes: ['flat', 'flat'] },
  ],
  roofs: { pitch: 0.2, maxRiseM: 1, overhangM: 0 },
  windows: { widthM: 2, heightM: 3, levelM: 6, sillM: 2, litShare: 1 },
  water: { waterways: { river: 40, stream: 20 } },
  grass: { minHeight: 5, maxHeight: 6, aspect: 2, flowerShare: 1, poppyShare: 1 },
  forests: [{ name: 'palmeraie', essences: ['column'], minHeight: 30, maxHeight: 40, density: 0.1, tint: [1, 1, 1] }],
  trees: { variants: defaultTheme.trees.variants, essences: { column: [7, 8] } },
  roads: {
    profiles: { motorwayish: { width: 40 }, express: { width: 40, surface: 'dirt' } },
    surfaces: defaultTheme.roads.surfaces,
    shoulderColor: '#000000',
  },
  furniture: {
    colors: { ...defaultTheme.furniture.colors, stone: [1, 0, 0], stoneDark: [0, 1, 0], white: [0, 0, 1] },
    hedges: {
      ...defaultTheme.furniture.hedges,
      hedge: { ...defaultTheme.furniture.hedges.hedge, heightM: [6, 6], spacingM: 8, gapChance: 0 },
    },
  },
  sky: { fog: '#000000', nightZenith: '#000000', nightHorizon: '#000000' },
  streets: {
    gutterWidth: 1,
    gutterDepth: 0.5,
    kerbHeight: 0.9,
    kerbNose: 0.2,
    walkWidth: [4, 4],
    walkFall: 0,
    skirtWidth: 1,
    skirtDepth: 1,
    gutter: '#000000',
    surfaces: [{ name: 'quai', walk: '#ffffff', kerb: '#ffffff', joint: '#ffffff' }],
  },
});

const DEFAULT = resolveTheme();

/** Appelle deux fois chaque thème, en alternance, et compare aux attendus. */
function interleaved(readA, readB) {
  const a1 = readA();
  const b1 = readB();
  const a2 = readA();
  const b2 = readB();
  assert.deepEqual(a2, a1, 'la lecture du thème A a dérivé après un passage par B');
  assert.deepEqual(b2, b1, 'la lecture du thème B a dérivé après un passage par A');
  return [a1, b1];
}

test('resolveTheme rend un thème complet et gelé', () => {
  const t = resolveTheme({ roofs: { pitch: 0.1, maxRiseM: 1, overhangM: 0 } });
  assert.equal(Object.keys(t).length, Object.keys(defaultTheme).length, 'toutes les tranches sont là');
  assert.equal(t.roofs.pitch, 0.1);
  assert.equal(t.towns, defaultTheme.towns, 'une tranche non donnée est celle du défaut');
  assert.ok(Object.isFrozen(t));
  assert.equal(defaultTheme.roofs.pitch, 0.55, 'le thème par défaut n’a pas bougé');
});

test('resolveTheme refuse une tranche inconnue', () => {
  assert.throws(() => resolveTheme({ rooves: {} }), /rooves/);
});

test('resolveTheme sans surcharge ne fabrique rien', () => {
  assert.equal(resolveTheme(), defaultTheme);
  assert.equal(resolveTheme(null), defaultTheme);
});

test('les palettes de bourg ne se mélangent pas entre deux thèmes', () => {
  const [a, b] = interleaved(
    () => townPaletteAt(1200, 3400, DEFAULT.towns).name,
    () => townPaletteAt(1200, 3400, OTHER.towns).name
  );
  assert.notEqual(a, b);
  assert.equal(b, 'béton');
});

test('l’habillage d’un bâtiment suit le thème qu’on lui donne', () => {
  const [a, b] = interleaved(
    () => buildingStyleAt(500, 500, { area: 120, height: 8 }, DEFAULT.towns),
    () => buildingStyleAt(500, 500, { area: 120, height: 8 }, OTHER.towns)
  );
  assert.equal(b.palette, 'béton');
  assert.equal(b.shape, 'flat');
  assert.notEqual(a.palette, b.palette);
  // Murs noirs contre murs clairs : la couleur passe bien par la palette.
  assert.ok(b.wall[0] < a.wall[0]);
});

test('la pente des toits suit le thème', () => {
  const [a, b] = interleaved(() => roofRise(10, DEFAULT.roofs), () => roofRise(10, OTHER.roofs));
  assert.equal(a, 4.2, 'plafonné par le défaut');
  assert.equal(b, 1);
});

test('le débord de toiture suit le thème', () => {
  const ring = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 6 },
    { x: 0, z: 6 },
  ];
  const box = orientedBox(ring);
  // Étendue en X des sommets du toit : c'est le débord qui la fixe.
  const spread = (roof) => {
    const xs = roof.positions.filter((_, i) => i % 3 === 0);
    return Math.max(...xs) - Math.min(...xs);
  };
  const [a, b] = interleaved(
    () => spread(roofTriangles(box, 5, 'gable', DEFAULT.roofs)),
    () => spread(roofTriangles(box, 5, 'gable', OTHER.roofs))
  );
  assert.ok(a > b, 'un débord nul donne un toit plus étroit');
});

test('les largeurs de cours d’eau suivent le thème', () => {
  const [a, b] = interleaved(
    () => waterwayStyleFor({ class: 'river' }, DEFAULT.water.waterways).halfWidth,
    () => waterwayStyleFor({ class: 'river' }, OTHER.water.waterways).halfWidth
  );
  assert.equal(a, 4.5);
  assert.equal(b, 20);
  // Une classe retirée du thème n'est plus dessinée : c'est bien le thème qui
  // décide, pas une liste que le moteur garderait par-devers lui.
  assert.equal(waterwayStyleFor({ class: 'ditch' }, OTHER.water.waterways), null);
});

test('la part de fleurs suit le thème', () => {
  const meadow = { grass: 1, farmland: 0 };
  const [a, b] = interleaved(
    () => grassVariantFor(meadow, 0.5, DEFAULT.grass),
    () => grassVariantFor(meadow, 0.5, OTHER.grass)
  );
  assert.equal(a, 0, 'au défaut, un tirage à 0,5 ne fleurit pas');
  assert.notEqual(b, 0, 'à 100 % de fleurs, il fleurit');
});

test('la trame des fenêtres suit le thème', () => {
  const [a, b] = interleaved(
    () => windowGrid(24, 12, DEFAULT.windows),
    () => windowGrid(24, 12, OTHER.windows)
  );
  assert.ok(a.columns > b.columns, 'des fenêtres plus larges tiennent moins souvent');
  assert.ok(a.levels > b.levels, 'des niveaux plus hauts en tiennent moins');
});

test('les peuplements suivent le thème', () => {
  const [a, b] = interleaved(
    () => forestTypeAt(800, -400, DEFAULT.forests).name,
    () => forestTypeAt(800, -400, OTHER.forests).name
  );
  assert.notEqual(a, b);
  assert.equal(b, 'palmeraie');
});

test('les essences d’un peuplement suivent le thème', () => {
  const type = { essences: ['column'] };
  const [a, b] = interleaved(
    () => variantsFor(type, DEFAULT.trees.essences),
    () => variantsFor(type, OTHER.trees.essences)
  );
  assert.deepEqual(a, [3, 4]);
  assert.deepEqual(b, [7, 8]);
});

test('les profils de chaussée suivent le thème', () => {
  const [a, b] = interleaved(
    () => roadStyleFor({ class: 'motorway' }, DEFAULT.roads.profiles),
    () => roadStyleFor({ class: 'motorway' }, OTHER.roads.profiles)
  );
  assert.equal(a.halfWidth, 6);
  assert.equal(b.halfWidth, 20);
  assert.equal(a.paved, true);
  assert.equal(b.paved, false, 'le revêtement vient du profil du thème');
});

test('les sections de mobilier sont mémorisées par nuancier, pas globalement', () => {
  const [a, b] = interleaved(
    () => furnitureSpecsFor(DEFAULT.furniture.colors).profiles.dryStoneWall[0].color,
    () => furnitureSpecsFor(OTHER.furniture.colors).profiles.dryStoneWall[0].color
  );
  assert.deepEqual(b, [0, 1, 0], 'le muret prend la pierre du thème');
  assert.notDeepEqual(a, b);

  // Mémorisation : le même nuancier rend le même objet, deux nuanciers non.
  const first = furnitureSpecsFor(OTHER.furniture.colors);
  assert.equal(furnitureSpecsFor(OTHER.furniture.colors), first, 'recalculé à chaque haie');
  assert.notEqual(furnitureSpecsFor(DEFAULT.furniture.colors), first);
});

test('le catalogue de mobilier se construit dans le nuancier qu’on lui donne', () => {
  const colorsOf = (kit) => kit.colors.slice(0, 3);
  const [a, b] = interleaved(
    () => colorsOf(FURNITURE_BUILDERS.milestone(DEFAULT.furniture.colors)),
    () => colorsOf(FURNITURE_BUILDERS.milestone(OTHER.furniture.colors))
  );
  assert.notDeepEqual(a, b, 'la borne suit le nuancier');
});

/*
 * Deux mondes côte à côte.
 * -------------------------
 * Monter deux `WorldComposer` réels demanderait WebGL, un canevas et un réseau :
 * ce n'est pas ce que ces tests peuvent faire, et ce n'est pas là que le partage
 * d'état se produirait. Il se produirait (a) dans une lecture de thème qui
 * ignore ce qu'on lui passe — couvert plus haut, en alternance —, (b) dans une
 * couche que le compositeur oublierait de servir, et (c) dans un thème qu'une
 * couche modifierait pour les autres. Ces deux derniers cas sont vérifiés ici.
 */

import { World } from '../src/world.js';

const fakeComposer = () => ({ dispose() {} });

test('deux mondes gardent chacun leur thème, et aucun ne peut le changer', () => {
  const first = new World({ composer: fakeComposer(), environment: null, elevation: null, ownsElevation: false, theme: DEFAULT });
  const second = new World({ composer: fakeComposer(), environment: null, elevation: null, ownsElevation: false, theme: OTHER });

  assert.notEqual(first.theme, second.theme);
  assert.equal(first.theme.towns[0].name, 'calcaire');
  assert.equal(second.theme.towns[0].name, 'béton');

  // Gelé : une couche qui tenterait d'écrire dedans échoue au lieu de repeindre
  // silencieusement le monde voisin.
  assert.throws(() => {
    'use strict';
    second.theme.roofs = null;
  });
  assert.equal(first.theme.towns[0].name, 'calcaire', 'le premier monde est intact');
});

test('le compositeur sert le thème à toutes les couches qu’il monte', () => {
  // Une couche ajoutée sans `theme` prendrait le thème par défaut en silence, et
  // le second monde peindrait une moitié de son décor avec la palette du
  // premier. C'est le genre d'oubli qu'aucun test de rendu ne rattrape.
  const source = readFileSync('src/worldComposer.js', 'utf8');
  const constructions = source.match(/new [A-Z]\w+\(\{[\s\S]*?\}\)/g) || [];
  assert.ok(constructions.length >= 8, 'toutes les couches sont montées ici');
  for (const call of constructions) {
    const name = call.slice(4, call.indexOf('('));
    // Deux exceptions, et elles ne peignent ni l'une ni l'autre : la carte de
    // classes est un raster d'occupation du sol, la source vectorielle est un
    // cache de tuiles.
    if (name === 'GroundClassMap' || name === 'VectorTileSource') continue;
    assert.ok(/\btheme\b/.test(call), `${name} est monté sans thème`);
  }
});

/*
 * Le garde-fou structurel. Une variable de module qui garderait un thème, une
 * palette convertie ou un catalogue construit serait invisible dans les tests
 * ci-dessus tant qu'un seul monde existe — et casserait le second. On interdit
 * donc l'état mutable de module, en nommant les exceptions une par une.
 */
const ALLOWED_MODULE_STATE = {
  'materials/foliageMaterial.js': ['leanWarned'],
  // La grille climatique décodée. C'est la seule mémoire de module qui ne
  // puisse pas fuir d'un monde à l'autre : elle ne dépend d'aucune entrée — ni
  // thème, ni scène, ni observateur —, elle est en lecture seule une fois
  // remplie, et sa valeur est la même pour tout le monde. La garder paresseuse
  // évite de décoder 266 000 cellules dans une application qui ne demande
  // jamais de climat.
  'core/climate.js': ['cells'],
};

function sourceFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, base));
    else if (entry.endsWith('.js')) out.push([full.slice(base.length + 1), full]);
  }
  return out;
}

test('aucun module ne garde d’état mutable non déclaré', () => {
  for (const [name, path] of sourceFiles('src')) {
    const allowed = ALLOWED_MODULE_STATE[name] || [];
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^(?:let|var) (\w+)/.exec(line);
      if (!match) continue;
      assert.ok(
        allowed.includes(match[1]),
        `état de module non déclaré : ${name} → ${match[1]}`
      );
    }
  }
});

test('la voirie ne mélange pas les revêtements de deux thèmes', () => {
  // Même point, deux thèmes : la conversion en linéaire est mémorisée par
  // tranche, donc une mémoire mal indexée peindrait le second bourg avec le
  // béton du premier.
  const [a, b] = interleaved(
    () => streetSurfaceAt(1200, 3400, DEFAULT.streets).name,
    () => streetSurfaceAt(1200, 3400, OTHER.streets).name
  );
  assert.notEqual(a, b);
  assert.equal(b, 'quai');
});

test('la section d’une rue est celle du thème qu’on lui donne', () => {
  const tones = streetSurfaceAt(0, 0, OTHER.streets);
  const [a, b] = interleaved(
    () => kerbProfile({ halfWidth: 3, walkWidth: 2, side: 1, tones: streetSurfaceAt(0, 0, DEFAULT.streets) }, DEFAULT.streets).map((v) => v.up),
    () => kerbProfile({ halfWidth: 3, walkWidth: 2, side: 1, tones }, OTHER.streets).map((v) => v.up)
  );
  assert.notDeepEqual(a, b);
  assert.ok(Math.max(...b) >= OTHER.streets.kerbHeight, 'la bordure du second thème est un quai');
  assert.ok(Math.max(...a) < 0.3, 'celle du défaut reste une marche');
});

test('le ciel est une tranche du thème', () => {
  assert.deepEqual(Object.keys(DEFAULT.sky).sort(), ['fog', 'nightHorizon', 'nightZenith']);
  assert.equal(DEFAULT.sky.fog, '#e8eef3');
  assert.equal(OTHER.sky.fog, '#000000');
  // Le brouillard et le raccord d'horizon lisent la même valeur : c'est cette
  // égalité qui empêche une couture entre le terrain lointain et le ciel.
  assert.equal(DEFAULT_SKY_PALETTE, defaultTheme.sky, 'l’alias public désigne la tranche, sans copie');
});

test('les feux tricolores éteints sortent du nuancier', () => {
  const [a, b] = interleaved(
    () => furnitureSpecsFor(DEFAULT.furniture.colors).trafficLenses.map((l) => l.dark),
    () => furnitureSpecsFor(OTHER.furniture.colors).trafficLenses.map((l) => l.dark),
  );
  assert.equal(a.length, 3);
  a.forEach((dark, i) => assert.deepEqual(dark, b[i], 'le nuancier de test ne change pas ces trois-là'));
  a.forEach((dark) => assert.ok(dark.every((c) => c >= 0 && c < 0.2), 'un feu au repos reste sombre'));
});

test('la haie prend ses arbustes du thème, et son budget du moteur', () => {
  const path = resamplePath([{ x: 0, z: 0 }, { x: 80, z: 0 }], 3);
  const here = { x: 0, z: 0 };
  const [a, b] = interleaved(
    () => hedgeClumps(path, { style: hedgeStyleFor('hedge', DEFAULT.furniture.hedges), here }).length,
    () => hedgeClumps(path, { style: hedgeStyleFor('hedge', OTHER.furniture.hedges), here }).length
  );
  assert.ok(a > b, 'un écartement plus large donne moins d’arbustes');
  const length = path[path.length - 1].distance;
  assert.equal(b, Math.floor(length / 8) + 1, 'l’écartement du thème est celui qui s’applique');

  // La portée de détail est un budget de moteur : elle ne bouge pas d’un thème
  // à l’autre, quand bien même le reste des cotes change du tout au tout.
  assert.equal(
    hedgeStyleFor('hedge', OTHER.furniture.hedges).detailRadiusM,
    hedgeStyleFor('hedge', DEFAULT.furniture.hedges).detailRadiusM,
    'le thème ne décide pas jusqu’où on détaille'
  );
  const [tall] = hedgeClumps(path, { style: hedgeStyleFor('hedge', OTHER.furniture.hedges), here });
  assert.equal(tall.height, 6, 'l’arbuste fait la taille que le thème lui donne');
});
