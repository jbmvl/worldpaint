/*
 * demo/main.js — la démo autonome de WorldPaint.
 * -----------------------------------------------------------------
 * Une application minimale, sans framework, qui monte `createWorld` dans une
 * scène three.js et pilote une caméra volante à la main. Rien ici n'est
 * repris par le moteur : c'est exactement ce qu'une application consommatrice
 * doit écrire elle-même (voir le README, section « Usage »).
 *
 * Ce qui est demandé, une section par item plus bas :
 *   - navigation clavier en vol libre + téléportation au clic ;
 *   - case à cocher qui étiquette ce qu'on regarde (`inspect/objectLabels`) ;
 *   - case à cocher qui peint l'emprise routière, pour vérifier d'un coup d'œil
 *     que la frontière du décor tombe bien sur chaussée + accotement ;
 *   - champ de recherche qui géocode un lieu (Nominatim/OpenStreetMap) et
 *     y déplace la bulle ;
 *   - mini-carte façon Street View, centrée sur la caméra, qui affiche le
 *     réseau routier local et téléporte au clic.
 */

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { createWorld, collectSceneLabels, CORRIDOR_MARGIN_M } from '../src/index.js';

// --- Réglages ---------------------------------------------------------------

const START = { lng: 2.3522, lat: 48.8566, label: 'Paris' }; // point de départ
const EYE_HEIGHT_M = 1.75;
const MOVE_SPEED = 22; // m/s
const BOOST_FACTOR = 4.5;
const LOOK_SENSITIVITY = 0.0032;
const CLICK_MAX_MS = 350;
const CLICK_MAX_DRAG_PX = 6;
const RECENTER_MARGIN = 0.35; // fraction du rayon de la bulle
const LABEL_INTERVAL_MS = 160;
const RECENTER_INTERVAL_MS = 400;
const MINIMAP_RANGE_M = 220; // rayon affiché autour de la caméra
const MINIMAP_FOV_RAD = Math.PI / 2.2; // largeur du cône de vision, purement indicatif

// --- DOM ---------------------------------------------------------------------

const canvas = document.getElementById('scene');
const labelsRoot = document.getElementById('labels');
const dot = document.getElementById('dot');
const statusEl = document.getElementById('status');
const coordsEl = document.getElementById('coords');
const searchInput = document.getElementById('search');
const goButton = document.getElementById('go');
const showLabelsCheckbox = document.getElementById('showLabels');
const showCorridorCheckbox = document.getElementById('showCorridor');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

function setBusy(busy) {
  dot.classList.toggle('busy', busy);
}
function setStatus(text, isError = false) {
  statusEl.textContent = text || '';
  statusEl.classList.toggle('error', isError);
}

// --- Scène three.js ----------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 9000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Tuiles vectorielles OpenStreetMap ----------------------------------------
// WorldPaint ne fournit pas de serveur de tuiles : c'est à l'application de
// pointer vers une source au schéma OpenMapTiles. OpenFreeMap en publie une,
// gratuite et sans clé ; on lit son TileJSON plutôt que de coder en dur un
// gabarit d'URL, pour ne pas dépendre d'un chemin qui peut changer.
async function resolveVectorSource() {
  try {
    const res = await fetch('https://tiles.openfreemap.org/planet');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.tiles) || !json.tiles.length) throw new Error('tilejson sans tuiles');
    return { tiles: json.tiles, maxZoom: json.maxzoom ?? 14 };
  } catch (err) {
    console.warn('[worldpaint demo] tuiles vectorielles indisponibles — relief nu.', err);
    return null;
  }
}

// --- Montage du monde ---------------------------------------------------------

let world = null;

async function boot() {
  setBusy(true);
  setStatus('Chargement des tuiles…');

  const vector = await resolveVectorSource();

  world = createWorld({
    THREE,
    scene,
    vector,
    sky: { Sky },
  });

  setStatus(`Centrage sur ${START.label}…`);
  await world.setCenter(START.lng, START.lat);
  await world.refresh(START.lng, START.lat, { force: true });

  const local = world.frame.toLocal(START.lng, START.lat);
  const ground = sampleGroundHeight(local.x, local.z) ?? 0;
  camera.position.set(local.x, ground + EYE_HEIGHT_M, local.z);

  setBusy(false);
  setStatus(vector ? '' : "Tuiles vectorielles indisponibles : relief nu, sans routes ni bâti.", !vector);

  requestAnimationFrame(loop);
}

// --- Altitude du sol par lancer de rayon --------------------------------------
// Le moteur n'expose pas de « hauteur au point (x, z) » directement : la bulle
// de terrain est un maillage three.js comme un autre, donc on l'interroge par
// raycast, comme le ferait n'importe quelle application consommatrice.

const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

function sampleGroundHeight(x, z) {
  if (!world) return null;
  raycaster.set(new THREE.Vector3(x, 4000, z), DOWN);
  raycaster.far = 8000;
  const hits = raycaster.intersectObject(world.bubble.group, true);
  return hits.length ? hits[0].point.y : null;
}

// --- Navigation clavier : vol libre -------------------------------------------

const keys = { forward: false, back: false, left: false, right: false, up: false, down: false, boost: false };

const KEY_CODES = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'up',
  ShiftLeft: 'down',
  ShiftRight: 'down',
  AltLeft: 'boost',
  AltRight: 'boost',
};

function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

window.addEventListener('keydown', (e) => {
  if (isTypingTarget(document.activeElement)) return;
  const flag = KEY_CODES[e.code];
  if (!flag) return;
  e.preventDefault();
  keys[flag] = true;
});

window.addEventListener('keyup', (e) => {
  const flag = KEY_CODES[e.code];
  if (!flag) return;
  keys[flag] = false;
});

// Un blur (alt-tab, clic hors fenêtre) laisse parfois une touche « collée » :
// sans ça la caméra continuerait d'avancer toute seule.
window.addEventListener('blur', () => {
  for (const k of Object.keys(keys)) keys[k] = false;
});

// --- Regarder autour (glisser-clic) + téléportation (clic simple) ------------

let yaw = Math.PI; // regarde vers -z (le nord) au départ : voir bearingToYaw
let pitch = -0.12;
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

function applyLook() {
  euler.set(pitch, yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(euler);
}
applyLook();

let pointerDown = false;
let dragged = false;
let downX = 0;
let downY = 0;
let downAt = 0;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pointerDown = true;
  dragged = false;
  downX = e.clientX;
  downY = e.clientY;
  downAt = performance.now();
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointerDown) return;
  const dx = e.clientX - downX;
  const dy = e.clientY - downY;
  if (!dragged && Math.hypot(dx, dy) > CLICK_MAX_DRAG_PX) dragged = true;
  if (dragged) {
    // Glisser-clic « attrape » la scène plutôt qu'il ne pilote un manche à
    // balai : le point du monde sous le curseur doit suivre le curseur,
    // comme sur une carte qu'on fait glisser. La caméra tourne donc dans le
    // sens opposé au geste, pas dans le même sens qu'un mouse-look FPS.
    yaw += e.movementX * LOOK_SENSITIVITY;
    pitch += e.movementY * LOOK_SENSITIVITY;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
    applyLook();
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  pointerDown = false;
  const wasClick = !dragged && performance.now() - downAt < CLICK_MAX_MS;
  canvas.releasePointerCapture(e.pointerId);
  if (wasClick) teleportToScreenPoint(e.clientX, e.clientY);
});

function teleportToScreenPoint(clientX, clientY) {
  if (!world) return;
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = 9000;
  const hits = raycaster.intersectObject(world.bubble.group, true);
  if (!hits.length) return;
  const p = hits[0].point;
  camera.position.set(p.x, p.y + EYE_HEIGHT_M, p.z);
}

// Téléportation vers un point (x, z) du repère local dont on ne connaît pas
// l'altitude — cas de la mini-carte, qui raisonne en coordonnées planes.
// Même sondage que `sampleGroundHeight` : pas de hauteur trouvée (hors bulle
// chargée) veut dire qu'on ignore le clic plutôt que de plonger sous le sol.
function teleportTo(x, z) {
  const ground = sampleGroundHeight(x, z);
  if (ground === null) return;
  camera.position.set(x, ground + EYE_HEIGHT_M, z);
}

// --- Boucle de rendu -----------------------------------------------------------

const clock = new THREE.Clock();
const forward3 = new THREE.Vector3();
const move = new THREE.Vector3();
let recenterAcc = 0;
let recentering = false;
let labelAcc = LABEL_INTERVAL_MS; // premier tick immédiat

function updateMovement(delta) {
  const speed = MOVE_SPEED * (keys.boost ? BOOST_FACTOR : 1);
  camera.getWorldDirection(forward3);
  // Avancer/reculer glisse sur le sol, comme à pied : la composante
  // verticale du regard ne doit pas s'ajouter au déplacement, sinon lever
  // les yeux fait grimper et les baisser fait plonger dans le terrain.
  forward3.y = 0;
  if (forward3.lengthSq() > 1e-8) forward3.normalize();
  const right = new THREE.Vector3().crossVectors(forward3, camera.up).normalize();

  move.set(0, 0, 0);
  if (keys.forward) move.add(forward3);
  if (keys.back) move.sub(forward3);
  if (keys.right) move.add(right);
  if (keys.left) move.sub(right);
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * delta);
    camera.position.add(move);
  }
  if (keys.up) camera.position.y += speed * delta;
  if (keys.down) camera.position.y -= speed * delta;
}

async function recenterIfNeeded() {
  if (recentering || !world || !world.frame) return;
  const distance = Math.hypot(camera.position.x, camera.position.z);
  if (distance < world.bubble.radiusMeters * RECENTER_MARGIN) return;

  recentering = true;
  setBusy(true);
  try {
    const prevFrame = world.frame;
    const { lng, lat } = prevFrame.toLngLat(camera.position.x, camera.position.z);
    await world.setCenter(lng, lat);
    await world.refresh(lng, lat);
    if (world.frame !== prevFrame) {
      // Ré-ancrage rare (>20 km) : le repère local a changé d'origine, la
      // position de la caméra doit être réexprimée dans le nouveau repère.
      const local = world.frame.toLocal(lng, lat);
      camera.position.x = local.x;
      camera.position.z = local.z;
    }
  } catch (err) {
    console.warn('[worldpaint demo] recentrage interrompu', err);
  } finally {
    recentering = false;
    setBusy(false);
  }
}

// --- Étiquettes des objets -----------------------------------------------------

const LABEL_SKIP = new Set(['terrain-bubble', 'sky-dome', 'sun', 'ground-cover']);
const labelElements = new Map(); // id -> <span>
const projected = new THREE.Vector3();

function updateLabels() {
  if (!showLabelsCheckbox.checked || !world) {
    if (labelElements.size) clearLabels();
    return;
  }

  const items = collectSceneLabels({ root: scene, eye: camera.position, skip: LABEL_SKIP });
  const seen = new Set();

  for (const item of items) {
    projected.set(item.x, item.y, item.z).project(camera);
    if (projected.z > 1 || projected.z < -1) continue; // derrière la caméra

    const sx = (projected.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-projected.y * 0.5 + 0.5) * window.innerHeight;
    if (sx < -80 || sx > window.innerWidth + 80 || sy < -40 || sy > window.innerHeight + 40) continue;

    seen.add(item.id);
    let el = labelElements.get(item.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'label';
      labelsRoot.appendChild(el);
      labelElements.set(item.id, el);
    }
    el.textContent = item.text;
    el.style.left = `${sx}px`;
    el.style.top = `${sy}px`;
  }

  for (const [id, el] of labelElements) {
    if (!seen.has(id)) {
      el.remove();
      labelElements.delete(id);
    }
  }
}

function clearLabels() {
  for (const el of labelElements.values()) el.remove();
  labelElements.clear();
}

showLabelsCheckbox.addEventListener('change', () => {
  labelAcc = LABEL_INTERVAL_MS; // rafraîchit tout de suite
  if (!showLabelsCheckbox.checked) clearLabels();
});

// --- Emprise routière (mise au point) ------------------------------------------
// Une nappe translucide posée sur chaussée + accotement, reconstruite à partir
// des tronçons que `RoadNetwork` publie déjà. C'est exactement la frontière que
// `roadCorridor` fait respecter aux haies, clôtures, jardins, champs et herbe :
// si un élément de décor apparaît **sur** la nappe, c'est un défaut d'emprise ;
// s'il apparaît juste au bord, c'est sa place.
//
// Rien de tout ceci n'appartient au moteur : c'est de la mise au point, et la
// démo est l'endroit où elle vit.

const CORRIDOR_LIFT_M = 0.05; // au-dessus de la chaussée, pour ne pas se battre avec elle
let corridorMesh = null;
let corridorSignature = '';

const corridorMaterial = new THREE.MeshBasicMaterial({
  color: 0xff3b6b,
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
  side: THREE.DoubleSide,
});

function buildCorridorGeometry(segments) {
  const positions = [];

  for (const segment of segments) {
    const { path, platform, halfWidth } = segment;
    if (!path || path.length < 2) continue;
    const reach = halfWidth + CORRIDOR_MARGIN_M;

    // Bords gauche et droit, ligne par ligne. La perpendiculaire est prise sur
    // la tangente centrée, comme dans `ribbonGeometry.pathFrames`.
    const edge = [];
    for (let r = 0; r < path.length; r++) {
      const prev = path[Math.max(0, r - 1)];
      const next = path[Math.min(path.length - 1, r + 1)];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const length = Math.hypot(tx, tz) || 1;
      tx /= length;
      tz /= length;
      const y = (platform ? platform[r] : 0) + CORRIDOR_LIFT_M;
      edge.push({
        lx: path[r].x + tz * reach,
        lz: path[r].z - tx * reach,
        rx: path[r].x - tz * reach,
        rz: path[r].z + tx * reach,
        y,
      });
    }

    for (let r = 0; r < edge.length - 1; r++) {
      const a = edge[r];
      const b = edge[r + 1];
      positions.push(
        a.lx, a.y, a.lz, a.rx, a.y, a.rz, b.lx, b.y, b.lz,
        b.lx, b.y, b.lz, a.rx, a.y, a.rz, b.rx, b.y, b.rz
      );
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function clearCorridor() {
  if (!corridorMesh) return;
  scene.remove(corridorMesh);
  corridorMesh.geometry.dispose();
  corridorMesh = null;
  corridorSignature = '';
}

function updateCorridor() {
  if (!showCorridorCheckbox.checked || !world) {
    clearCorridor();
    return;
  }

  const segments = world.composer.roads?.roadSegments || [];
  // Les tronçons ne changent que toutes les reconstructions du réseau : refaire
  // la nappe à chaque image serait absurde. Une signature bon marché suffit.
  const signature = `${segments.length}:${segments[0]?.path?.[0]?.x ?? 0}`;
  if (corridorMesh && signature === corridorSignature) return;

  clearCorridor();
  const geometry = buildCorridorGeometry(segments);
  if (!geometry) return;

  corridorMesh = new THREE.Mesh(geometry, corridorMaterial);
  corridorMesh.name = 'debug-corridor';
  corridorMesh.matrixAutoUpdate = false;
  corridorMesh.frustumCulled = false;
  corridorMesh.renderOrder = 20;
  corridorMesh.updateMatrix();
  scene.add(corridorMesh);
  corridorSignature = signature;
}

showCorridorCheckbox.addEventListener('change', () => {
  if (!showCorridorCheckbox.checked) clearCorridor();
  else updateCorridor();
});

// --- Mini-carte façon Street View -----------------------------------------------
// Toujours centrée sur la caméra, nord en haut : le repère local a x = est,
// z = sud (`tileMath.makeLocalFrame`), donc un déplacement (x, z) se reporte
// tel quel en (dx, dy) sur le canevas, sans rotation à calculer. Le réseau
// routier vient de `world.composer.roads.roadSegments`, la même donnée que la
// nappe d'emprise ci-dessus — pas de deuxième source à charger. Le clic
// téléporte via `teleportTo`, identique au clic sur la scène 3D.

const MINIMAP_PX = minimapCanvas.width; // résolution interne du canevas (net sur écran retina)
const MINIMAP_SCALE = (MINIMAP_PX / 2) / MINIMAP_RANGE_M; // pixels par mètre
const minimapForward = new THREE.Vector3();

function worldToMinimap(x, z) {
  return {
    px: MINIMAP_PX / 2 + (x - camera.position.x) * MINIMAP_SCALE,
    py: MINIMAP_PX / 2 + (z - camera.position.z) * MINIMAP_SCALE,
  };
}

function updateMinimap() {
  const ctx = minimapCtx;
  ctx.clearRect(0, 0, MINIMAP_PX, MINIMAP_PX);
  if (!world) return;

  ctx.fillStyle = 'rgba(20, 24, 32, 0.92)';
  ctx.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);

  const segments = world.composer.roads?.roadSegments || [];
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const segment of segments) {
    const { path } = segment;
    if (!path || path.length < 2) continue;
    ctx.beginPath();
    for (let r = 0; r < path.length; r++) {
      const { px, py } = worldToMinimap(path[r].x, path[r].z);
      if (r === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Cône de vision : direction du regard aplatie au sol, sans conversion
  // d'angle — même astuce que ci-dessus, (dir.x, dir.z) est déjà l'angle
  // canevas puisque les deux repères partagent la même orientation.
  camera.getWorldDirection(minimapForward);
  minimapForward.y = 0;
  if (minimapForward.lengthSq() < 1e-8) minimapForward.set(0, 0, -1);
  else minimapForward.normalize();
  const center = MINIMAP_PX / 2;
  const heading = Math.atan2(minimapForward.z, minimapForward.x);
  ctx.beginPath();
  ctx.moveTo(center, center);
  ctx.arc(center, center, MINIMAP_PX * 0.34, heading - MINIMAP_FOV_RAD / 2, heading + MINIMAP_FOV_RAD / 2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(111, 168, 240, 0.32)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center, center, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#6fa8f0';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

minimapCanvas.addEventListener('click', (e) => {
  if (!world) return;
  const rect = minimapCanvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (MINIMAP_PX / rect.width);
  const py = (e.clientY - rect.top) * (MINIMAP_PX / rect.height);
  const x = camera.position.x + (px - MINIMAP_PX / 2) / MINIMAP_SCALE;
  const z = camera.position.z + (py - MINIMAP_PX / 2) / MINIMAP_SCALE;
  teleportTo(x, z);
});

// --- Recherche d'un lieu (géocodage OpenStreetMap / Nominatim) ---------------
// Nominatim est un service public à usage raisonnable : une requête par
// validation, pas d'appel en continu. Une application qui déploie cette démo
// à grande échelle devrait pointer vers sa propre instance ou un service
// commercial — voir https://operations.osmfoundation.org/policies/nominatim/.

async function geocode(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('accept-language', 'fr');
  url.searchParams.set('q', query);

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const results = await res.json();
  if (!results.length) throw new Error('Aucun lieu trouvé');
  const hit = results[0];
  return { lng: parseFloat(hit.lon), lat: parseFloat(hit.lat), label: hit.display_name };
}

async function goToSearch() {
  const query = searchInput.value.trim();
  if (!query || !world) return;

  goButton.disabled = true;
  setBusy(true);
  setStatus('Recherche…');
  try {
    const place = await geocode(query);
    setStatus(`Déplacement vers ${place.label.split(',')[0]}…`);

    await world.setCenter(place.lng, place.lat);
    await world.refresh(place.lng, place.lat, { force: true });

    const local = world.frame.toLocal(place.lng, place.lat);
    const ground = sampleGroundHeight(local.x, local.z) ?? 0;
    camera.position.set(local.x, ground + EYE_HEIGHT_M, local.z);

    setStatus(`📍 ${place.label.split(',')[0]}`);
  } catch (err) {
    setStatus(err.message || 'Lieu introuvable', true);
  } finally {
    goButton.disabled = false;
    setBusy(false);
  }
}

goButton.addEventListener('click', goToSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') goToSearch();
});

// --- Boucle principale ----------------------------------------------------------

function loop() {
  requestAnimationFrame(loop);
  const delta = Math.min(clock.getDelta(), 0.1); // évite un bond si l'onglet était en arrière-plan

  updateMovement(delta);

  if (world) {
    world.advance(delta, camera.position);
    const paint = world.updateSky({ camera, date: new Date(), lng: START.lng, lat: START.lat });
    if (paint) renderer.setClearColor(paint.clearColor, 1);
  }

  recenterAcc += delta * 1000;
  if (recenterAcc > RECENTER_INTERVAL_MS) {
    recenterAcc = 0;
    recenterIfNeeded();
  }

  labelAcc += delta * 1000;
  if (labelAcc > LABEL_INTERVAL_MS) {
    labelAcc = 0;
    updateLabels();
    updateCorridor();
    updateMinimap();
  }

  coordsEl.textContent = `x ${camera.position.x.toFixed(0)}  z ${camera.position.z.toFixed(0)}  alt ${camera.position.y.toFixed(0)} m`;

  renderer.render(scene, camera);
}

boot().catch((err) => {
  console.error(err);
  setBusy(false);
  setStatus(`Erreur au démarrage : ${err.message}`, true);
});
