/*
 * Les lieux OSM habillent les volumes existants et leurs parties, sans
 * transformer les voisins ni doubler le mobilier des châteaux.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assignPersonalities, buildingPersonalityFor, personalityLookFor, outerRings } from '../src/layers/buildingLayer.js';
import { createLocalFrame } from '../src/core/tileMath.js';
import { ringArea, orientedBox } from '../src/layers/roofGeometry.js';
import { castleTowers, appendChurchWindows, appendRetailSign } from '../src/layers/buildingCharacterGeometry.js';
import { poiItem } from '../src/layers/furniture/pointsOfInterest.js';

const rectangle = (x0, z0, x1, z1) => {
  const footprint = [{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}];
  return { footprint,area:ringArea(footprint),x:(x0+x1)/2,z:(z0+z1)/2,minX:x0,maxX:x1,minZ:z0,maxZ:z1 };
};
test('les parties d’un édifice partagent son style, avec un seul clocher', () => {
  const outline=rectangle(0,0,30,20),nef=rectangle(0,0,20,20),part=rectangle(20,0,30,10),neighbor=rectangle(31,0,40,10);
  const poi={x:5,z:5,kind:'church'};
  const owners=assignPersonalities([nef,part,neighbor],[poi],[outline]);
  assert.equal(owners.get(nef),poi);
  assert.equal(owners.get(part).kind,'church');
  assert.equal(owners.get(part).secondary,true);
  assert.equal(owners.has(neighbor),false);
  assert.deepEqual([...assignPersonalities([neighbor,part,nef],[poi],[outline])],[...owners]);
});
test('un commerce sur un contour masqué ne multiplie pas les devantures', () => {
  const outline=rectangle(0,0,30,20),main=rectangle(0,0,20,20),part=rectangle(20,0,30,10);
  const poi={x:25,z:15,kind:'retail'};
  const owners=assignPersonalities([part,main],[poi],[outline]);
  assert.equal(owners.size,1);
  assert.equal(owners.get(main),poi);
});
test('les tags directs d’édifice et de supermarché sont interprétés', () => {
  assert.equal(buildingPersonalityFor({building:'cathedral'}),'church');
  assert.equal(buildingPersonalityFor({historic:'castle'}),'castle');
  assert.equal(buildingPersonalityFor({shop:'supermarket'}),'retail');
  assert.equal(buildingPersonalityFor({class:'supermarket'}),'retail');
  assert.equal(buildingPersonalityFor({class:'castle',subclass:'ruins'}),null);
  assert.equal(poiItem({class:'castle',subclass:'castle'}),null);
});
test('les trois lieux de Montreuil-Bellay choisissent leurs empreintes réelles', () => {
  const cases=JSON.parse(readFileSync(new URL('./fixtures/building-personalities-montreuil.json',import.meta.url)));
  for(const [index,item] of cases.entries()) {
    const frame=createLocalFrame(...item.poi.geometry.coordinates,14);
    const candidates=item.buildings.flatMap(b=>outerRings(b.geometry).map(r=>{
      const footprint=r.map(p=>frame.toLocal(...p));
      return {footprint,area:ringArea(footprint),x:0,z:0,minX:Math.min(...footprint.map(p=>p.x)),maxX:Math.max(...footprint.map(p=>p.x)),minZ:Math.min(...footprint.map(p=>p.z)),maxZ:Math.max(...footprint.map(p=>p.z))};
    }));
    const kind=buildingPersonalityFor(item.poi.properties);
    assert.equal(kind,['castle','church','retail'][index]);
    const owners=assignPersonalities(candidates,[{...frame.toLocal(...item.poi.geometry.coordinates),kind}]);
    assert.equal(owners.size,1,item.name);
    assert.equal([...owners.values()][0].kind,kind);
  }
});
test('les tours suivent la rotation du château sans dépendre du parcours', () => {
  const ring=rectangle(-20,-10,20,10).footprint;
  const look=personalityLookFor('castle');
  const towers=castleTowers(ring,orientedBox(ring),0,9,look);
  assert.equal(towers.length,4);
  assert.deepEqual(castleTowers(ring.slice().reverse(),orientedBox(ring.slice().reverse()),0,9,look).map(t=>[t.x,t.z]).sort(),towers.map(t=>[t.x,t.z]).sort());
  const angle=0.7,c=Math.cos(angle),s=Math.sin(angle);
  const rotated=ring.map(p=>({x:p.x*c-p.z*s,z:p.x*s+p.z*c}));
  const moved=castleTowers(rotated,orientedBox(rotated),0,9,look);
  for(const t of towers) assert.ok(moved.some(q=>Math.hypot(q.x-(t.x*c-t.z*s),q.z-(t.x*s+t.z*c))<1e-6));
  assert.ok(towers.every(t=>t.kit.positions.every(Number.isFinite)));
});
test('les baies religieuses tiennent au-dessus du sol et sous le comble', () => {
  const walls={positions:[],normals:[],colors:[]},openings={panes:0,budget:Infinity};
  appendChurchWindows(openings,walls,{x:0,y:0},{x:18,y:0},0,-1,0,8,{y:[0,1]},personalityLookFor('church').windows);
  assert.equal(openings.panes,3);
  const heights=walls.positions.filter((_,i)=>i%3===1);
  assert.ok(Math.min(...heights)>=3);
  assert.ok(Math.max(...heights)<8);
});

test('l’enseigne de grande surface reste lisible et contenue dans sa façade', () => {
  const walls={positions:[],normals:[],colors:[]},labels={positions:[],uvs:[]};
  let text;
  const atlas={place(name,options) {text=name;return {widthPx:options.maxWidthPx,heightPx:80,u0:0,u1:1,v0:0,v1:1};}};
  appendRetailSign(walls,labels,atlas,{x:0,y:0},{x:8,y:0},0,-1,0,'Super U',personalityLookFor('retail'));
  assert.equal(text,'Super U');
  assert.equal(walls.positions.length,18);
  assert.equal(labels.positions.length,18);
  const xs=walls.positions.filter((_,i)=>i%3===0);
  assert.ok(Math.min(...xs)>0 && Math.max(...xs)<8);
});
