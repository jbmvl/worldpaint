/* Une entrée ne doit dépasser aucun point d'une autre bouche. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { enveloppesEntrees } from '../src/layers/roundaboutEntries.js';

test('une entrée qui dépasse le milieu d’une bouche conserve le contour sûr',()=>{
  const branches=[
    {halfWidth:2.35156069696,path:[[6.994590798,.275135543],[8.478104499,.609708212],
      [9.894944199,1.445710657],[11.413296518,1.409490187],[12.989954339,.510966008]]},
    {halfWidth:2.24448639760,path:[[6.276245635,3.099796885],[5.234646118,6.696900777],
      [9.990477893,.436292864],[11.494153541,-.366652950],[11.655884751,5.756765644]]},
  ].map(b=>({...b,path:b.path.map(([x,z])=>({x,z}))}));
  const bouches=branches.map(b=>{
    const centre=b.path.at(-1),avant=b.path.at(-2),longueur=Math.hypot(centre.x-avant.x,centre.z-avant.z);
    const nx=(centre.z-avant.z)/longueur,nz=-(centre.x-avant.x)/longueur;
    return {centre,origin:b.path[0],halfWidth:b.halfWidth,
      left:{x:centre.x+nx*b.halfWidth,z:centre.z+nz*b.halfWidth},
      right:{x:centre.x-nx*b.halfWidth,z:centre.z-nz*b.halfWidth}};
  });
  assert.equal(enveloppesEntrees({x:0,z:0},10,bouches,branches),null);
});
