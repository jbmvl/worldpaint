import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationGate } from '../src/core/generationGate.js';
import { GenerationBudget } from '../src/core/generationBudget.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('une pause conserve le travail jusqu’à la reprise, sans polling', async () => {
  const gate=new GenerationGate();gate.setPaused(true);
  const budget=new GenerationBudget({gate,milliseconds:Infinity});
  let work=0;
  const run=(async()=>{await budget.checkpoint();work++;await budget.checkpoint();work++;})();
  await turn();assert.equal(work,0);assert.equal(gate.waiters.size,1);
  gate.setPaused(false);await run;assert.equal(work,2);assert.equal(gate.waiters.size,0);
});
test('une pause demandée pendant une cession est respectée avant la suite', async () => {
  const gate=new GenerationGate();let work=false;
  const budget=new GenerationBudget({gate,milliseconds:1,now:()=>10,pause:async()=>gate.setPaused(true)});
  budget.start=0;
  const run=budget.checkpoint().then(()=>{work=true;});
  await turn();assert.equal(work,false);gate.setPaused(false);await run;assert.equal(work,true);
});
test('détruire une construction suspendue libère ses attentes', async () => {
  const gate=new GenerationGate();gate.setPaused(true);const pending=gate.wait();
  gate.dispose();assert.equal(await pending,false);assert.equal(gate.waiters.size,0);assert.equal(await gate.wait(),false);
});
