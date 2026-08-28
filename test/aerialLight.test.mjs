/*
 * La lumière restée dans l'air.
 * ------------------------------
 * On ne teste pas ici que c'est joli — ça ne se teste pas. On teste les deux
 * choses qui, fausses, ne se verraient qu'à l'œil et seulement à la bonne
 * heure : que l'effet s'éteint quand il doit s'éteindre, et que le repère dans
 * lequel le motif est tiré est bien perpendiculaire au soleil. Une inversion
 * sur l'un ou l'autre donne un décor lavé à midi ou des faisceaux couchés.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { aerialLightIntensity, sunBasis } from '../src/environment/aerialLight.js';
import { defaultTheme } from '../src/themes/default.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('l’air ne rend rien quand le soleil est sous l’horizon', () => {
  assert.equal(aerialLightIntensity({ sunY: -0.2 }), 0);
  assert.equal(aerialLightIntensity({ sunY: -0.01 }), 0);
});

test('l’air ne rend rien quand le soleil est haut', () => {
  assert.equal(aerialLightIntensity({ sunY: 0.45 }), 0);
  assert.equal(aerialLightIntensity({ sunY: 0.9 }), 0);
});

test('c’est au ras de l’horizon que l’air rend le plus', () => {
  const rasant = aerialLightIntensity({ sunY: 0.1 });
  const oblique = aerialLightIntensity({ sunY: 0.3 });
  assert.ok(rasant > 0.5, `attendu franc au rasant, obtenu ${rasant}`);
  assert.ok(rasant > oblique, 'un soleil qui monte doit éteindre l’effet');
  assert.ok(oblique > 0, 'et l’éteindre progressivement, pas d’un coup');
});

test('un ciel bouché n’a plus de faisceau à donner', () => {
  const clair = aerialLightIntensity({ sunY: 0.12, cloudCover: 0 });
  const couvert = aerialLightIntensity({ sunY: 0.12, cloudCover: 1 });
  assert.ok(couvert < clair * 0.2, `attendu quasi éteint, obtenu ${couvert} contre ${clair}`);
});

test('l’intensité de référence du thème multiplie, elle ne remplace pas', () => {
  const part = aerialLightIntensity({ sunY: 0.12 });
  const doublee = aerialLightIntensity({ sunY: 0.12, strength: 2 });
  assert.ok(Math.abs(doublee - part * 2) < 1e-12);
  assert.equal(aerialLightIntensity({ sunY: 0.12, strength: 0 }), 0);
});

test('le repère du motif est orthonormé et perpendiculaire au soleil', () => {
  for (const sun of [
    { x: 0.9, y: 0.1, z: 0.4 },
    { x: -0.3, y: 0.94, z: 0.15 },
    { x: 0, y: 1, z: 0 }, // zénith : le cas dégénéré du produit vectoriel
    { x: 0, y: -1, z: 0 },
  ]) {
    const { right, up } = sunBasis(sun);
    const norm = Math.hypot(sun.x, sun.y, sun.z);
    const unit = [sun.x / norm, sun.y / norm, sun.z / norm];
    assert.ok(Math.abs(Math.hypot(...right) - 1) < 1e-9, 'right unitaire');
    assert.ok(Math.abs(Math.hypot(...up) - 1) < 1e-9, 'up unitaire');
    assert.ok(Math.abs(dot(right, up)) < 1e-9, 'right ⟂ up');
    assert.ok(Math.abs(dot(right, unit)) < 1e-9, 'right ⟂ soleil');
    assert.ok(Math.abs(dot(up, unit)) < 1e-9, 'up ⟂ soleil');
  }
});

test('l’air est une tranche du thème, avec un interrupteur à zéro', () => {
  assert.deepEqual(Object.keys(defaultTheme.air).sort(), ['phaseG', 'rarity', 'scaleM', 'strength']);
  assert.ok(defaultTheme.air.strength > 0);
  // Le seuil de rareté doit laisser une part du motif éteinte, sinon les
  // faisceaux couvrent tout le sous-bois au lieu d'y être rares.
  assert.ok(defaultTheme.air.rarity > 0.5 && defaultTheme.air.rarity < 1);
  // Une anisotropie nulle rendrait l'effet indépendant de la direction du
  // regard, c'est-à-dire un voile clair uniforme.
  assert.ok(defaultTheme.air.phaseG > 0.5 && defaultTheme.air.phaseG < 0.95);
});
