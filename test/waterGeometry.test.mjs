/* Vérifie les aires et les interpolants avant toute utilisation graphique. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {area,subtractConvex,intersectConvex,triangulateRings,partitionTriangles,barycentric,boundarySegments} from '../src/core/waterGeometry.js';
const rect=(x,z,w,h)=>[{x,z},{x:x+w,z},{x:x+w,z:z+h},{x,z:z+h}];
const total=parts=>parts.reduce((s,p)=>s+area(p.points??p),0);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≠ ${b}`);
test('rectangle moins rectangle : les fragments conservent exactement leur aire',()=>{const a=rect(0,0,10,10),b=rect(5,-2,10,8);near(total(subtractConvex(a,b)),70);near(area(intersectConvex(a,b)),30);});
test('trou intérieur et concavité triangulée : aucun triangle ne bouche l’île',()=>{const rings=[rect(0,0,10,10),rect(3,3,4,4)];const ts=triangulateRings(rings,THREE.ShapeUtils.triangulateShape);near(total(ts),84);assert.ok(!ts.some(t=>barycentric({x:5,z:5},t)));const concave=[{x:0,z:0},{x:10,z:0},{x:10,z:3},{x:3,z:3},{x:3,z:10},{x:0,z:10}];near(total(triangulateRings([concave],THREE.ShapeUtils.triangulateShape)),51);});
test('coupe sur une arête et tangence presque exacte ne perdent pas d’aire',()=>{const a=rect(0,0,1,1);near(total(subtractConvex(a,rect(1,0,1,1))),1);near(total(subtractConvex(a,rect(1-1e-10,0,1,1))),1);});
test('les nouvelles positions interpolent les poids barycentriques du triangle source',()=>{const a=[{x:0,z:0,weights:[1,0,0]},{x:10,z:0,weights:[0,1,0]},{x:0,z:10,weights:[0,0,1]}];for(const p of subtractConvex(a,rect(2,2,3,3)).flat()){near(p.weights.reduce((a,b)=>a+b),1);near(p.x,p.weights[1]*10);near(p.z,p.weights[2]*10);}});
test('partition des eaux : priorité et aire indépendantes du parcours',()=>{const make=(r,key,priority)=>triangulateRings([r],THREE.ShapeUtils.triangulateShape).map(points=>({points,sourceKey:key,priority}));const candidates=[...make(rect(0,0,10,10),'polygone',0),...make(rect(5,0,10,10),'ruban',1)];const a=partitionTriangles(candidates),b=partitionTriangles(candidates.slice().reverse());assert.deepEqual(a,b);near(total(a),150);near(total(a.filter(t=>t.sourceKey==='polygone')),100);assert.equal(boundarySegments(a).filter(e=>e.a.x===5 && e.b.x===5).length,0);});
