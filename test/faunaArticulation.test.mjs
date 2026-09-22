/* Intégrité des articulations et trajectoire de bond indépendante du rendu. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFaunaGeometries, FAUNA_SPECIES } from '../src/models/fauna/index.js';
import { faunaBodyPose, faunaStride } from '../src/layers/faunaLayer.js';
test('chaque espèce porte des genoux uniquement sur ses pattes et rattache les oreilles à la tête', () => {
  const {geometries} = createFaunaGeometries(THREE);
  for (const [kind, geometry] of Object.entries(geometries)) {
    const a=geometry.attributes;
    assert.equal(a.aRunLead.count,a.position.count,kind);
    if (kind === "horse") assert.ok(a.aRunLead.array.some(v=>v>0));
    if (kind === "deer") assert.ok(a.aRunLead.array.every(v=>v===0));
    assert.equal(a.aKnee.count,a.position.count,kind);
    assert.equal(a.aHeadParent.count,a.position.count,kind);
    let knees=0;
    for(let i=0;i<a.position.count;i++) {
      const limb=a.aLimb.getX(i);
      if(a.aKnee.getW(i)) { assert.ok(limb>=1 && limb<=4,kind); knees++; }
      assert.equal(a.aHeadParent.getW(i),limb===7?1:0,kind);
      for (const name of ['position','normal','aKnee','aHeadParent']) {
        assert.ok(Number.isFinite(a[name].getX(i)),kind);
        assert.ok(Number.isFinite(a[name].getY(i)),kind);
        assert.ok(Number.isFinite(a[name].getZ(i)),kind);
      }
    }
    assert.ok(knees>0,kind);
    geometry.dispose();
  }
});
test('le bond alterne appui et vol, reste au-dessus du sol et se raccorde sans saut', () => {
  const pose=p=>faunaBodyPose(p,1.5,1,1.6);
  assert.equal(pose(0).lift,0);
  assert.ok(pose(Math.PI).lift>.4);
  assert.equal(pose(Math.PI*1.9).lift,0);
  for(let p=0;p<Math.PI*2;p+=.03) {
    assert.ok(pose(p).lift>=0);
    assert.ok(Math.abs(pose(p+.001).lift-pose(p).lift)<.002);
  }
  assert.ok(Math.abs(pose(Math.PI*2-1e-5).pitch-pose(0).pitch)<1e-5);
  assert.equal(faunaBodyPose(2,0,0,1).lift,0);
});

test('les bonds couvrent plusieurs mètres et les allures calmes respectent les espèces', () => {
  for(const kind of ['fox','deer','doe','goat','reindeer']) {
    const spec=FAUNA_SPECIES[kind];
    const stride=faunaStride(spec,spec.runMS);
    assert.ok(stride>=3.8,kind);
    assert.ok(stride/spec.runMS>1.2,kind);
  }
  for(const kind of ['wolf','cat','dog','bear']) {
    const spec=FAUNA_SPECIES[kind];
    assert.ok(!spec.bound && !spec.gallop,kind);
    assert.ok(spec.runMS<=1.8,kind);
  }
  assert.equal(FAUNA_SPECIES.bear.runMS,FAUNA_SPECIES.bear.walkMS);
});
