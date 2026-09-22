/* Budget et intégrité des objets fréquemment croisés sur la route. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FURNITURE_BUILDERS } from '../src/layers/furnitureKit.js';
test('les détails de proximité restent des volumes finis à budget borné', () => {
  for(const kind of ['utilityPole','busShelter','busShelterMountain','busShelterRural','hayBaleRound','hayBaleSquare','barn','stump']) {
    const model=FURNITURE_BUILDERS[kind]();
    assert.ok(model.vertexCount/3<750,`${kind} : ${model.vertexCount/3} triangles`);
    assert.deepEqual(model.positions,FURNITURE_BUILDERS[kind]().positions,kind);
    for(const v of [...model.positions,...model.normals,...model.colors]) assert.ok(Number.isFinite(v),kind);
  }
});
