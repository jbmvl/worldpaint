import test from 'node:test';
import assert from 'node:assert/strict';
import { acesFilmic } from '../src/environment/skyModel.js';
import { applyToneMapping, TONE_MAPPING } from '../src/environment/toneMapping.js';

test('acesFilmic : la saturation écarte les canaux de la luminance sans la déplacer', () => {
  const rgb = [0.2, 0.35, 0.08];
  const plain = acesFilmic(rgb, 0.65);
  const vivid = acesFilmic(rgb, 0.65, 1.15);
  const luma = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  assert.ok(Math.abs(luma(plain) - luma(vivid)) < 1e-9);
  assert.ok(vivid[1] - vivid[2] > plain[1] - plain[2]);
  const grey = acesFilmic([0.5, 0.5, 0.5], 0.65);
  acesFilmic([0.5, 0.5, 0.5], 0.65, 1.15).forEach((c, i) => assert.ok(Math.abs(c - grey[i]) < 1e-3, 'un gris reste gris'));
});

test('applyToneMapping : une seule fonction CustomToneMapping, même rappelée', () => {
  const THREE = {
    CustomToneMapping: 5,
    ShaderChunk: { tonemapping_pars_fragment: 'vec3 ACESFilmicToneMapping( vec3 color ) { return color; }\nvec3 CustomToneMapping( vec3 color ) { return color; }\n' },
  };
  const renderer = {};
  applyToneMapping(THREE, renderer);
  applyToneMapping(THREE, renderer, { saturation: 1.3 });
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  assert.equal(chunk.split('vec3 CustomToneMapping(').length, 2);
  assert.ok(chunk.includes('1.3000'));
  assert.equal(renderer.toneMapping, 5);
  assert.equal(renderer.toneMappingExposure, TONE_MAPPING.exposure);
});
