/* Les niveaux sont des références MNT, indépendantes des mailles du rendu. */
import test from 'node:test';import assert from 'node:assert/strict';
import {lakeProfile,waterwayProfile,isotonic} from '../src/core/waterProfiles.js';
import {ElevationField} from '../src/core/elevationField.js';
const ring=[{x:0,z:0},{x:20,z:0},{x:20,z:20},{x:0,z:20}];
test('le lac a une seule cote sur un MNT incliné, quelle que soit sa triangulation',()=>{const p=lakeProfile([ring],x=>0.02*x);assert.equal(p.status,'resolved');assert.equal(p.levelAt(0),p.levelAt(18));assert.ok(p.levelM>0);});
test('une composante ouverte ou un MNT absent conserve un diagnostic incomplet',()=>{assert.equal(lakeProfile([ring],()=>1,{complete:false}).status,'incomplete');assert.equal(lakeProfile([ring],()=>NaN).status,'incomplete');});
test('la médiane est bornée par la rive et une incision injustifiée échoue',()=>{const shore=[{a:ring[0],b:ring[1]}];assert.equal(lakeProfile([ring],(x,z)=>z===0?0:10,{shore}).status,'conflict');});
test('PAVA fusionne les blocs avec leur poids sans propager un minimum',()=>{assert.deepEqual(isotonic([10,6,8,4],[1,1,3,1]),[10,7.5,7.5,4]);});
test('profil descendant : bosse locale lissée, ancres conservées, sections horizontales',()=>{const p=waterwayProfile([{x:0,z:0},{x:80,z:0}],1.5,x=>10-x*0.05+(x===40?0.3:0),{start:10,end:6});assert.equal(p.status,'resolved');assert.equal(p.levels[0],10);assert.equal(p.levels.at(-1),6);assert.ok(p.flowKnown);assert.ok(p.levels.every((h,i)=>i===0||h<=p.levels[i-1]));assert.ok(Math.abs(p.levelAt(40)-8)<0.2);});
test('un canal aux ancres presque égales ne prétend pas connaître le courant',()=>{const p=waterwayProfile([{x:0,z:0},{x:20,z:0}],3,()=>10);assert.equal(p.status,'resolved');assert.equal(p.flowKnown,false);});
test('la référence stricte refuse un pixel manquant sans changer les autres lecteurs',()=>{const f=new ElevationField({zoom:1});f.tilePixels=2;f._store('1/0/0',new Float32Array(4).fill(7));assert.equal(f.sampleTile(0.99,0.5),7);assert.ok(Number.isNaN(f.sampleTileStrict(0.99,0.5)));assert.equal(f.sampleTileStrict(0.5,0.5),7);});
