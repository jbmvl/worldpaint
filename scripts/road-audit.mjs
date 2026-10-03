#!/usr/bin/env node
/*
 * Audit hors ligne des routes de lieux enregistrés, avec captures des points
 * à regarder. Le banc compare les triangles routiers et ceux du terrain.
 *   node scripts/road-audit.mjs <dossier> [nantes,angers] [réglages JSON]
 * PLAYWRIGHT_MODULE et CHROMIUM_PATH peuvent désigner un runtime déjà installé.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [outDir='/tmp/worldpaint-road-audit', names='nantes,angers', json='{}'] = process.argv.slice(2);
const options=JSON.parse(json), require=createRequire(import.meta.url);
let chromium;
if(process.env.PLAYWRIGHT_MODULE) ({chromium}=require(process.env.PLAYWRIGHT_MODULE));
else {
  try { ({chromium}=await import('playwright')); }
  catch {
    const globalRequire=createRequire(join(process.execPath,'..','..','lib','node_modules','/'));
    ({chromium}=globalRequire('playwright'));
  }
}
const port=4180+Math.floor(Math.random()*500);
const server=spawn(process.execPath,['demo/server.mjs'],{env:{...process.env,PORT:String(port)}});
await new Promise((resolve,reject)=>{
  server.stdout.once('data',resolve);
  server.once('error',reject);
  server.once('exit',code=>reject(new Error(`Le serveur du banc s’arrête (${code}).`)));
});
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,
    args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const name of names.split(',')) {
    const folder=join(outDir,name);mkdirSync(folder,{recursive:true});
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error' && !m.location().url.endsWith('favicon.ico')) errors.push(m.text());});
    await page.route('**/*',route=>new URL(route.request().url()).origin===`http://localhost:${port}`
      ? route.continue() : route.abort());
    await page.goto(`http://localhost:${port}/demo/lab/place.html?lieu=${encodeURIComponent(name)}`);
    await page.waitForFunction(()=>window.placeLabReady,null,{timeout:600000});
    const audit=await page.evaluate(o=>placeLab.auditRoads(o),options);
    const points=audit.breaches.filter((p,i,list)=>list.slice(0,i).every(q=>Math.hypot(p.x-q.x,p.z-q.z)>50)).slice(0,4);
    const views=[{x:0,z:0,pitchDeg:75,yawDeg:0,distance:900},
      ...points.map(p=>({x:p.x,z:p.z,pitchDeg:55,yawDeg:225,distance:110})),...(options.views ?? [])];
    for(const [i,view] of views.entries()) {
      await page.evaluate(o=>placeLab.set({...o,roadsOnly:true}),view);
      await page.screenshot({path:join(folder,`${String(i).padStart(2,'0')}.png`)});
    }
    writeFileSync(join(folder,'audit.json'),JSON.stringify({...audit,errors,views},null,2));
    console.log(JSON.stringify({lieu:name,triangles:audit.triangles,sondages:audit.samples,
      recouvrements:audit.breaches.length,maximum:audit.breaches[0]?.gap ?? 0,
      trianglesInvalides:audit.invalid.length,bouchesSansCouture:audit.missingMouths.length,erreurs:errors}));
    await page.close();
  }
} finally {await browser?.close();server.kill();}
