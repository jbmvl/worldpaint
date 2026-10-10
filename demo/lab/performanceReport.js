/* Instrumentation du banc : temps exclus des pauses, étapes du mobilier et
 * travail par image. Les buffers sont comptés une seule fois par identité ;
 * leurs octets ne sont ni une mesure de VRAM ni un temps GPU. */
export function installReport(world, renderer, scene, camera, place) {
  const c=world.composer;
  for(const [nom,couche] of Object.entries(c))if(couche?.group&&!couche.group.name)couche.group.name=nom;
  world.setProfiling(true);
  const details={};
  const record=(label,ms)=>{const v=details[label]??={calls:0,totalMs:0,maxMs:0};v.calls++;v.totalMs+=ms;v.maxMs=Math.max(v.maxMs,ms);};
  function watch(object,method,label) {
    if(typeof object?.[method]!=='function')return;
    const original=object[method];
    object[method]=function(...args){const t=performance.now();try{return original.apply(this,args);}finally{record(label,performance.now()-t);}};
  }
  const families=['rives et relief routier','passages','panneaux de carrefour','parcelles','faune domestique','faune de pâture','repères de village','points d’intérêt','rochers','débris du biome','repères','sommets','côtes','arbres de crête','publication'];
  function steps(object,method,labelFor) {
    const original=object[method];
    object[method]=function*(...args){const it=original.apply(this,args);let i=0;try{while(true){const t=performance.now();const r=it.next();record(labelFor(i++,r.done),performance.now()-t);if(r.done)return r.value;yield r.value;}}finally{it.return?.();}};
  }
  steps(c.roads,'rebuildSteps',i=>`routes : ${['collecte et absorption','graphe et chaînage','largeurs parallèles'][i]??'profils, ouvrages et maillages'}`);
  steps(c.furniture,'rebuildSteps',i=>`mobilier : ${i===0?'préparation + ':''}${families[i]??'fin'}`);
  steps(c.buildings,'_buildSteps',(i,done)=>`bâti : ${done?'publication':i===0?'collecte empreintes et POI':i===1?'association et dédoublonnage':'géométrie par bâtiment'}`);
  watch(c.buildings,'_appendBuilding','bâti : _appendBuilding (inclus dans géométrie)');
  watch(c.buildings,'_appendTerrace','bâti : terrasses (inclus dans bâtiment)');
  watch(c.buildings,'_applyLabels','bâti : enseignes (inclus dans publication)');
  watch(c.buildings,'_applyWindows','bâti : fenêtres nocturnes (inclus dans publication)');
  for(const [object,methods,label] of [
    [c.bubble,['_buildMesh'],'terrain'],[c.far,['_readHeights','_build'],'relief lointain'],
    [c.vegetation,['update','advance'],'arbres'],[c.grass,['update','advance'],'herbe'],
    [c.crops,['update','advance'],'cultures'],[c.life,['advance'],'oiseaux et ballon'],
    [c.tractors,['advance','setTractors'],'tracteurs'],[c.trains,['advance','setTracks'],'trains'],
    [c.fauna,['setAnimals'],'faune'],[c.spectators,['advance'],'spectateurs'],
    [c.furniture,['advanceSignals','advanceLamps','advanceRotor','advanceLighthouses'],'mobilier animé'],
    [world,['updateSky'],'ciel soleil brouillard'],[world,['advance'],'image complète'],
  ])for(const method of methods)watch(object,method,`${label} : ${method}`);
  async function settle(at) {
    await c.far?.sync();
    while(c.far?._pending)await new Promise(r=>setTimeout(r,0));
    let frames=0,worstMs=0;
    for(;frames<4000;frames++){
      const t=performance.now();world.advance(0,{...at,y:c.groundElevationAt(at.x,at.z)});worstMs=Math.max(worstMs,performance.now()-t);
      if(frames>2&&!c.vegetation.pending&&!c.grass.pending&&!c.bubble._rebuildQueue.length&&!c.bubble._pendingBuild)break;
      if(frames%20===0)await new Promise(r=>setTimeout(r,0));
    }
    if(frames===4000)throw Error('Files non vidées');
    return {frames,worstMs};
  }
  async function capture(label,action){world.resetGenerationStats();for(const k of Object.keys(details))delete details[k];const t=performance.now();const result=await action();return {label,elapsedMs:performance.now()-t,result,couches:world.generationStats,details:structuredClone(details)};}
  function view({x=0,z=0,distance=1200,pitchDeg=35,yawDeg=270,hour=13,draw=true}={}){
    const y=c.groundElevationAt(x,z),yaw=yawDeg*Math.PI/180,pitch=pitchDeg*Math.PI/180;
    camera.position.set(x-Math.sin(yaw)*Math.cos(pitch)*distance,y+Math.sin(pitch)*distance,z+Math.cos(yaw)*Math.cos(pitch)*distance);camera.lookAt(x,y,z);
    const paint=world.updateSky({camera,date:new Date(Date.UTC(2026,5,21,hour)),lng:place.lng,lat:place.lat,shadowAt:{x,y,z}});
    if(paint)renderer.setClearColor(paint.clearColor,1);if(draw)renderer.render(scene,camera);
    return {...renderer.info.render,memory:{...renderer.info.memory}};
  }
  function inventory(){
    const groups={};const buffers=new Set();let bytes=0;
    for(const child of c.root.children){const v={meshes:0,instances:0,triangles:0,bufferBytes:0};child.traverse(o=>{if(!o.isMesh)return;const g=o.geometry;const n=o.isInstancedMesh?o.count:1;v.meshes++;v.instances+=o.isInstancedMesh?o.count:0;v.triangles+=(g.index?.count??g.attributes.position?.count??0)/3*n;
      for(const a of [...Object.values(g.attributes),g.index,o.instanceMatrix,o.instanceColor].filter(Boolean)){const b=(a.isInterleavedBufferAttribute?a.data.array:a.array)?.buffer;if(!b||buffers.has(b))continue;buffers.add(b);v.bufferBytes+=b.byteLength;bytes+=b.byteLength;}
    });if(v.meshes)groups[child.name||`groupe-${child.id}`]=v;}
    return {groups,bufferBytes:bytes,counts:{buildings:c.buildings.count,panes:c.buildings.paneCount,windows:c.buildings.windowCount,personalities:c.buildings.personalities,shopfronts:c.buildings.shopfronts?.length,terraces:c.buildings.terraces?.length,furniture:c.furniture.counts,roads:c.roads.roadSegments?.length,junctions:c.roads.junctions?.length,water:c.bubble._waterRelief?.count},detail:{radius:c.bubble.decorReachMeters,step:c.bubble.decorStepMeters},sourceTiles:[...c.vectorTiles.tiles.entries()].filter(([,e])=>e).map(([key,e])=>({key,layers:Object.fromEntries(Object.entries(e.tile.layers).map(([nom,couche])=>[nom,couche.length]))})), terrainTiles:c.bubble.tiles.size,region:c.landscape?.region?.id};
  }
  return {capture,settle,view,inventory};
}
