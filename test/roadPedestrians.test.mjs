/* Les trottoirs relèvent du sol urbain, les allées indépendantes du réseau. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRoadLines } from '../src/layers/roadNetwork.js';
import { removeRoadsideFootways } from '../src/layers/roadPedestrians.js';
import { createLocalFrame } from '../src/core/tileMath.js';

const line=(profile,z,{footway=false,level=0,works=0,end=60}={})=>({
  profile,halfWidth:profile==='minor'?2.5:.7,level,works,footway,
  points:[{x:0,z},{x:end,z}],
});
const town={any:true,nearCity:()=>true,covers:()=>false};

test('le trottoir explicite ne dessine aucun chemin même hors masque urbain',()=>{
  const frame=createLocalFrame(0,0,14);
  const source={forEachFeature(layer,tiles,callback){
    for(const properties of [{class:'path',subclass:'sidewalk'},
      {class:'path',subclass:'footway',footway:'sidewalk'},
      {class:'path',subclass:'crossing'}, {class:'path',subclass:'path'}]) {
      callback({type:'LineString',coordinates:[[0,0],[.0001,0]]},properties);
    }
  }};
  assert.equal(collectRoadLines(source,[],frame).length,1);
});

test('une voie piétonne longeant une rue urbaine est portée par le sol même au bord du parc',()=>{
  const street=line('minor',0),footway=line('path',4,{footway:true});
  assert.deepEqual(removeRoadsideFootways([street,footway],town),[street]);
});

test('allée éloignée, traversée de parc et escalier restent dans le réseau',()=>{
  const street=line('minor',0),far=line('path',12,{footway:true});
  const crossing={...line('path',0,{footway:true}),points:[{x:30,z:-30},{x:30,z:30}]};
  const steps=line('steps',4),path=line('path',4),cycle=line('cycleway',4);
  const lines=[street,far,crossing,steps,path,cycle];
  assert.deepEqual(removeRoadsideFootways(lines,town),lines);
});

test('un cheminement indépendant en ouvrage ou à un autre niveau reste distinct',()=>{
  for(const options of [{works:1},{works:2},{level:1}]) {
    const lines=[line('minor',0),line('path',4,{footway:true,...options})];
    assert.deepEqual(removeRoadsideFootways(lines,town),lines);
  }
});

test('les sentiers hors agglomération et les chemins cyclables restent distincts',()=>{
  const lines=[line('minor',0),line('path',4,{footway:true})];
  assert.deepEqual(removeRoadsideFootways(lines,{any:true,nearCity:()=>false}),lines);
  const cycle=[line('minor',0),line('cycleway',4)];
  assert.deepEqual(removeRoadsideFootways(cycle,town),cycle);
  assert.deepEqual(removeRoadsideFootways(lines,null),lines);
});

test('la suppression des trottoirs ne dépend pas de l’ordre des lignes',()=>{
  const lines=[line('minor',0),line('path',4,{footway:true}),line('path',12,{footway:true})];
  assert.deepEqual(removeRoadsideFootways(lines,town),removeRoadsideFootways(lines.slice().reverse(),town).reverse());
});

test('une traversée cyclable désignée conserve sa chaussée malgré son tag piéton',()=>{
  const frame=createLocalFrame(0,0,14),urban={any:true,covers:()=>true,nearCity:()=>true};
  const source={forEachFeature(layer,tiles,callback){
    for(const subclass of ['crossing','sidewalk','footway','pedestrian'])
      callback({type:'LineString',coordinates:[[0,0],[.0001,0]]},{class:'path',subclass,bicycle:'designated'});
  }};
  const lines=collectRoadLines(source,[],frame,undefined,{urban});
  assert.equal(lines.length,4);
  assert.ok(lines.every(l=>l.profile==='cycleway'));
});
