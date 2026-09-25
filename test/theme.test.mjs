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
import { filterByWords, VOCABULARIES } from '../src/core/regionInterpretation.js';
import { REGIONS } from '../src/core/regions.js';
import { skyPaletteFor } from '../src/environment/sceneEnvironment.js';
import { resolveTheme } from '../src/themes/theme.js';
import { townPaletteAt, buildingStyleAt, streetSurfaceAt } from '../src/layers/townStyle.js';
import { kerbProfile } from '../src/layers/streetLayer.js';
import { roofRise } from '../src/layers/roofGeometry.js';
import { waterwayStyleFor, SURFACE_KINDS } from '../src/terrain/groundClassMap.js';
import { grassVariantFor } from '../src/layers/groundCover.js';
import { windowGrid } from '../src/layers/buildingLayer.js';
import { forestTypeAt, variantsFor } from '../src/layers/vegetationLayer.js';
import { roadStyleFor } from '../src/layers/roadNetwork.js';
import { furnitureSpecsFor, FURNITURE_BUILDERS } from '../src/layers/furnitureKit.js';
import { hedgeStyleFor, hedgeClumps } from '../src/layers/hedgeGeometry.js';
import { resamplePath } from '../src/layers/ribbonGeometry.js';
import { DEFAULT_SKY_PALETTE, twilightGlow, tintByPalette } from '../src/environment/sceneEnvironment.js';

/** Un thème contraire au défaut sur chaque tranche qu'on sait lire. */
const OTHER = resolveTheme({
  towns: [
    { name: 'béton', walls: ['#101010', '#202020'], roofs: ['#050505', '#060606'], roofShapes: ['flat', 'flat'] },
  ],
  roofs: { pitch: 0.2, maxRiseM: 1 },
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
    kerbHeight: 0.9,
    kerbWidth: 0.4,
    gutter: '#000000',
    surfaces: [{ name: 'quai', kerb: '#ffffff' }],
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
  const t = resolveTheme({ roofs: { pitch: 0.1, maxRiseM: 1 } });
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
    // Trois exceptions, et aucune ne peint : la carte de classes est un raster
    // d'occupation du sol, la source vectorielle un cache de tuiles, le masque
    // urbain un prédicat de lieu (« sommes-nous en ville ? »).
    if (name === 'GroundClassMap' || name === 'VectorTileSource' || name === 'UrbanMask') continue;
    assert.ok(/\btheme\b/.test(call), `${name} est monté sans thème`);
  }
});

test('le sol et ce qui y pousse lisent le même facteur', () => {
  // Le sol lointain est peint par le shader, le premier plan par des touffes
  // et des tiges instanciées, et les trois doivent bouger du même rapport
  // quand on change de pays — sinon on voit un disque de couleur différente
  // autour de l'observateur, ce qui est le défaut que le calage des albédos
  // (`TERRAIN_LOOK.grassAlbedo`) existe pour éviter.
  //
  // On ne peut pas le vérifier en montant les trois (il faudrait WebGL et un
  // canevas), mais on peut vérifier qu'il n'y a **qu'une** source : chacun
  // passe par `soilWashFor`, et aucun ne va lire la tranche du thème
  // lui-même.
  for (const file of [
    'src/terrain/terrainMaterial.js',
    'src/layers/groundCover.js',
    'src/layers/cropLayer.js',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /soilWashFor\(/, `${file} passe par le résolveur`);
    // Le mot apparaît en commentaire et dans le passage de la tranche au
    // résolveur ; ce qui est interdit, c'est d'aller y chercher une famille.
    assert.equal(
      /soils\s*(\[|\.[a-z])/i.test(source),
      false,
      `${file} lit la tranche directement`
    );
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
  // Les ancres de région, à plat. C'est la seule mémoire de module qui ne
  // puisse pas fuir d'un monde à l'autre : elles ne dépendent d'aucune entrée —
  // ni thème, ni scène, ni observateur —, elles sont en lecture seule une fois
  // dressées, et leur valeur est la même pour tout le monde.
  'core/region.js': ['anchors'],
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
    () => kerbProfile({ halfWidth: 3, side: 1, tones: streetSurfaceAt(0, 0, DEFAULT.streets) }, DEFAULT.streets).map((v) => v.up),
    () => kerbProfile({ halfWidth: 3, side: 1, tones }, OTHER.streets).map((v) => v.up)
  );
  assert.notDeepEqual(a, b);
  assert.equal(Math.min(...b), -OTHER.streets.kerbHeight, 'la profondeur vient du thème');
  assert.equal(Math.max(...a), 0, 'le béton affleure au support');
});

test('le ciel est une tranche du thème', () => {
  assert.deepEqual(Object.keys(DEFAULT.sky).sort(), [
    'fog',
    'nightHorizon',
    'nightZenith',
    'variants',
  ]);
  assert.equal(DEFAULT.sky.fog, '#e8eef3');
  assert.equal(OTHER.sky.fog, '#000000');
  // Une tranche de ciel sans variantes est une tranche valide : c'est le cas
  // d'un thème écrit avant qu'elles existent, et le pays n'y touche rien.
  assert.equal(skyPaletteFor('desert_stone', OTHER.sky), null);
  assert.equal(skyPaletteFor(null, DEFAULT.sky), null, 'sans pays, rien à imposer');
  // Une variante ne redit que ce qu'elle change : le reste vient de la base.
  const sec = skyPaletteFor('desert_stone', DEFAULT.sky);
  assert.notEqual(sec.fog, DEFAULT.sky.fog, 'l’air d’un pays sec n’est pas celui d’une côte');
  assert.equal(sec.nightZenith, DEFAULT.sky.nightZenith, 'ce qu’elle ne dit pas ne change pas');
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
  // Pris au milieu : les arbustes des deux bouts rentrent avec le museau de la
  // haie (`hedgeNoseFactor`), et ne valent donc pas leur cote nominale.
  const clumps = hedgeClumps(path, { style: hedgeStyleFor('hedge', OTHER.furniture.hedges), here });
  const tall = clumps[Math.floor(clumps.length / 2)];
  assert.equal(tall.height, 6, 'l’arbuste fait la taille que le thème lui donne');
});

/*
 * Le garde-fou de couverture.
 *
 * `filterByWords` retombe volontairement sur la liste entière quand un pays n'a
 * aucun contenu : lever à cet endroit-là aborterait `refresh` et emporterait
 * toutes les couches suivantes. Le prix de cette prudence est qu'un pays oublié
 * ne se signale pas — il rend un décor générique, en silence. C'est donc ici
 * qu'il doit se signaler, franchement.
 *
 * La question n'est pas « chaque entrée du thème est-elle atteignable » : le
 * thème a le droit de décrire une Scandinavie qu'aucune région n'atteint
 * encore. C'est l'inverse qui doit tenir — aucune région ne doit se peindre
 * avec la liste entière faute d'avoir trouvé quoi que ce soit à elle.
 *
 * Sauf quand elle n'emploie que des mots que le décor ne sait pas rendre : le
 * repli générique est alors la promesse tenue de `unsupported`, et l'inventaire
 * du test des régions dit déjà ce qui manque.
 */
test('chaque région trouve dans le thème un peuplement et une palette à elle', () => {
  const rendu = (region, field) =>
    region[field].filter((word) => !VOCABULARIES[field][word]?.unsupported);

  for (const region of REGIONS) {
    const forests = DEFAULT.forests.filter((type) =>
      type.species?.some((word) => region.trees.includes(word))
    );
    assert.ok(forests.length >= 1, `${region.id} : aucun peuplement`);

    if (rendu(region, 'building').length === 0) continue;
    const towns = DEFAULT.towns.filter((palette) =>
      palette.materials?.some((word) => region.building.includes(word))
    );
    assert.ok(towns.length >= 1, `${region.id} : aucune palette de bourg`);
  }
});

test('un pays que le thème ne connaît pas ne vide pas le décor', () => {
  // Le repli est la liste entière, jamais rien : un pays inconnu rend un
  // paysage générique, pas un paysage nu.
  const pool = filterByWords(DEFAULT.forests, 'species', ['essence-inventée']);
  assert.equal(pool.length, DEFAULT.forests.length);
});

test('la mémoire des palettes est indexée par nuancier ET par région', () => {
  // Deux mémoires se superposent ici : la conversion en linéaire, et le
  // filtrage par matériaux. Une seconde mal indexée peindrait un village
  // andalou avec le bois d'un village finlandais, et seulement quand les deux
  // sont demandés dans le même ordre.
  const boreale = { id: 'test-nord', building: ['red_timber'] };
  const andalouse = { id: 'test-sud', building: ['whitewash', 'flat_roof'] };
  const [nord, sud] = interleaved(
    () => townPaletteAt(4200, 1400, DEFAULT.towns, boreale).name,
    () => townPaletteAt(4200, 1400, DEFAULT.towns, andalouse).name
  );
  assert.notEqual(nord, sud);
  const cite = (name, region) =>
    DEFAULT.towns
      .find((p) => p.name === name)
      .materials.some((word) => region.building.includes(word));
  assert.ok(cite(nord, boreale), `${nord} est bâtie dans un matériau du nord`);
  assert.ok(cite(sud, andalouse), `${sud} est bâtie dans un matériau du sud`);
  // Et sans pays, on retrouve exactement le tirage d'avant les régions.
  assert.equal(townPaletteAt(4200, 1400, DEFAULT.towns).name, townPaletteAt(4200, 1400).name);
});

/** Luminance perçue (Rec. 709), la même pondération que `wetGround` du shader. */
const perceivedLuma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('deux matières se distinguent par la couleur, à distance RGB minimale', () => {
  // Règle A : chaque paire de matières s'écarte d'au moins 0,06 en distance
  // RGB — sans quoi deux matières se peignent de la même couleur et ne se
  // distinguent plus que par leur silhouette et leur mobilier. Seule
  // exemption : `scree`, `rock` et `pavement` entre elles, dont la parenté est
  // géologique — c'est la même roche que la matrice du pays reteinte.
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const exempt = new Set(['scree', 'rock', 'pavement']);
  for (let i = 0; i < SURFACE_KINDS.length; i++) {
    for (let j = i + 1; j < SURFACE_KINDS.length; j++) {
      const a = SURFACE_KINDS[i];
      const b = SURFACE_KINDS[j];
      if (exempt.has(a) && exempt.has(b)) continue;
      const d = dist(defaultTheme.surfaces[a].albedo, defaultTheme.surfaces[b].albedo);
      assert.ok(d >= 0.06, `${a} / ${b} : distance ${d.toFixed(4)}`);
    }
  }
});

test('les matières végétales se distinguent en outre par la luminance ou la dominante', () => {
  // Règle B : la distance seule ne suffit pas entre végétaux — deux couleurs
  // peuvent s'écarter en teinte sans s'écarter en luminance ni en dominante,
  // et c'est justement la luminance (ce qui reste lisible à cent mètres) qui
  // fait la silhouette d'un biome. Il faut donc, en plus de la règle A, un
  // écart de luminance perçue d'au moins 0,025 OU un écart du rapport
  // rouge/vert d'au moins 0,25.
  const vegetal = ['grass', 'wood', 'heath', 'scrub', 'wetland', 'saltmarsh', 'alpine', 'settled'];
  for (let i = 0; i < vegetal.length; i++) {
    for (let j = i + 1; j < vegetal.length; j++) {
      const a = defaultTheme.surfaces[vegetal[i]].albedo;
      const b = defaultTheme.surfaces[vegetal[j]].albedo;
      const dLuma = Math.abs(perceivedLuma(a) - perceivedLuma(b));
      const dRatio = Math.abs(a[0] / a[1] - b[0] / b[1]);
      assert.ok(
        dLuma >= 0.025 || dRatio >= 0.25,
        `${vegetal[i]} / ${vegetal[j]} : Δluma ${dLuma.toFixed(4)}, Δ(R/G) ${dRatio.toFixed(4)}`
      );
    }
  }
});

test('l’échelle de luminance végétale vise les valeurs de la fiche, à 0,008 près', () => {
  // grass et alpine sont fixes : le reste du décor se règle par rapport à eux.
  const target = {
    wood: 0.066,
    wetland: 0.091,
    grass: 0.109,
    heath: 0.118,
    saltmarsh: 0.143,
    settled: 0.172,
    scrub: 0.2,
    alpine: 0.233,
  };
  for (const [kind, expected] of Object.entries(target)) {
    const luma = perceivedLuma(defaultTheme.surfaces[kind].albedo);
    assert.ok(
      Math.abs(luma - expected) <= 0.008,
      `${kind} : luminance ${luma.toFixed(4)} pour ${expected} visé`
    );
  }
  assert.deepEqual(defaultTheme.surfaces.grass.albedo, [0.051, 0.135, 0.017], 'grass est fixe');
  assert.deepEqual(defaultTheme.surfaces.alpine.albedo, [0.205, 0.254, 0.107], 'alpine est fixe');
});

test('chaque matière retouchée porte la dominante de sa fiche de biome', () => {
  const r = (kind) => defaultTheme.surfaces[kind].albedo[0];
  const g = (kind) => defaultTheme.surfaces[kind].albedo[1];
  const b = (kind) => defaultTheme.surfaces[kind].albedo[2];
  assert.ok(g('wood') >= r('wood') && r('wood') >= 0.45 * g('wood'), 'bois : vert mêlé d’un quart de brun, vert ≥ rouge ≥ 0,45 × vert');
  assert.ok(r('wetland') >= 0.65 * g('wetland'), 'marais : olive profond, rouge ≥ 0,65 × vert');
  assert.ok(r('heath') >= 1.4 * g('heath'), 'lande : pourpre-brun, rouge ≥ 1,40 × vert');
  assert.ok(g('saltmarsh') >= r('saltmarsh'), 'pré salé : gris froid, vert ≥ rouge');
  assert.ok(r('mud') >= 1.25 * b('mud'), 'vasière : chaude, rouge ≥ 1,25 × bleu');
  assert.ok(r('bare') >= g('bare') && g('bare') >= b('bare'), 'sol nu : plus terreux, rouge ≥ vert ≥ bleu');
  assert.ok(
    r('pavement') >= g('pavement') && g('pavement') >= b('pavement'),
    'sol piéton : gris chaud, rouge ≥ vert ≥ bleu'
  );

  const town = defaultTheme.streets.pavement.default;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [tr, tg, tb] = hex(town);
  assert.ok(tr >= tg && tg >= tb, `le sol urbain conserve une dominante chaude : ${town}`);
});

test('les matières non concernées par le chantier gardent leur couleur', () => {
  const unchanged = {
    grass: [0.051, 0.135, 0.017],
    farmland: [0.431, 0.331, 0.08],
    alpine: [0.205, 0.254, 0.107],
    sand: [0.624, 0.539, 0.361],
    ice: [0.6, 0.66, 0.72],
    water: [0.021, 0.045, 0.06],
    scree: [0.323, 0.292, 0.254],
    rock: [0.371, 0.332, 0.27],
  };
  for (const [kind, albedo] of Object.entries(unchanged)) {
    assert.deepEqual(defaultTheme.surfaces[kind].albedo, albedo, `${kind} n’a pas bougé`);
  }
});

test('la lueur du crépuscule s’éteint avec lui', () => {
  const dayFog = [0.8, 0.85, 0.9];
  const nuit = twilightGlow(dayFog, 0);
  assert.deepEqual([...nuit.horizon, ...nuit.zenith], [0, 0, 0, 0, 0, 0]);
  const coucher = twilightGlow(dayFog, 1);
  for (let i = 0; i < 3; i++) {
    assert.ok(coucher.horizon[i] > 0);
    assert.ok(coucher.zenith[i] > 0);
  }
  assert.ok(coucher.horizon[0] > coucher.horizon[2], 'chaude à l’horizon');
  assert.ok(coucher.zenith[2] > coucher.zenith[0], 'bleue au zénith');
});

test('le brouillard de jour prend la lumière du ciel et la teinte de la palette', () => {
  const sky = [0.5, 0.6, 0.8];
  const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const neutre = tintByPalette(sky, [0.7, 0.7, 0.7]);
  assert.ok(Math.abs(lum(neutre) - lum(sky)) < 1e-9, 'palette neutre : la lumière du ciel');
  assert.ok(neutre[2] / neutre[0] < sky[2] / sky[0], 'moins saturé que le ciel');
  assert.ok(neutre[2] > neutre[0], 'mais encore de sa teinte');
  const chaude = tintByPalette(sky, [0.9, 0.7, 0.5]);
  assert.ok(Math.abs(lum(chaude) - lum(sky)) < 1e-9, 'même lumière que le ciel');
  assert.ok(chaude[0] / chaude[2] > sky[0] / sky[2], 'réchauffée par la palette');
});
