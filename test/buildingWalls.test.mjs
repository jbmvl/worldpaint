/*
 * Une emprise de mur sans tags ne reçoit pas une façade d’habitation.
 * Dans un château mixte, l’épaisseur se lit là où tomberait chaque baie.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isWallFootprint,facadeThickness,isTransitStop,isTransitShelter} from '../src/layers/buildingInterpretation.js';
import {buildingPersonalityFor,appendOpenings,personalityLookFor} from '../src/layers/buildingLayer.js';
import {createLocalFrame} from '../src/core/tileMath.js';

const rectangle=(width,length)=>[{x:0,z:0},{x:length,z:0},{x:length,z:width},{x:0,z:width}];
test('les tags de murailles donnent un mur plein sans toit de maison',()=>{
  for(const properties of [{historic:'citywalls'},{barrier:'city_wall'},{barrier:'wall'},{class:'castle_wall'},{subclass:'rampart'}])assert.equal(buildingPersonalityFor(properties),'rampart');
  const look=personalityLookFor('rampart');assert.equal(look.shape,'flat');assert.equal(look.windows,false);assert.equal(look.spire,null);
});
test('une longue bande étroite est un mur, une maison compacte ne l’est pas',()=>{
  assert.equal(isWallFootprint(rectangle(2,40)),true);
  assert.equal(isWallFootprint(rectangle(8,40)),false);
  assert.equal(isWallFootprint(rectangle(2,8)),false);
  assert.equal(isWallFootprint([{x:0,z:0},{x:35,z:0},{x:35,z:10},{x:33,z:10},{x:33,z:2},{x:0,z:2}]),true);
  assert.equal(isWallFootprint([]),false);
});
test('la largeur d’un mur sinueux reste indépendante de sa boîte et du sens de parcours',()=>{
  const ring=[{x:0,z:0},{x:70,z:0},{x:70,z:40},{x:68,z:40},{x:68,z:2},{x:0,z:2}];
  assert.equal(isWallFootprint(ring),true);
  assert.equal(isWallFootprint(ring.slice().reverse()),true);
  const angle=0.4,c=Math.cos(angle),s=Math.sin(angle);
  assert.equal(isWallFootprint(ring.map(p=>({x:p.x*c-p.z*s+300,z:p.x*s+p.z*c-100}))),true);
});
test('les murailles réelles de Montreuil-Bellay restent des murs malgré leurs tags perdus',()=>{
  const data=JSON.parse(readFileSync(new URL('./fixtures/building-walls-montreuil.json',import.meta.url)));
  const frame=createLocalFrame(...data.centre,14);
  assert.equal(data.buildings.length,14);
  for(const b of data.buildings)assert.equal(isWallFootprint(b.geometry.coordinates[0].map(p=>frame.toLocal(...p))),true);
});
test('l’épaisseur locale sépare le mur et la salle dans une même empreinte',()=>{
  const ring=[{x:0,z:0},{x:60,z:0},{x:60,z:12},{x:40,z:12},{x:40,z:2},{x:0,z:2}];
  assert.equal(facadeThickness(ring,ring[0],ring[1],0.3),2);
  assert.equal(facadeThickness(ring,ring[0],ring[1],0.8),12);
  const reverse=ring.slice().reverse();
  assert.equal(facadeThickness(reverse,ring[1],ring[0],0.7),2);
});
test('une baie de château n’est pas posée dans un pan mince',()=>{
  const ring=rectangle(2,40),walls={positions:[],normals:[],colors:[]},openings={panes:0,budget:Infinity};
  appendOpenings(openings,walls,{x:0,y:0},{x:40,y:0},0,-1,0,8,0,{shutters:false},undefined,{allowAt:along=>facadeThickness(ring,ring[0],ring[1],along/40)>3.2});
  assert.equal(openings.panes,0);assert.equal(walls.positions.length,0);
});
test('une petite emprise au bord d’un arrêt est son abri, pas un bâtiment',()=>{
  assert.equal(isTransitStop({class:'bus',subclass:'bus_stop'}),true);
  assert.equal(isTransitStop({class:'railway',subclass:'tram_stop'}),true);
  assert.equal(isTransitStop({class:'railway',subclass:'station'}),false);
  const stops=[{x:0,z:0}];
  assert.equal(isTransitShelter({x:8,z:3,area:10},stops),true);
  assert.equal(isTransitShelter({x:8,z:3,area:60},stops),false);
  assert.equal(isTransitShelter({x:80,z:3,area:10},stops),false);
  assert.equal(isTransitShelter({x:8,z:3,area:10},[]),false);
});
