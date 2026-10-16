import test from 'node:test';
import assert from 'node:assert/strict';
import { VectorTileSource } from '../src/core/vectorTileSource.js';
import { tileKey, createLocalFrame } from '../src/core/tileMath.js';
import { collectRoadSegmentsSteps } from '../src/layers/roadNetwork.js';
import { finishGeneration } from '../src/core/generationSteps.js';

test('une tuile dense se visite par lots, dans le même ordre et avec le même filtre', () => {
  const source=Object.create(VectorTileSource.prototype);source.zoom=0;
  const features=Array.from({length:100},(_,i)=>({properties:{i},toGeoJSON:()=>({geometry:{type:'Point',coordinates:[i,0]},properties:{i}})}));
  source.tiles=new Map([[tileKey(0,0,0),{x:0,y:0,z:0,tile:{layers:{poi:{length:features.length,feature:i=>features[i]}}}}]]);
  const expected=[],actual=[],keep=p=>p.i%2===0;
  source.forEachFeature('poi',[{x:0,y:0}],(g,p,b)=>expected.push([g,p,b]),keep);
  const steps=source.forEachFeatureSteps('poi',[{x:0,y:0}],(g,p,b)=>actual.push([g,p,b]),keep);
  assert.equal(steps.next().done,false);assert.equal(actual.length,0);
  assert.equal(steps.next().done,false);assert.equal(actual.length,1);
  finishGeneration(steps);assert.deepEqual(actual,expected);
});
test('la collecte urbaine exécute aussi les étapes d’absorption', () => {
  const frame=createLocalFrame(0,45,15);
  const source={forEachFeature(){}};
  const result=finishGeneration(collectRoadSegmentsSteps(source,[],{x:0,z:0},frame,()=>0,900,undefined,{urban:{any:true,covers:()=>true}}));
  assert.deepEqual(result.segments,[]);
});
