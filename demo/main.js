/*
 * demo/main.js — la démo autonome de WorldPaint. Application minimale, sans
 * framework, qui monte `createWorld` dans une scène three.js et pilote une
 * caméra volante à la main — c'est ce qu'une application consommatrice doit
 * écrire elle-même (voir le README, section « Usage »).
 *
 * Au programme : navigation clavier + téléportation au clic, étiquetage de
 * ce qu'on regarde (`inspect/objectLabels`), affichage de l'emprise
 * routière, recherche géocodée (Nominatim), mini-carte façon Street View,
 * panneau météo et heure, et le déclenchement d'une traversée d'animal —
 * le seul geste du moteur qui soit un événement et non une fonction du lieu.
 *
 * Le panneau météo montre où passe la frontière moteur/application : c'est
 * la démo qui décide du temps qu'il fait (curseurs, pour comparer vite),
 * le moteur ne fait que l'appliquer et ne connaît aucun service.
 */

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import {
  createWorld,
  collectSceneLabels,
  collectCropLabels,
  collectPlaceLabels,
  collectBuildingLabels,
  CORRIDOR_MARGIN_M,
  DEFAULT_WEATHER,
  CLIMATE_FAMILIES,
  FAUNA_KINDS,
  LABEL_FAUNA,
} from '../src/index.js';

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
const realTimeCheckbox = document.getElementById('realTime');
const hourInput = document.getElementById('hour');
const hourVal = document.getElementById('hourVal');
const presetsRoot = document.getElementById('presets');
const menuToggle = document.getElementById('menuToggle');
const panel = document.getElementById('panel');
const weatherBtn = document.getElementById('weatherBtn');
const upBtn = document.getElementById('upBtn');
const downBtn = document.getElementById('downBtn');
const faunaKindSelect = document.getElementById('faunaKind');
const faunaDistanceInput = document.getElementById('faunaDistance');
const faunaDistanceVal = document.getElementById('faunaDistanceVal');
const faunaCrossBtn = document.getElementById('faunaCross');
const climateSelect = document.getElementById('climate');
const climateHint = document.getElementById('climateHint');
const streetViewBtn = document.getElementById('streetViewBtn');
const mapOverlay = document.getElementById('mapOverlay');
const mapOverlayClose = document.getElementById('mapOverlayClose');
const mapOverlayLegend = document.getElementById('mapOverlayLegend');
const bigMinimapCanvas = document.getElementById('minimapBig');
const bigMinimapCtx = bigMinimapCanvas.getContext('2d');

function setBusy(busy) {
  dot.classList.toggle('busy', busy);
}
function setStatus(text, isError = false) {
  statusEl.textContent = text || '';
  statusEl.classList.toggle('error', isError);
}

// --- Panneau de réglages replié (mobile) --------------------------------------
// Le panneau reste toujours dans le DOM ; seule sa visibilité change (voir la
// media query dans index.html). Le bouton n'existe que pour ça, il ne pilote
// rien d'autre.
menuToggle.addEventListener('click', () => panel.classList.toggle('open'));

// --- Scène three.js ----------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Le rig de lumière du moteur monte volontairement au-dessus de 1 (voir
// `environment/skyModel.js`) ; sans tone mapping ça écrête à blanc plat.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5; // valeur de l'exemple officiel three pour ce Sky.js


const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 9000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Tuiles vectorielles OpenStreetMap ----------------------------------------
// WorldPaint ne fournit pas de serveur de tuiles : source OpenFreeMap (gratuite,
// sans clé), lue via son TileJSON plutôt qu'un gabarit d'URL codé en dur.
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
  for (const button of [upBtn, downBtn]) button.classList.remove('held');
});

/*
 * Monter et descendre au doigt. Un mobile n'a ni Espace ni Maj, et sans ces
 * deux boutons on ne peut ni décoller ni redescendre au sol — c'est-à-dire
 * ni voir le paysage de haut, ni revenir le voir à hauteur d'homme.
 *
 * Ils écrivent dans le **même** `keys` que le clavier : une seule boucle de
 * déplacement à tenir, et maintenir le bouton en même temps que la touche ne
 * fait pas monter deux fois.
 *
 * `setPointerCapture` est ce qui rend le maintien fiable : sans lui, un doigt
 * qui glisse hors du bouton ne rend jamais son `pointerup`, et la caméra monte
 * indéfiniment.
 */
function bindHold(button, flag) {
  const release = (e) => {
    if (e && button.hasPointerCapture?.(e.pointerId)) button.releasePointerCapture(e.pointerId);
    keys[flag] = false;
    button.classList.remove('held');
  };
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    button.setPointerCapture?.(e.pointerId);
    keys[flag] = true;
    button.classList.add('held');
  });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  // Le clavier reste utilisable sur ces boutons, qui sont focusables.
  button.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') keys[flag] = true;
  });
  button.addEventListener('keyup', () => release(null));
  button.addEventListener('blur', () => release(null));
}

bindHold(upBtn, 'up');
bindHold(downBtn, 'down');

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
const cameraDirection = new THREE.Vector3(); // direction non aplatie, pour le cap et l'inclinaison du HUD
const rad2deg = (rad) => (rad * 180) / Math.PI;
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
//
// Trois sources superposées : les objets de la scène (`collectSceneLabels`),
// les cultures (`collectCropLabels`) et les emprises `landuse`/`landcover`
// (`collectPlaceLabels`) — voir l'en-tête de `inspect/objectLabels.js`.
// `terrain-bubble`, `sky-dome` et `sun` restent tus (ambiance, pas un objet du décor).
const LABEL_SKIP = new Set(['terrain-bubble', 'sky-dome', 'sun']);
const labelElements = new Map(); // id -> <span>
const projected = new THREE.Vector3();

function updateLabels() {
  if (!showLabelsCheckbox.checked || !world) {
    if (labelElements.size) clearLabels();
    return;
  }

  const items = collectSceneLabels({ root: scene, eye: camera.position, skip: LABEL_SKIP });

  // Les cultures, les emprises et les bâtiments spéciaux se lisent
  // directement dans la donnée déjà chargée pour le décor — aucune requête de
  // plus, seulement une lecture.
  const groundAt = (x, z) => world.bubble.surfaceElevationAtLocal(x, z, 0) * world.bubble.verticalScale;

  // Église, mosquée, hôpital, boulangerie, commerce : `buildingLayer` les
  // fond dans le même maillage `buildings` que tout le reste (il redécore
  // l'empreinte, il n'en pose pas à côté — voir son en-tête), donc rien dans
  // la scène ne porte leur nom. `personalities` est ce qui le sait encore.
  for (const item of collectBuildingLabels({
    buildings: world.composer?.buildings?.personalities,
    eye: camera.position,
    groundAt,
  })) {
    items.push(item);
  }

  if (world.groundClass?.ready) {
    for (const item of collectCropLabels({
      center: camera.position,
      cropAt: (x, z) => world.groundClass.cropAt(x, z),
      groundAt,
    })) {
      item.area = true;
      items.push(item);
    }

    const source = world.composer?.vectorTiles;
    if (source) {
      const tiles = [];
      for (const entry of source.tiles.values()) {
        if (entry) tiles.push({ x: entry.x, y: entry.y });
      }
      for (const item of collectPlaceLabels({
        source,
        tiles,
        frame: world.frame,
        eye: camera.position,
        groundAt,
      })) {
        item.area = true;
        items.push(item);
      }
    }
  }

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
      el.className = item.area ? 'label label-area' : 'label';
      labelsRoot.appendChild(el);
      labelElements.set(item.id, el);
    }
    // 🗺️ ce que la carte dit, 🤖 ce que la procédure a inventé — voir
    // `sourceForMeshName` et les commentaires de source dans `objectLabels.js`.
    el.textContent = item.source ? `${item.source} ${item.text}` : item.text;
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
// Une nappe translucide posée sur chaussée + accotement, la même frontière
// que `roadCorridor` fait respecter au reste du décor : un élément visible
// sur la nappe est un défaut d'emprise. Pure mise au point, hors du moteur.

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

/**
 * Dessine le radar (routes + cône de regard) sur un canevas donné, centré sur
 * un point (`centerX`, `centerZ`) quelconque — la mini-carte ronde le prend
 * toujours égal à `camera.position`, la carte plein écran peut le décaler
 * (voir `bigPanX`/`bigPanZ` ci-dessous). `dotRadius`/`coneRadius` sont donnés
 * en pixels canevas plutôt que déduits de `px` pour ne pas changer, même d'un
 * pixel, l'aspect de la mini-carte ronde existante.
 */
function drawMinimapPanel(ctx, px, scale, centerX, centerZ, opts = {}) {
  const {
    emojis = false,
    emojiSize = px * 0.032,
    dotRadius = 6,
    coneRadius = px * 0.34,
    roadWidth = 2,
  } = opts;

  ctx.clearRect(0, 0, px, px);
  if (!world) return;

  ctx.fillStyle = 'rgba(20, 24, 32, 0.92)';
  ctx.fillRect(0, 0, px, px);

  const toPx = (x, z) => ({
    px: px / 2 + (x - centerX) * scale,
    py: px / 2 + (z - centerZ) * scale,
  });

  const segments = world.composer.roads?.roadSegments || [];
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = roadWidth;
  ctx.lineJoin = 'round';
  for (const segment of segments) {
    const { path } = segment;
    if (!path || path.length < 2) continue;
    ctx.beginPath();
    for (let r = 0; r < path.length; r++) {
      const { px: sx, py: sy } = toPx(path[r].x, path[r].z);
      if (r === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  // Un émoji par repère, tiré de trois sources : les bâtiments à personnalité
  // (`BuildingLayer.personalities`, la même que les étiquettes), le mobilier
  // remarquable (`FurnitureLayer.instanced`) et les bêtes
  // (`FaunaLayer.meshes`) — dans les trois cas, les matrices déjà écrites
  // pour le rendu. De quoi reconnaître une boulangerie, un château d'eau ou
  // un pré occupé sans avoir à s'en approcher en 3D.
  if (emojis) {
    const range = px / 2 / scale; // demi-côté du canevas, en mètres
    const range2 = range * range;
    ctx.font = `${Math.round(emojiSize)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Un émoji par case : dans un bourg, une dizaine de commerces tombent sur
    // le même pâté de maisons et se recouvriraient en bouillie illisible. Ce
    // qui passe en premier gagne la case, d'où l'ordre ci-dessous — un
    // bâtiment repéré vaut mieux qu'un abribus.
    const taken = new Set();
    const cell = Math.max(emojiSize * 1.1, 1);
    const place = (x, z, emoji) => {
      const dx = x - centerX;
      const dz = z - centerZ;
      if (dx * dx + dz * dz > range2) return;
      const { px: sx, py: sy } = toPx(x, z);
      const key = `${Math.round(sx / cell)},${Math.round(sy / cell)}`;
      if (taken.has(key)) return;
      taken.add(key);
      ctx.fillText(emoji, sx, sy);
    };

    for (const building of world.composer?.buildings?.personalities || []) {
      const emoji = BUILDING_EMOJI[building.kind];
      if (emoji) place(building.x, building.z, emoji);
    }

    // Les positions se lisent directement dans les matrices d'instance : les
    // douzième et quatorzième réels de chaque matrice 4×4 en colonnes sont sa
    // translation en x et en z. Pas de seconde liste à tenir d'accord avec ce
    // qui est réellement posé.
    const instanced = world.composer?.furniture?.instanced;
    for (const [kind, mesh] of instanced || []) {
      const emoji = FURNITURE_EMOJI[kind];
      if (!emoji || !mesh?.count) continue;
      const matrices = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count; i++) {
        place(matrices[i * 16 + 12], matrices[i * 16 + 14], emoji);
      }
    }

    // Les bêtes en dernier, et l'ordre est le fond de l'affaire : elles se
    // comptent par centaines dans la bulle là où un château d'eau s'y compte
    // sur les doigts. Passées avant, elles rafleraient les cases des repères
    // qui servent réellement à s'orienter.
    //
    // Elles ne noient pas la carte pour autant, parce que le filtre par case
    // les regroupe : un troupeau tient dans quelques mètres, une case en fait
    // trente-six sur le radar rond et soixante sur la grande carte — un pré
    // occupé donne donc **un** émoji, pas douze. C'est même la bonne lecture :
    // ce qu'on veut savoir d'un pré, c'est qu'il y a des vaches dedans.
    //
    // Leurs matrices sont réécrites à chaque image (`faunaLayer.advance`) :
    // les émojis se déplacent donc réellement sur la carte, contrairement à
    // tout le reste.
    for (const [kind, mesh] of world.composer?.fauna?.meshes || []) {
      if (!mesh?.count) continue;
      const emoji = FAUNA_EMOJI[kind] || FAUNA_FALLBACK_EMOJI;
      const matrices = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count; i++) {
        place(matrices[i * 16 + 12], matrices[i * 16 + 14], emoji);
      }
    }
  }

  // Cône de vision : direction du regard aplatie au sol, sans conversion
  // d'angle — (dir.x, dir.z) est déjà l'angle canevas puisque les deux
  // repères partagent la même orientation (voir l'en-tête de section).
  camera.getWorldDirection(minimapForward);
  minimapForward.y = 0;
  if (minimapForward.lengthSq() < 1e-8) minimapForward.set(0, 0, -1);
  else minimapForward.normalize();
  const heading = Math.atan2(minimapForward.z, minimapForward.x);
  const cam = toPx(camera.position.x, camera.position.z);
  ctx.beginPath();
  ctx.moveTo(cam.px, cam.py);
  ctx.arc(cam.px, cam.py, coneRadius, heading - MINIMAP_FOV_RAD / 2, heading + MINIMAP_FOV_RAD / 2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(111, 168, 240, 0.32)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cam.px, cam.py, dotRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#6fa8f0';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function updateMinimap() {
  // Le radar rond porte les mêmes repères que la carte plein écran : c'est ce
  // qu'on regarde en marchant, et un château d'eau à cent mètres est
  // exactement l'information qui décide où aller. Les émojis y sont
  // proportionnellement plus gros — le canevas fait 320 pixels internes pour
  // 160 à l'écran, un émoji réglé comme sur la grande carte y serait un point.
  drawMinimapPanel(minimapCtx, MINIMAP_PX, MINIMAP_SCALE, camera.position.x, camera.position.z, {
    emojis: true,
    emojiSize: MINIMAP_PX * 0.075,
  });
}

// Le clic sur la mini-carte ronde ne téléporte plus directement : il ouvre la
// carte plein écran (voir plus bas), seule capable d'afficher assez de champ
// et de détail pour viser un endroit précis.
minimapCanvas.addEventListener('click', () => openMapOverlay());

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

// --- Carte plein écran ---------------------------------------------------------
// Le radar rond suffit pour se repérer en marchant, pas pour viser un endroit
// précis à distance : ouverte en grand, la carte peut se glisser librement
// (un centre de rendu décalé, `bigPanX`/`bigPanZ`, indépendant de la caméra)
// et montre un émoji par bâtiment repéré. Le clic y téléporte, comme le clic
// simple sur la scène 3D ou l'ancien clic sur le radar rond.

const BIG_MINIMAP_PX = bigMinimapCanvas.width;
const BIG_MINIMAP_RANGE_M = 900; // rayon affiché : bien plus large que le radar rond
const BIG_MINIMAP_SCALE = (BIG_MINIMAP_PX / 2) / BIG_MINIMAP_RANGE_M;

/** Un émoji par personnalité de bâtiment (`LABEL_BUILDING_PERSONALITY`, mêmes clés). */
const BUILDING_EMOJI = {
  church: '⛪',
  mosque: '🕌',
  hospital: '🏥',
  bakery: '🥖',
  retail: '🏬',
  shop: '🏪',
};

/*
 * Un émoji par pièce de mobilier **remarquable**, par clé de
 * `FURNITURE_PROFILES` (les mêmes que `LABEL_FURNITURE`).
 *
 * Le critère est la rareté, pas l'importance : une carte sert à s'orienter, et
 * on s'oriente sur ce qui ne se répète pas. Un lampadaire, un piquet, un
 * panneau, un arbre ou un cep se comptent par centaines dans la bulle — les
 * marquer noierait la carte et n'apprendrait rien. Un château d'eau, un
 * moulin, une grande roue s'y comptent sur les doigts d'une main, et c'est
 * précisément ce qu'on cherche des yeux.
 *
 * Une clé absente ne se dessine pas, ce qui est le cas de l'écrasante
 * majorité du catalogue.
 */
const FURNITURE_EMOJI = {
  castle: '🏰',
  tower: '🗼',
  monument: '🗿',
  lighthouse: '🔦',
  windmill: '🌬️',
  watermill: '💧',
  waterTower: '🚰',
  windTurbine: '💨',
  radioMast: '📡',
  factoryChimney: '🏭',
  ferrisWheel: '🎡',
  stadium: '🏟️',
  silo: '🛢️',
  barn: '🚜',
  greenhouse: '🌱',
  fountain: '⛲',
  lavoir: '🧺',
  cemeteryGate: '🪦',
  busShelter: '🚏',
};

/*
 * Un émoji par espèce, par clé de `FAUNA_SPECIES` (les mêmes que
 * `LABEL_FAUNA`).
 *
 * Elles échappent au critère de rareté qui gouverne le mobilier, pour deux
 * raisons distinctes. Le bétail est nombreux mais **groupé** : le filtre par
 * case le réduit à un émoji par pré, ce qui est exactement l'information
 * qu'on veut d'un pré. Le gibier et les carnassiers, eux, sont rares par
 * construction — un massif sur sept abrite un renard ou un loup — et rentrent
 * donc dans le critère d'origine sans le moindre aménagement : un 🐺 sur la
 * carte est très précisément ce qu'on cherche des yeux.
 *
 * Trois cervidés pour un seul émoji : le jeu n'en a pas pour la biche ni pour
 * le renne, et inventer une approximation (un 🐴 pour un renne) tromperait
 * plus qu'un 🦌 honnêtement générique.
 */
const FAUNA_EMOJI = {
  cow: '🐄',
  sheep: '🐑',
  goat: '🐐',
  horse: '🐎',
  donkey: '🫏',
  chicken: '🐔',
  deer: '🦌',
  doe: '🦌',
  reindeer: '🦌',
  boar: '🐗',
  fox: '🦊',
  wolf: '🐺',
  bear: '🐻',
};

/**
 * Ce qui marque une bête dont l'espèce n'a pas encore son émoji. Une patte
 * plutôt que rien : le catalogue du vivant grossira, et une espèce ajoutée
 * sans passer par la table ci-dessus doit se voir sur la carte, pas en
 * disparaître en silence.
 */
const FAUNA_FALLBACK_EMOJI = '🐾';

// La légende annonce les trois familles : sans elle, un 🚰 au milieu d'un
// champ se lit comme une faute plutôt que comme un château d'eau. Dédoublonnée
// — les trois cervidés partagent un émoji, et l'annoncer trois fois donnerait
// à croire qu'il veut dire trois choses.
mapOverlayLegend.textContent = [
  ...new Set([
    ...Object.values(BUILDING_EMOJI),
    ...Object.values(FURNITURE_EMOJI),
    ...Object.values(FAUNA_EMOJI),
    FAUNA_FALLBACK_EMOJI,
  ]),
].join(' ');

let bigPanX = 0;
let bigPanZ = 0;
let bigPointerId = null;
let bigDragged = false;
let bigDownX = 0;
let bigDownY = 0;
let bigDownAt = 0;
let bigDownPanX = 0;
let bigDownPanZ = 0;

function bigCenter() {
  return { cx: camera.position.x + bigPanX, cz: camera.position.z + bigPanZ };
}

function updateBigMinimap() {
  const { cx, cz } = bigCenter();
  drawMinimapPanel(bigMinimapCtx, BIG_MINIMAP_PX, BIG_MINIMAP_SCALE, cx, cz, {
    emojis: true,
    dotRadius: BIG_MINIMAP_PX * 0.012,
    coneRadius: BIG_MINIMAP_PX * 0.34,
    roadWidth: 4,
  });
}

function openMapOverlay() {
  if (!world) return;
  bigPanX = 0;
  bigPanZ = 0; // recentré sur la caméra à chaque ouverture
  mapOverlay.hidden = false;
  updateBigMinimap();
}

function closeMapOverlay() {
  mapOverlay.hidden = true;
}

mapOverlayClose.addEventListener('click', closeMapOverlay);
mapOverlay.addEventListener('click', (e) => {
  if (e.target === mapOverlay) closeMapOverlay(); // clic hors carte : referme
});

bigMinimapCanvas.addEventListener('pointerdown', (e) => {
  bigPointerId = e.pointerId;
  bigDragged = false;
  bigDownX = e.clientX;
  bigDownY = e.clientY;
  bigDownAt = performance.now();
  bigDownPanX = bigPanX;
  bigDownPanZ = bigPanZ;
  bigMinimapCanvas.setPointerCapture(e.pointerId);
});

bigMinimapCanvas.addEventListener('pointermove', (e) => {
  if (bigPointerId === null) return;
  const dx = e.clientX - bigDownX;
  const dy = e.clientY - bigDownY;
  if (!bigDragged && Math.hypot(dx, dy) > CLICK_MAX_DRAG_PX) {
    bigDragged = true;
    bigMinimapCanvas.classList.add('dragging');
  }
  if (bigDragged) {
    // Le canevas est affiché plus petit que sa résolution interne (`max-width:
    // 100%`) : il faut le ratio résolution/affichage pour convertir un
    // déplacement écran en mètres, sinon glisser va deux fois trop vite ou
    // deux fois trop lentement selon l'écran.
    const rect = bigMinimapCanvas.getBoundingClientRect();
    const pxPerScreenPx = BIG_MINIMAP_PX / rect.width;
    bigPanX = bigDownPanX - (dx * pxPerScreenPx) / BIG_MINIMAP_SCALE;
    bigPanZ = bigDownPanZ - (dy * pxPerScreenPx) / BIG_MINIMAP_SCALE;
  }
});

bigMinimapCanvas.addEventListener('pointerup', (e) => {
  if (bigPointerId === null) return;
  bigMinimapCanvas.releasePointerCapture(e.pointerId);
  bigPointerId = null;
  bigMinimapCanvas.classList.remove('dragging');
  const wasClick = !bigDragged && performance.now() - bigDownAt < CLICK_MAX_MS;
  if (wasClick) {
    const rect = bigMinimapCanvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (BIG_MINIMAP_PX / rect.width);
    const py = (e.clientY - rect.top) * (BIG_MINIMAP_PX / rect.height);
    const { cx, cz } = bigCenter();
    const x = cx + (px - BIG_MINIMAP_PX / 2) / BIG_MINIMAP_SCALE;
    const z = cz + (py - BIG_MINIMAP_PX / 2) / BIG_MINIMAP_SCALE;
    teleportTo(x, z);
    closeMapOverlay();
  }
});

// --- Google Street View ---------------------------------------------------------
// Ouvre la vue Street View de Google Maps sur la position courante de la
// caméra — un service tiers, jamais interrogé par le moteur : la démo se
// contente de composer une URL, voir la documentation « Google Maps URLs ».

streetViewBtn.addEventListener('click', () => {
  if (!world) return;
  const { lng, lat } = world.frame.toLngLat(camera.position.x, camera.position.z);
  camera.getWorldDirection(cameraDirection);
  const heading = (rad2deg(Math.atan2(cameraDirection.x, -cameraDirection.z)) + 360) % 360;
  const url = new URL('https://www.google.com/maps/@');
  url.searchParams.set('api', '1');
  url.searchParams.set('map_action', 'pano');
  url.searchParams.set('viewpoint', `${lat},${lng}`);
  url.searchParams.set('heading', heading.toFixed(0));
  url.searchParams.set('pitch', '0');
  window.open(url.toString(), '_blank', 'noopener');
});

// --- Météo et heure ------------------------------------------------------------
// Tout ce qui suit est du ressort de l'application : le moteur reçoit un état
// météo et une date, il ne les fabrique pas. Voir l'en-tête du fichier.

/**
 * Les temps prêts à l'emploi — des réglages de démonstration, pas une
 * nomenclature météorologique. « Ordinaire » est repris de `DEFAULT_WEATHER`
 * plutôt que recopié, pour ne jamais diverger du bouton.
 */
const PRESETS = [
  { label: '☀️ Grand beau', weather: { cloudCover: 0.06, cloudDensity: 0.35, precipitation: 0, wind: 0.12, haze: 0 } },
  { label: '⛅ Ordinaire', weather: DEFAULT_WEATHER },
  { label: '☁️ Couvert', weather: { cloudCover: 0.95, cloudDensity: 0.8, precipitation: 0, wind: 0.35, haze: 0.05 } },
  { label: '🌧️ Pluie', weather: { cloudCover: 0.9, cloudDensity: 0.85, precipitation: 0.55, precipitationType: 'rain', wind: 0.4, haze: 0.05 } },
  { label: '⛈️ Orage', weather: { cloudCover: 1, cloudDensity: 1, precipitation: 1, precipitationType: 'rain', wind: 0.85, haze: 0.1 } },
  { label: '❄️ Neige', weather: { cloudCover: 0.85, cloudDensity: 0.7, precipitation: 0.6, precipitationType: 'snow', wind: 0.3, haze: 0.15 } },
  { label: '🌫️ Brume', weather: { cloudCover: 0.3, cloudDensity: 0.4, precipitation: 0, wind: 0.05, haze: 0.65 } },
];

/** Les six curseurs, tous exprimés de 0 à 100 dans le DOM et de 0 à 1 côté moteur. */
const SLIDER_KEYS = ['cloudCover', 'cloudDensity', 'precipitation', 'wind', 'haze', 'wetness'];
const sliders = {};
for (const key of SLIDER_KEYS) {
  sliders[key] = { input: document.getElementById(key), val: document.getElementById(`${key}Val`) };
}
const precipitationTypeSelect = document.getElementById('precipitationType');

/** Direction du vent : un curseur à part, en degrés (0-359), pas une part de 0 à 1 comme les autres. */
const windDirectionSlider = {
  input: document.getElementById('windDirection'),
  val: document.getElementById('windDirectionVal'),
};

/**
 * Calibration de la réglette « couverture nuageuse ». Le masque de nuage du
 * `Sky.js` natif de three sature vers 0,5 (la moitié haute de 0-1 ne change
 * presque rien) : cette table, mesure empirique de ce masque, fait qu'une
 * réglette 0-100 % répond sur toute sa course (`uiToCloudCover`,
 * `cloudCoverToUi`). Calibrage de présentation propre à la démo : ne change
 * pas la sémantique de `weather.cloudCover`.
 */
const CLOUD_COVER_CURVE = [0, 0.16, 0.2, 0.23, 0.26, 0.29, 0.31, 0.34, 0.37, 0.41, 0.55];

function interpolateCurve(curve, x) {
  const scaled = Math.min(1, Math.max(0, x)) * (curve.length - 1);
  const i = Math.min(curve.length - 2, Math.floor(scaled));
  const t = scaled - i;
  return curve[i] + (curve[i + 1] - curve[i]) * t;
}

/** Position de réglette (0–1) → `weather.cloudCover` (0–1). */
function uiToCloudCover(ui) {
  return interpolateCurve(CLOUD_COVER_CURVE, ui);
}

/** `weather.cloudCover` (0–1) → position de réglette (0–1). Inverse de la table. */
function cloudCoverToUi(raw) {
  const value = Math.min(1, Math.max(0, raw));
  for (let i = 1; i < CLOUD_COVER_CURVE.length; i++) {
    if (CLOUD_COVER_CURVE[i] >= value) {
      const lo = CLOUD_COVER_CURVE[i - 1];
      const hi = CLOUD_COVER_CURVE[i];
      const t = hi === lo ? 0 : (value - lo) / (hi - lo);
      return (i - 1 + t) / (CLOUD_COVER_CURVE.length - 1);
    }
  }
  return 1;
}

/**
 * Le mouillé suit l'averse **jusqu'à ce qu'on y touche**. C'est la seule façon
 * de regarder un sol trempé sans avoir la pluie devant les yeux — et de vérifier
 * qu'un sol sèche sans que le ciel change, ce qu'une application réelle ferait
 * avec sa propre constante de temps (le moteur, lui, ne garde aucun état entre
 * deux images : voir `DEFAULT_WEATHER.wetness`).
 */
let wetnessManual = false;
/** Ne repasse la météo au moteur que lorsqu'elle a bougé : omise, il la reconduit. */
let weatherDirty = true;

function readWeather() {
  const weather = { precipitationType: precipitationTypeSelect.value };
  for (const key of SLIDER_KEYS) weather[key] = Number(sliders[key].input.value) / 100;
  // Voir `CLOUD_COVER_CURVE` : la position de la réglette est calibrée pour
  // répondre sur toute sa course, pas la valeur brute envoyée au moteur.
  weather.cloudCover = uiToCloudCover(weather.cloudCover);
  weather.windDirection = (Number(windDirectionSlider.input.value) * Math.PI) / 180;
  return weather;
}

/** Recopie un état météo dans les curseurs, sans déclencher leurs écouteurs. */
function writeWeather(weather) {
  const full = { ...DEFAULT_WEATHER, ...weather };
  for (const key of SLIDER_KEYS) {
    if (key === 'wetness') continue;
    const ui = key === 'cloudCover' ? cloudCoverToUi(full[key]) : full[key];
    sliders[key].input.value = Math.round(ui * 100);
  }
  precipitationTypeSelect.value = full.precipitationType;
  // En degrés positifs, dans le sens du curseur : un `windDirection` négatif
  // ou au-delà d'un tour (un preset pourrait en fournir un) doit quand même
  // retomber dans [0, 360[.
  const degrees = (((full.windDirection * 180) / Math.PI) % 360 + 360) % 360;
  windDirectionSlider.input.value = Math.round(degrees);
  wetnessManual = false;
  syncWetness();
  refreshWeatherLabels();
  weatherDirty = true;
}

/** Accorde le mouillé sur l'averse, tant que personne ne l'a pris en main. */
function syncWetness() {
  if (wetnessManual) return;
  const snowing = precipitationTypeSelect.value === 'snow';
  // Même règle que le moteur : la neige blanchit le sol, elle ne le noircit pas.
  sliders.wetness.input.value = snowing ? 0 : sliders.precipitation.input.value;
}

function refreshWeatherLabels() {
  for (const key of SLIDER_KEYS) {
    const percent = `${sliders[key].input.value} %`;
    sliders[key].val.textContent =
      key === 'wetness' && !wetnessManual ? `${percent} · auto` : percent;
  }
  windDirectionSlider.val.textContent = `${windDirectionSlider.input.value}°`;
  hourVal.textContent = realTimeCheckbox.checked
    ? new Date().toTimeString().slice(0, 5)
    : formatHour(Number(hourInput.value));
}

function formatHour(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

for (const key of SLIDER_KEYS) {
  sliders[key].input.addEventListener('input', () => {
    if (key === 'wetness') wetnessManual = true;
    if (key === 'precipitation') syncWetness();
    refreshWeatherLabels();
    clearPresetHighlight();
    weatherDirty = true;
  });
}
precipitationTypeSelect.addEventListener('change', () => {
  syncWetness();
  refreshWeatherLabels();
  clearPresetHighlight();
  weatherDirty = true;
});
windDirectionSlider.input.addEventListener('input', () => {
  refreshWeatherLabels();
  clearPresetHighlight();
  weatherDirty = true;
});

function clearPresetHighlight() {
  for (const button of presetsRoot.children) button.classList.remove('on');
}

for (const preset of PRESETS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = preset.label;
  button.addEventListener('click', () => {
    writeWeather(preset.weather);
    clearPresetHighlight();
    button.classList.add('on');
  });
  presetsRoot.appendChild(button);
}
// L'état de départ vient de `writeWeather`, pas des attributs `value` du HTML :
// la position de la réglette de couverture est calibrée (`cloudCoverToUi`), un
// « 42 » écrit en dur dans le markup ne représenterait pas la bonne position.
writeWeather(DEFAULT_WEATHER);
presetsRoot.children[1].classList.add('on'); // « Ordinaire », qui est l'état de départ
weatherBtn.textContent = PRESETS[1].label.split(' ')[0];

// Raccourci « temps suivant » : rejoue le même clic que le bouton de temps
// prêt à l'emploi actif + 1, pour ne pas dupliquer la logique de sélection.
// Il cycle la **météo**, pas le climat — celui-ci a son propre sélecteur, et
// confondre les deux était le principal malentendu de l'ancien nom.
weatherBtn.addEventListener('click', () => {
  const buttons = [...presetsRoot.children];
  const current = buttons.findIndex((b) => b.classList.contains('on'));
  const next = buttons[(current + 1) % buttons.length];
  next.click();
  weatherBtn.textContent = PRESETS[buttons.indexOf(next)].label.split(' ')[0];
});

/*
 * --- Choix du climat ---------------------------------------------------------
 *
 * Le décor tire sa famille climatique du lieu (grille Köppen, `core/climate`).
 * Ce sélecteur la **remplace** : le moteur cesse alors de suivre la
 * géographie, ce qui est exactement ce qu'on veut pour juger le travail — même
 * terrain, mêmes routes, mêmes parcelles, tout le reste changé. Se téléporter
 * en Laponie change aussi le tracé, le bâti et la pente, et on ne sait plus ce
 * qui vient du climat.
 *
 * Les noms viennent de `CLIMATE_FAMILIES`, qui est la liste que le moteur
 * connaît : une famille ajoutée là apparaît ici sans rien écrire.
 */
const CLIMATE_LABELS = {
  oceanic: 'Océanique — Bretagne, Irlande',
  oceanicUpland: 'Océanique froid — Highlands, Islande',
  mediterranean: 'Méditerranéen — Provence, Grèce',
  mediterraneanCool: 'Méditerranéen tempéré — Galice',
  semiArid: 'Steppe — Èbre, Castille',
  arid: 'Désertique — Tabernas, Bardenas',
  continental: 'Continental — Pologne, plaine du Pô',
  boreal: 'Boréal — Scandinavie, taïga',
  alpine: 'Alpin — au-dessus de la forêt',
  mediterraneanMontane: 'Montagne sèche — Apennins, sierras',
  glacial: 'Glaciaire — calottes',
};

climateSelect.append(new Option('Automatique (d’après le lieu)', ''));
for (const family of CLIMATE_FAMILIES) {
  climateSelect.append(new Option(CLIMATE_LABELS[family] || family, family));
}

// --- Faune : déclencher une traversée -----------------------------------------
//
// C'est ici que passe la frontière moteur/application pour le vivant, et elle
// est nette : le moteur pose des bêtes en fonction du lieu, et il ne décide
// jamais qu'il se passe quelque chose. Une traversée, elle, est un événement —
// c'est l'application qui en choisit l'instant, l'espèce et la distance, comme
// le ferait un jeu à ses événements aléatoires. La bête n'est pas ajoutée au
// monde : elle est jouée par-dessus, et un second passage ne la retrouvera pas.

for (const kind of FAUNA_KINDS) {
  faunaKindSelect.append(new Option(LABEL_FAUNA[kind] || kind, kind));
}
faunaKindSelect.value = 'deer';

/** De quel côté débouche la prochaine bête : on alterne, pour voir les deux. */
let faunaSide = 1;

function writeFaunaDistance() {
  faunaDistanceVal.textContent = `${faunaDistanceInput.value} m`;
}
faunaDistanceInput.addEventListener('input', writeFaunaDistance);
writeFaunaDistance();

/** Lance une bête en travers du regard de la caméra. */
function crossFaunaAhead() {
  if (!world) return;
  camera.getWorldDirection(cameraDirection);
  const crossing = world.crossFauna({
    kind: faunaKindSelect.value,
    at: { x: camera.position.x, z: camera.position.z },
    // Le regard à plat : une caméra qui pique du nez ne doit pas raccourcir la
    // traversée, elle vise toujours le même point au sol devant elle.
    forward: { x: cameraDirection.x, z: cameraDirection.z },
    distanceM: Number(faunaDistanceInput.value),
    side: faunaSide,
  });
  faunaSide = -faunaSide;
  setStatus(
    crossing
      ? `${LABEL_FAUNA[faunaKindSelect.value] || faunaKindSelect.value} : traversée lancée`
      : 'Traversée impossible ici (sol non chargé ?)',
    !crossing
  );
}

faunaCrossBtn.addEventListener('click', crossFaunaAhead);

// Au clavier aussi : une traversée se déclenche en roulant, pas en fouillant
// un panneau replié.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyC' || isTypingTarget(document.activeElement)) return;
  e.preventDefault();
  crossFaunaAhead();
});

/** Reconstruit le décor sur place, sans bouger la caméra. */
async function rebuildHere(message) {
  if (!world || !world.frame) return;
  setBusy(true);
  setStatus(message);
  try {
    const { lng, lat } = world.frame.toLngLat(camera.position.x, camera.position.z);
    // Forcé : le climat décide de ce qu'il y a à poser, pas seulement d'où —
    // rien ne serait périmé au sens du compositeur si on ne le lui disait pas.
    await world.refresh(lng, lat, { force: true });
    setStatus('');
  } catch (err) {
    setStatus(err.message || 'Reconstruction interrompue', true);
  } finally {
    setBusy(false);
  }
}

climateSelect.addEventListener('change', () => {
  const family = climateSelect.value || null;
  if (!world || !world.setClimate(family)) return;
  writeClimateHint();
  rebuildHere(family ? 'Changement de climat…' : 'Retour au climat du lieu…');
});

/** Rappelle ce que le sélecteur fait au décor, et ce qu'il ne fait pas. */
function writeClimateHint() {
  climateHint.textContent = climateSelect.value
    ? 'Le décor ne suit plus le lieu : essences, villages, cultures et sol sont ceux de ce climat.'
    : 'Le climat est lu dans la grille Köppen, à la position de la caméra.';
}
writeClimateHint();

hourInput.addEventListener('input', refreshWeatherLabels);
realTimeCheckbox.addEventListener('change', () => {
  hourInput.disabled = realTimeCheckbox.checked;
  refreshWeatherLabels();
});
hourInput.disabled = realTimeCheckbox.checked;
refreshWeatherLabels();

/**
 * L'heure à simuler. Le curseur pose une heure locale du jour même — c'est
 * suffisant pour parcourir une journée, et ça évite d'avoir à expliquer un
 * fuseau dans une démo.
 */
function currentDate() {
  if (realTimeCheckbox.checked) return new Date();
  const hour = Number(hourInput.value);
  const date = new Date();
  date.setHours(Math.floor(hour), Math.round((hour - Math.floor(hour)) * 60), 0, 0);
  return date;
}

// --- Boucle principale ----------------------------------------------------------

function loop() {
  requestAnimationFrame(loop);
  const delta = Math.min(clock.getDelta(), 0.1); // évite un bond si l'onglet était en arrière-plan

  updateMovement(delta);

  if (world) {
    // `advance` situe la pluie et les feuilles au sol au point observé, pas à
    // la hauteur des yeux : lui passer `camera.position` tel quel les aurait
    // fait flotter en l'air, à hauteur de caméra plutôt que par terre. Le
    // même sondage que `sampleGroundHeight` ailleurs dans ce fichier ; `null`
    // hors de la bulle chargée retombe sur la caméra, comme avant ce correctif.
    const ground = sampleGroundHeight(camera.position.x, camera.position.z);
    world.advance(delta, {
      x: camera.position.x,
      y: ground ?? camera.position.y,
      z: camera.position.z,
    });
    // La position du soleil se calcule là où l'on est, pas là où l'on a
    // commencé : à la même heure, il est bas sur la Laponie et haut sur la
    // Crète, et c'est la première chose qui dit le pays.
    const sunHere = world.frame ? world.frame.toLngLat(camera.position.x, camera.position.z) : START;
    const paint = world.updateSky({
      camera,
      date: currentDate(),
      lng: sunHere.lng,
      lat: sunHere.lat,
      // Omise, la météo est reconduite : inutile de refaire l'objet et de
      // reprogrammer les particules à chaque image quand rien n'a bougé.
      weather: weatherDirty ? readWeather() : undefined,
    });
    weatherDirty = false;
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
    if (!mapOverlay.hidden) updateBigMinimap();
    // L'horloge n'avance que si c'est elle qu'on suit : le curseur, lui, ne
    // bouge que quand on le pousse.
    if (realTimeCheckbox.checked) hourVal.textContent = new Date().toTimeString().slice(0, 5);
  }

  // Cap et inclinaison à côté des coordonnées : une scène à rejouer, c'est
  // un lieu ET un regard — sans le cap, deux personnes qui collent la même
  // coordonnée peuvent regarder deux choses différentes.
  camera.getWorldDirection(cameraDirection);
  const bearingDeg = (rad2deg(Math.atan2(cameraDirection.x, -cameraDirection.z)) + 360) % 360;
  const pitchDeg = rad2deg(Math.asin(THREE.MathUtils.clamp(cameraDirection.y, -1, 1)));
  const here = world ? world.frame.toLngLat(camera.position.x, camera.position.z) : null;
  const where = here
    ? `lng ${here.lng.toFixed(5)}  lat ${here.lat.toFixed(5)}`
    : `x ${camera.position.x.toFixed(0)}  z ${camera.position.z.toFixed(0)}`;
  // Le climat courant s'affiche parce qu'il ne se lit pas au premier coup
  // d'oeil : c'est lui qui décide des essences, des palettes de village et de
  // l'assolement, et sans repère écrit on ne sait pas si le décor a changé de
  // pays ou si l'on regarde deux fois le même bois.
  const profile = world?.composer?.landscape;
  // Sans code Köppen, la famille est imposée : le code décrivait le lieu,
  // qu'on a justement cessé de suivre.
  const climat = profile
    ? `  ${profile.climate.family} (${profile.climate.koppen || 'imposé'})`
    : '';
  coordsEl.textContent = `${where}  alt ${camera.position.y.toFixed(0)} m  cap ${bearingDeg.toFixed(0)}°  incl ${pitchDeg.toFixed(0)}°${climat}`;

  renderer.render(scene, camera);
}

boot().catch((err) => {
  console.error(err);
  setBusy(false);
  setStatus(`Erreur au démarrage : ${err.message}`, true);
});
