/*
 * demo/main.js — la démo autonome de WorldPaint.
 * -----------------------------------------------------------------
 * Une application minimale, sans framework, qui monte `createWorld` dans une
 * scène three.js et pilote une caméra volante à la main. Rien ici n'est
 * repris par le moteur : c'est exactement ce qu'une application consommatrice
 * doit écrire elle-même (voir le README, section « Usage »).
 *
 * Trois choses demandées, trois sections plus bas :
 *   - navigation clavier en vol libre + téléportation au clic ;
 *   - case à cocher qui étiquette ce qu'on regarde (`inspect/objectLabels`) ;
 *   - champ de recherche qui géocode un lieu (Nominatim/OpenStreetMap) et
 *     y déplace la bulle.
 */

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { createWorld, collectSceneLabels } from '../src/index.js';

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

// --- DOM ---------------------------------------------------------------------

const canvas = document.getElementById('scene');
const labelsRoot = document.getElementById('labels');
const dot = document.getElementById('dot');
const statusEl = document.getElementById('status');
const coordsEl = document.getElementById('coords');
const searchInput = document.getElementById('search');
const goButton = document.getElementById('go');
const showLabelsCheckbox = document.getElementById('showLabels');

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
  }

  coordsEl.textContent = `x ${camera.position.x.toFixed(0)}  z ${camera.position.z.toFixed(0)}  alt ${camera.position.y.toFixed(0)} m`;

  renderer.render(scene, camera);
}

boot().catch((err) => {
  console.error(err);
  setBusy(false);
  setStatus(`Erreur au démarrage : ${err.message}`, true);
});
