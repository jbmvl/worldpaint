#!/usr/bin/env node
/* Rejoue un lieu hors réseau dans Chromium, conserve les mesures brutes et
 * les vues du banc. Le rendu logiciel sert aux compteurs, pas à prédire des FPS. */
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import os from 'node:os';
const [out='reports/lyon',place='lyon',scenario='courant']=process.argv.slice(2);
mkdirSync(out,{recursive:true});
const playwright=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(playwright);
const port=Number(process.env.PORT)||4291;
const server=spawn(process.execPath,['demo/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});
await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);server.once('exit',code=>j(Error(`Serveur arrêté : ${code}`)));});
let browser;
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:process.env.SOFTWARE_RENDER==='0'?[]:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:960,height:600}});
  const errors=[],missing=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('Erreur du banc',e.message);});
  page.on('console',m=>{if(m.text().startsWith('[banc]'))console.log(m.text());if(m.type()==='warning'||m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))missing.push({url:r.url(),status:r.status()});});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='localhost'?route.continue():route.abort());
  await page.goto(`http://localhost:${port}/demo/lab/performance.html?lieu=${encodeURIComponent(place)}${scenario==='etendu'?'&budget=0':''}`);
  await page.waitForFunction(()=>window.performanceLabReady,null,{timeout:600000});
  const result=await page.evaluate(async scenario=>{
    const {world,report,cold,place,renderer}=window.performanceLab;
    const warm=[];console.log('[banc] démarrage terminé',cold.elapsedMs);
    for(let i=0;i<(scenario==='etendu'?3:5);i++)warm.push(await report.capture(`reconstruction ${i+1}`,async()=>{const ok=await world.refresh(place.lng,place.lat,{force:true});if(!ok)throw Error('Reconstruction incomplète');return report.settle({x:0,z:0});}));
    console.log('[banc] reconstructions terminées');
    const gl=renderer.getContext();const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {place,userAgent:navigator.userAgent,webgl:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,cold,warm};
  },scenario);
  result.scenario=scenario;result.date=new Date().toISOString();result.views=[];result.moves=[];
  const positions=[{label:'Presqu’île',x:0,z:0},{label:'Fourvière',x:-850,z:150},{label:'Croix-Rousse',x:0,z:-1150},{label:'Rhône',x:700,z:0}];
  for(const [i,p]of positions.entries()){
    console.log('[banc]',p.label);
    const mesure=await page.evaluate(async p=>{
      const {world,report}=window.performanceLab;
      const ll=world.frame.toLngLat(p.x,p.z);
      const move=await report.capture(p.label,async()=>{await world.setCenter(ll.lng,ll.lat);const ok=await world.refresh(ll.lng,ll.lat,{force:true});if(!ok)throw Error('Reconstruction incomplète');return report.settle(p);});
      return {move,view:{position:{...p,...ll},render:report.view({...p,distance:1000}),inventory:report.inventory()}};
    },p);
    result.moves.push(mesure.move);result.views.push(mesure.view);
    writeFileSync(resolve(out,'mesures.json'),JSON.stringify(result,null,2)+'\n');
    await page.screenshot({timeout:120000,path:resolve(out,`vue-${i}.png`)});
  }
  result.frame=await page.evaluate(async()=>{const {world,report}=window.performanceLab;return report.capture('120 images CPU, Rhône',()=>{for(let i=0;i<120;i++){world.advance(1/60,{x:700,y:world.composer.groundElevationAt(700,0)+2,z:0});report.view({x:700,z:0,distance:250,pitchDeg:15,draw:false});}});});
  await page.evaluate(()=>window.performanceLab.report.view({x:700,z:0,distance:250,pitchDeg:15}));
  await page.screenshot({timeout:120000,path:resolve(out,'rue.png')});
  result.machine={platform:os.platform(),arch:os.arch(),cpu:os.cpus()[0].model,cores:os.cpus().length,ramBytes:os.totalmem(),node:process.version};result.errors=errors;result.missing=missing;
  writeFileSync(resolve(out,'mesures.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({out,coldMs:result.cold.elapsedMs,warmMs:result.warm.map(v=>v.elapsedMs),errors,missing},null,2));
}finally{await browser?.close();server.kill();}
