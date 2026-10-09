/* Les cotes de l’eau sont communes au terrain, aux berges et au décor. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WaterRelief } from '../src/terrain/waterRelief.js';
import { TerrainBubble } from '../src/terrain/terrainBubble.js';

const frame={origin:{x:0,y:0},scale:1,toLocal:(x,z)=>({x,z})};
const widths={river:9,canal:6,stream:3};
const rect=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]];
const lake=(rings,id=1,kind='lake',bounds)=>({layer:'water',geometry:{type:'Polygon',coordinates:rings},properties:{class:kind,id},bounds});
const river=(line,properties={})=>({layer:'waterway',geometry:{type:'LineString',coordinates:line},properties:{class:'river',...properties}});
const source=features=>({forEachFeature(layer,tiles,fn){for(const f of features) if(f.layer===layer) fn(f.geometry,f.properties,f.bounds);}});
const relief=(features,elevationAt,options={})=>new WaterRelief({source:source(features),tiles:[],frame,waterways:widths,elevationAt,benchM:4,...options});
const height=(r,x,z,raw=100)=>r.sample(x,z,raw).elevation;
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≠ ${b}`);

test('un lac bosselé devient horizontal, sans niveler le terrain extérieur',()=>{
  const r=relief([lake([rect(-80,-80,80,80)])],(x,z)=>20+Math.abs(x)*0.1+8*Math.exp(-(x*x+z*z)/300));
  const level=height(r,0,0);
  for(const x of [-70,-35,0,35,70]) for(const z of [-60,0,60]) close(height(r,x,z),level);
  assert.ok(level>=20 && level<28);
  close(height(r,110,0,48),48);
  assert.ok(height(r,90,0,48)>level && height(r,90,0,48)<48);
});

test('les morceaux d’un lac partagent leur niveau, quel que soit leur ordre',()=>{
  const left=lake([rect(-100,-60,0,60)]),right=lake([rect(0,-60,100,60)]);
  const elevation=(x,z)=>30+x*0.04+z*0.01;
  const a=relief([left,right],elevation),b=relief([right,left],elevation);
  close(height(a,-50,0),height(a,50,0));
  close(height(a,-50,0),height(b,50,0));
  const whole=relief([lake([rect(-100,-60,100,60)])],elevation);
  close(height(a,10,0),height(whole,10,0));
});

test('une île conserve son relief au-delà du raccord de berge',()=>{
  const r=relief([lake([rect(-200,-200,200,200),rect(-60,-60,60,60)])],()=>10);
  close(height(r,0,0,45),45);
  close(height(r,100,0,45),10);
});

test('une rivière conserve sa pente en long et devient plate en travers',()=>{
  const features=[lake([rect(-200,-55,200,55)],1,'river'),river([[-300,0],[300,0]])];
  const r=relief(features,(x,z)=>50+x*0.03+Math.abs(z)*0.3);
  for(const x of [-100,0,100]) {
    close(height(r,x,-45),height(r,x,45));
    close(height(r,x,0),height(r,x,45));
  }
  close(height(r,100,0)-height(r,-100,0),6);
});

test('le profil d’une rivière est indépendant des découpes de tuile et du sens du trait',()=>{
  const ground=(x,z)=>50+x*0.03+Math.abs(z)*0.3;
  const polygon=lake([rect(-200,-55,200,55)],1,'river');
  const a=relief([polygon,river([[-300,0],[300,0]])],ground);
  const b=relief([polygon,river([[300,0],[0,0]]),river([[0,0],[-300,0]])],ground);
  for(let x=-100;x<=100;x+=5) close(height(a,x,25),height(b,x,25));
});

test('une bosse isolée du MNT ne soulève pas le profil de la rivière',()=>{
  const r=relief([river([[-300,0],[300,0]])],(x,z)=>10+20*Math.exp(-(x*x+z*z)/30));
  assert.ok(height(r,0,0)<10.01);
});

test('les sondes de rivière restent ancrées au monde lors d’un changement de repère',()=>{
  const ground=(x,z)=>50+Math.sin(x/23)+z*0.03;
  const a=relief([river([[-300,0],[300,0]])],ground);
  const shifted={origin:{x:17,y:29},scale:1,toLocal:(x,z)=>({x:x-17,z:z-29})};
  const b=relief([river([[-300,0],[300,0]])],(x,z)=>ground(x+17,z+29),{frame:shifted});
  for(let x=-100;x<=100;x+=5) close(height(a,x,0),height(b,x-17,-29));
});

test('un lac incomplet attend les morceaux voisins au lieu de choisir une cote locale',()=>{
  const box={west:-100,east:0,north:-100,south:100};
  const a=lake([rect(-50,-50,0,50)],1,'lake',box);
  close(height(relief([a],()=>10),-25,0,35),35);
  const b=lake([rect(0,-50,50,50)],1,'lake',{...box,west:0,east:100});
  const r=relief([a,b],()=>10);
  close(height(r,-25,0,35),10);close(height(r,25,0,35),10);
});

test('la mer a une cote nulle, les eaux intermittentes et souterraines restent exclues',()=>{
  close(height(relief([lake([rect(-80,-80,80,80)],1,'ocean')],()=>12),0,0),0);
  const pond=lake([rect(-80,-80,80,80)]);pond.properties.intermittent=1;
  close(height(relief([pond,river([[-100,0],[100,0]],{brunnel:'tunnel'})],()=>10),0,0),100);
});

test('une altitude absente ne produit ni cote zéro ni NaN dans le terrain',()=>{
  const r=relief([lake([rect(-80,-80,80,80)]),river([[-200,0],[200,0]])],()=>NaN);
  close(height(r,0,0,35),35);
});

test('la cote d’un lac prime sur l’axe du ruisseau qui le traverse',()=>{
  const r=relief([lake([rect(-100,-100,100,100)]),river([[-300,0],[300,0]])],(x)=>20+x*0.1);
  close(height(r,-80,0),height(r,80,0));
});

test('le terrain naturel et la lecture du décor reçoivent le même niveau',()=>{
  const r=relief([lake([rect(-80,-80,80,80)])],()=>10);
  const context={_waterRelief:r,_cliffCut:null,_roadCutAt:(x,z,h)=>h};
  context._naturalAt=TerrainBubble.prototype._naturalAt;
  close(context._naturalAt(0,0,40),10);
  close(TerrainBubble.prototype.cutElevation.call(context,0,0,40),10);
});

test('deux rivières proches et indépendantes ne mélangent pas leurs altitudes',()=>{
  const features=[river([[-600,0],[600,0]]),river([[-600,45],[600,45]])];
  const shifted={origin:{x:11,y:13},scale:1,toLocal:(x,z)=>({x:x-11,z:z-13})};
  const r=relief(features,(x,z)=>z+13<20 ? 10 : 50,{frame:shifted});
  close(height(r,-11,-13),10);close(height(r,-11,32),50);
});

test('un terrassement voisin ne recrée pas de bosse dans la nappe',()=>{
  const r=relief([lake([rect(-80,-80,80,80)])],()=>10);
  const context={_waterRelief:r,_cliffCut:null,_roadCutAt:()=>35};
  close(TerrainBubble.prototype.cutElevation.call(context,0,0,40),10);
  close(TerrainBubble.prototype.cutElevation.call(context,150,0,40),35);
});

test('une petite mare entre les sondes garde sa cote quand son contour est découpé',()=>{
  const ground=(x,z)=>10+x+z;
  const whole=relief([lake([rect(1,1,9,9)])],ground);
  const split=relief([lake([rect(5,1,9,9)]),lake([rect(1,1,5,9)])],ground);
  close(height(whole,4,4),height(split,4,4));
});

test('le profil d’une confluence ne dépend pas de l’ordre ni du sens de ses branches',()=>{
  const lines=[[[-400,0],[0,0]],[[0,0],[400,0]],[[0,0],[0,400]]];
  const ground=(x,z)=>20+x*0.03+z*0.08+Math.sin(x/40);
  const a=relief(lines.map(line=>river(line)),ground);
  const b=relief([...lines].reverse().map(line=>river([...line].reverse())),ground);
  for(const p of [[0,0],[-10,0],[10,0],[0,10],[0,50]]) close(height(a,...p),height(b,...p));
});
