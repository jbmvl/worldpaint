/*
 * Atlas des régions : lit les dossiers et interroge le même regionAt que le
 * moteur. Le raster est un aperçu échantillonné, jamais une seconde règle de
 * géographie. Natural Earth fournit les côtes et les grandes villes comme repères.
 */
import { REGIONS } from '../../src/core/regions.js';
import { regionAt, MAX_REACH_KM } from '../../src/core/region.js';
import { showcaseEntries } from '../../src/inspect/showcase.js';

const $ = (id) => document.getElementById(id);
const libelles = Object.fromEntries(['matrix', 'stone', 'building', 'farming', 'trees'].map(champ =>
  [champ, Object.fromEntries(showcaseEntries(champ).map(e => [e.value, e.label]))]));
const couleurs = {
  hedgerow_meadow: '#8fae71', openfield_cropland: '#c9bc78', wet_grassland: '#75ada0',
  marsh: '#79a5af', moor_heath: '#a19aaf', broadleaf_woodland: '#609479',
  conifer_forest: '#497f78', boreal_taiga: '#4c747e', terraced_slope: '#c69d70',
  dry_scrub: '#b0af79', garrigue: '#c2b28f', dry_steppe: '#d4bc84',
  alpine_pasture: '#a3babc', bare_rock: '#a9a8a3', dune_coast: '#e0cd9e',
  desert_stone: '#c59582', desert_sand: '#d8b67d', savanna: '#b4af61',
  tropical_forest: '#3a8766', rice_terrace: '#7da65d',
};
const regions = [...REGIONS].sort((a,b) => a.name.localeCompare(b.name, 'fr'));
const matrices = [...new Set(REGIONS.map(r => r.matrix))].sort((a,b) => libelles.matrix[a].localeCompare(libelles.matrix[b], 'fr'));
const select = $('matrice');
for (const matrice of matrices) select.add(new Option(libelles.matrix[matrice], matrice));
$('totaux').textContent = `${REGIONS.length} régions · ${REGIONS.reduce((n,r) => n+r.anchors.length,0)} ancres`;
$('portee').textContent = MAX_REACH_KM;
for (const matrice of matrices) {
  const item = document.createElement('span');
  const point = document.createElement('i');
  point.style.background = couleurs[matrice];
  item.append(point, libelles.matrix[matrice]);
  $('legende').append(item);
}
const canvas = $('carte');
const ctx = canvas.getContext('2d');
let largeur, hauteur, echelle, centre = [0, 0], choisie = null, visibles = new Set(), fond = null, villes = [];
const projeter = ([lng,lat]) => [lng, Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))*180/Math.PI];
const inverse = ([x,y]) => [x, (2*Math.atan(Math.exp(y*Math.PI/180))-Math.PI/2)*180/Math.PI];
const ecran = (point) => {const [x,y] = projeter(point); return [(x-centre[0])*echelle+largeur/2, (centre[1]-y)*echelle+hauteur/2];};
const lieu = (x,y) => inverse([centre[0]+(x-largeur/2)/echelle, centre[1]-(y-hauteur/2)/echelle]);
const ancrages = REGIONS.flatMap(r => r.anchors.map(point => ({region:r, point})));
const points = ancrages.map(a => projeter(a.point));
const limites = [Math.min(...points.map(p=>p[0]))-3, Math.min(...points.map(p=>p[1]))-3,
  Math.max(...points.map(p=>p[0]))+3, Math.max(...points.map(p=>p[1]))+3];
function cadrer() {
  centre = [(limites[0]+limites[2])/2,(limites[1]+limites[3])/2];
  echelle = Math.min(largeur/(limites[2]-limites[0]), hauteur/(limites[3]-limites[1]));
  demanderDessin();
}
function tracerPays() {
  ctx.beginPath();
  for (const pays of fond?.features ?? []) {
    const polygones = pays.geometry.type === 'Polygon' ? [pays.geometry.coordinates] : pays.geometry.coordinates;
    for (const polygone of polygones) for (const anneau of polygone) {
      anneau.forEach((p,i) => {const [x,y] = ecran(p); if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);});
      ctx.closePath();
    }
  }
}
let demande = false;
function demanderDessin() {
  if (demande) return;
  demande = true;
  requestAnimationFrame(() => {demande=false; dessiner();});
}
function dessiner() {
  ctx.clearRect(0,0,largeur,hauteur);
  tracerPays(); ctx.fillStyle='#f4f2e6'; ctx.fill('evenodd');
  ctx.strokeStyle='#cdd8d1'; ctx.lineWidth=.6;
  for (let lng=-180;lng<180;lng+=5) {const [x]=ecran([lng,45]);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,hauteur);ctx.stroke();}
  for (let lat=0;lat<85;lat+=5) {const [,y]=ecran([0,lat]);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(largeur,y);ctx.stroke();}
  const pas=3, nx=Math.ceil(largeur/pas), ny=Math.ceil(hauteur/pas);
  const ids = new Int16Array(nx*ny).fill(-1);
  const index = new Map(REGIONS.map((r,i)=>[r.id,i]));
  for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) {
    const r=regionAt(...lieu((x+.5)*pas,(y+.5)*pas));
    if (!r) continue;
    ids[y*nx+x]=index.get(r.id);
    ctx.globalAlpha = visibles.has(r.id) ? (choisie && choisie.id!==r.id ? .27 : .77) : .09;
    ctx.fillStyle=couleurs[r.matrix]; ctx.fillRect(x*pas,y*pas,pas,pas);
  }
  ctx.globalAlpha=1;ctx.fillStyle='#50665066';
  for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) {
    const id=ids[y*nx+x]; if(id<0 || !visibles.has(REGIONS[id].id))continue;
    if(x+1<nx && ids[y*nx+x+1]!==id)ctx.fillRect((x+1)*pas,y*pas, .7,pas);
    if(y+1<ny && ids[(y+1)*nx+x]!==id)ctx.fillRect(x*pas,(y+1)*pas,pas,.7);
  }
  tracerPays();ctx.strokeStyle='#506c7390';ctx.lineWidth=1;ctx.stroke();
  if ($('villes').checked) {
    const occupes=[];
    ctx.font='600 11px system-ui';ctx.textAlign='left';
    for (const ville of villes) {
      const [x,y]=ecran(ville.position), w=ctx.measureText(ville.nom).width;
      if(x<8||x+w+12>largeur||y<18||y>hauteur-35)continue;
      const boite={gauche:x-4,droite:x+w+12,haut:y-12,bas:y+7};
      if(occupes.some(b=>boite.gauche<b.droite&&boite.droite>b.gauche&&boite.haut<b.bas&&boite.bas>b.haut))continue;
      occupes.push(boite);
      ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle='#263d35';ctx.fill();
      ctx.strokeStyle='#fffef5';ctx.lineWidth=1.3;ctx.stroke();
      ctx.lineWidth=3;ctx.strokeStyle='#faf9f0ee';ctx.strokeText(ville.nom,x+7,y+4);
      ctx.fillStyle='#263d35';ctx.fillText(ville.nom,x+7,y+4);
    }
  }
}
function filtrer() {
  const normaliser = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const recherche=normaliser($('recherche').value.trim());
  const resultat=regions.filter(r=>(!select.value||r.matrix===select.value) && normaliser(`${r.name} ${r.id}`).includes(recherche));
  visibles=new Set(resultat.map(r=>r.id));
  $('compte').textContent=`${resultat.length} / ${REGIONS.length} régions`;
  $('liste').replaceChildren();
  for (const r of resultat) {
    const bouton=document.createElement('button');bouton.className='region';bouton.dataset.id=r.id; bouton.setAttribute('aria-current', String(choisie?.id===r.id));
    const point=document.createElement('span');point.className='pastille';point.style.background=couleurs[r.matrix];
    const texte=document.createElement('span');texte.append(r.name);
    const sous=document.createElement('small');sous.textContent=libelles.matrix[r.matrix];texte.append(sous);
    bouton.append(point,texte);bouton.onclick=()=>choisir(r,true);$('liste').append(bouton);
  }
  if(!resultat.length)$('liste').textContent='Aucune région ne correspond à cette recherche.';
  demanderDessin();
}
function choisir(r,recentrer=false) {
  choisie=r;const fiche=$('fiche');fiche.replaceChildren();fiche.hidden=!r;
  for(const bouton of $('liste').children)bouton.setAttribute('aria-current',String(bouton.dataset.id===r?.id));
  if(!r){demanderDessin();return;}
  const fermer=document.createElement('button');fermer.className='fermer';fermer.textContent='×';fermer.setAttribute('aria-label','Fermer la fiche');fermer.onclick=()=>choisir(null);
  const petit=document.createElement('small');petit.textContent=r.id;
  const titre=document.createElement('h2');titre.textContent=r.name;
  const type=document.createElement('p');type.textContent=libelles.matrix[r.matrix];type.style.color=couleurs[r.matrix];
  const dossier=document.createElement('dl');
  for(const [champ,nom] of [['stone','Pierre'],['building','Bâti'],['farming','Cultures · par ordre de présence'],['trees','Essences'],['anchors','Ancres · longitude, latitude']]) {
    const dt=document.createElement('dt');dt.textContent=nom;const dd=document.createElement('dd');
    dd.textContent=champ==='anchors'?r.anchors.map(p=>p.map(v=>v.toFixed(2)).join(', ')).join(' / '):[r[champ]].flat().map(v=>libelles[champ][v]??v).join(' · ');
    dossier.append(dt,dd);
  }
  fiche.append(fermer,petit,titre,type,dossier);
  if(recentrer) {centre=projeter(r.anchors[0]);echelle=Math.max(echelle,Math.min(largeur,hauteur)/7);}
  demanderDessin();
}
function zoomer(facteur,x=largeur/2,y=hauteur/2) {
  const avant=projeter(lieu(x,y)); echelle=Math.max(7,Math.min(650,echelle*facteur));
  centre=[avant[0]-(x-largeur/2)/echelle,avant[1]+(y-hauteur/2)/echelle];demanderDessin();
}
let glisse=null;
canvas.onpointerdown=e=>{glisse={x:e.offsetX,y:e.offsetY,centre:[...centre],bouge:false};canvas.setPointerCapture(e.pointerId);$('survol').hidden=true;};
canvas.onpointermove=e=>{
  if(glisse) {const dx=e.offsetX-glisse.x,dy=e.offsetY-glisse.y;if(Math.hypot(dx,dy)>4)glisse.bouge=true;centre=[glisse.centre[0]-dx/echelle,glisse.centre[1]+dy/echelle];demanderDessin();return;}
  const p=lieu(e.offsetX,e.offsetY),r=regionAt(...p);
  $('position').textContent=`${p[1].toFixed(3)}° N · ${p[0].toFixed(3)}° E`;
  const info=$('survol');info.hidden=false;info.textContent=r?r.name:'Hors couverture';info.style.left=`${Math.min(e.offsetX+14,largeur-info.offsetWidth-10)}px`;info.style.top=`${Math.max(8,e.offsetY-35)}px`;
};
canvas.onpointerup=e=>{if(glisse&&!glisse.bouge)choisir(regionAt(...lieu(e.offsetX,e.offsetY)));glisse=null;};
canvas.onpointercancel=()=>{glisse=null;};canvas.onpointerleave=()=>{$('survol').hidden=true;};
canvas.addEventListener('wheel',e=>{e.preventDefault();zoomer(Math.exp(-e.deltaY*.0015),e.offsetX,e.offsetY);},{passive:false});
$('plus').onclick=()=>zoomer(1.4);$('moins').onclick=()=>zoomer(1/1.4);$('cadrer').onclick=cadrer;
$('villes').onchange=demanderDessin;$('recherche').oninput=filtrer;select.onchange=filtrer;
$('effacer').onclick=()=>{$('recherche').value='';select.value='';filtrer();};
document.addEventListener('keydown',e=>{if(e.key==='Escape')choisir(null);});
new ResizeObserver(()=>{
  const premiere=!echelle;largeur=canvas.clientWidth;hauteur=canvas.clientHeight;
  canvas.width=largeur*devicePixelRatio;canvas.height=hauteur*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  if(premiere)cadrer();else demanderDessin();
}).observe(canvas);
filtrer();
await Promise.all([
  ['countries.json', valeur=>{fond=valeur;}],
  ['cities.json', valeur=>{villes=valeur;}],
].map(async ([fichier, appliquer])=>{
  try {
    const reponse=await fetch(`./data/${fichier}`);
    if(!reponse.ok)throw Error(reponse.status);
    appliquer(await reponse.json());demanderDessin();
  } catch { $('position').textContent='Repères indisponibles · les régions restent consultables'; }
}));
window.regionsLab = { regionAt, choisir: id=>choisir(REGIONS.find(r=>r.id===id)??null,true), cadrer, get selection(){return choisie?.id??null;} };
