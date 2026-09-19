/*
 * demo/showcase.js — le mode « afficheur » : une scène à part, séparée de
 * celle du monde, pilotée par `src/inspect/showcase.js` (`main.js` choisit
 * laquelle rendre selon le mode actif).
 *
 * Deux présentations, selon ce que le champ désigne (`TILE_FIELDS`) :
 *
 * - **grille** (pierre, bâti, arbres) : une vignette par mot, côte à côte —
 *   une couleur ou une silhouette isolée suffit à en juger.
 * - **tuile** (terrain, cultures) : une couleur seule mentirait sur ce qui
 *   recouvre le sol, donc une seule tuile pleine à la fois, avec de vraies
 *   touffes d'herbe ou tiges de culture (`GroundCover`/`CropLayer`, les mêmes
 *   couches que le monde emploie) posées sur un `groundClass` truqué qui
 *   répond « ce mot, partout » plutôt que de lire des tuiles vectorielles. Un
 *   second sélecteur du panneau (`showcaseWord`) choisit lequel.
 */

import * as THREE from 'three';
import {
  showcaseEntries,
  SHOWCASE_FIELDS,
  TILE_FIELDS,
  uniformGroundSample,
  createFurnitureGeometries,
  createFurnitureMaterial,
  GroundCover,
  CropLayer,
  defaultTheme,
} from '../src/index.js';

/** Côté d'une case de la grille, en mètres. */
const CELL_M = 5;
/** Colonnes de la grille, choisi pour rester lisible sur un écran de téléphone en portrait. */
const COLUMNS = 5;

function linearColor(albedo) {
  return new THREE.Color().setRGB(albedo[0], albedo[1], albedo[2], THREE.LinearSRGBColorSpace);
}

/** Étiquette texte, en sprite : elle doit rester lisible de n'importe quel côté. */
function makeLabelSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(10, 13, 18, 0.78)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '28px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = '#eef2f6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(2.6, 0.65, 1);
  return sprite;
}

/** Toit à deux pans (faîtière le long de z), en triangles bruts façon `Kit`. */
function gableRoofGeometry(THREE, width, depth, rise) {
  const A = [-width / 2, 0, -depth / 2];
  const B = [width / 2, 0, -depth / 2];
  const C = [width / 2, 0, depth / 2];
  const D = [-width / 2, 0, depth / 2];
  const Rf = [0, rise, -depth / 2];
  const Rb = [0, rise, depth / 2];
  const tris = [A, D, Rb, A, Rb, Rf, B, Rf, Rb, B, Rb, C, A, B, Rf, D, Rb, C];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Une maison minimale (mur + toit), assez pour juger une couleur, pas un plan. */
function buildHouse(THREE, entry) {
  const group = new THREE.Group();
  const hip = entry.roofShape === 'pyramid' || entry.roofShape === 'hip';

  const wallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(entry.wall), roughness: 0.9 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2, 2.2), wallMat);
  wall.position.y = 1;
  group.add(wall);

  const roofMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(entry.roof),
    roughness: 0.75,
    side: THREE.DoubleSide,
  });
  const roof = hip
    ? new THREE.Mesh(new THREE.ConeGeometry(1.65, 1.1, 4), roofMat)
    : new THREE.Mesh(gableRoofGeometry(THREE, 2.4, 2.4, 1.1), roofMat);
  if (hip) roof.rotation.y = Math.PI / 4;
  roof.position.y = 2;
  group.add(roof);

  // Le côté que ce mot ne désigne pas, en gris neutre : un mot de mur ne dit
  // rien du toit qui l'accompagnerait ailleurs, et l'inverse est vrai aussi —
  // seul le côté que ce mot nomme vient du thème.
  (entry.part === 'wall' ? roofMat : wallMat).color.set('#6b6f76');

  return group;
}

/** Un bloc : la géologie n'est pas un sol qu'on marche, c'est une masse qui affleure. */
function buildBlock(THREE, entry) {
  const geometry = new THREE.BoxGeometry(2.4, 1.4, 2.4);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  material.color = linearColor(entry.albedo);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.7;
  return mesh;
}

/**
 * La même géométrie, recolorée vers `albedo` en gardant le grain facetté du
 * modèle d'origine (chaque facette garde sa clarté relative, seule la teinte
 * change) — il n'existe pas de buisson de lavande dans le catalogue, `bush`
 * est un repère approché, pas la vraie plante.
 */
function recoloredGeometry(THREE, geometry, albedo) {
  const recolored = geometry.clone();
  const colors = recolored.getAttribute('color');
  for (let i = 0; i < colors.count; i++) {
    const shade = (colors.getX(i) + colors.getY(i) + colors.getZ(i)) / 3 / 0.4; // 0,4 : clarté moyenne du feuillage d'origine
    colors.setXYZ(i, albedo[0] * shade, albedo[1] * shade, albedo[2] * shade);
  }
  colors.needsUpdate = true;
  return recolored;
}

/**
 * Sème une géométrie en rangs réguliers sur un carré centré, avec un peu de
 * gigue pour ne pas trahir la grille au premier coup d'œil. Un
 * `InstancedMesh` : un rang de vigne en pose des centaines.
 */
function scatterRows(THREE, geometry, material, { areaM, spacingX, spacingZ, offsetZ = 0, disposableGeometry = false }) {
  const cols = Math.max(1, Math.round(areaM / spacingX));
  const rows = Math.max(1, Math.round(areaM / spacingZ));
  const mesh = new THREE.InstancedMesh(geometry, material, cols * rows);
  mesh.userData.disposableGeometry = disposableGeometry;
  const m = new THREE.Matrix4();
  let i = 0;
  for (let cz = 0; cz < rows; cz++) {
    for (let cx = 0; cx < cols; cx++) {
      const jitterX = (Math.random() - 0.5) * spacingX * 0.25;
      const jitterZ = (Math.random() - 0.5) * spacingZ * 0.25;
      const x = (cx - (cols - 1) / 2) * spacingX + jitterX;
      const z = (cz - (rows - 1) / 2) * spacingZ + jitterZ + offsetZ;
      m.makeRotationY(Math.random() * Math.PI * 2);
      m.setPosition(x, 0, z);
      mesh.setMatrixAt(i++, m);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/**
 * Construit et pilote la scène de l'afficheur.
 * @param {Object} THREEns Le module `three` déjà importé par `main.js`.
 */
export function createShowcase(THREEns) {
  const scene = new THREEns.Scene();
  scene.background = new THREEns.Color(0x1b1f27);

  scene.add(new THREEns.HemisphereLight(0xcfd9e6, 0x22262c, 1.1));
  const sun = new THREEns.DirectionalLight(0xfff2df, 1.4);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  const grid = new THREEns.Group();
  scene.add(grid);

  const tile = new THREEns.Group();
  scene.add(tile);

  // --- La tuile pleine : sol + vraie couverture, sur un groundClass truqué --

  /** Ce que `groundClass.sampleAt`/`surfaceAt`/`cropAt` répondent, partout. */
  const tileState = { sample: uniformGroundSample(null), surface: null, crop: null };
  const fakeGroundClass = {
    ready: true,
    cropReady: true,
    sampleAt: () => tileState.sample,
    surfaceAt: () => tileState.surface,
    cropAt: () => tileState.crop,
    woodAt: () => (tileState.surface === 'wood' ? 1 : 0),
  };
  // Bulle plate : ni tuile ni relief, la tuile de l'afficheur est un plan.
  const fakeBubble = { frame: {}, verticalScale: 1, surfaceElevationAtLocal: () => 0 };

  const groundPlane = new THREEns.Mesh(
    new THREEns.PlaneGeometry(320, 320),
    new THREEns.MeshStandardMaterial({ roughness: 1 })
  );
  groundPlane.rotation.x = -Math.PI / 2;
  tile.add(groundPlane);

  // Coûteuses (jusqu'à 17 000 / 15 000 instances) : montées une fois, pas par mot.
  const grassCover = new GroundCover({ THREE: THREEns, scene: tile, bubble: fakeBubble, groundClass: fakeGroundClass, theme: defaultTheme });
  const cropCover = new CropLayer({ THREE: THREEns, scene: tile, bubble: fakeBubble, groundClass: fakeGroundClass, theme: defaultTheme });
  grassCover.mesh.visible = false;
  cropCover.mesh.visible = false;

  // Le catalogue de formes isolées : les arbres de la grille, le couvert d'un
  // mot boisé, les repères d'un rang de vigne ou de verger — un seul jeu de
  // géométries pour les trois usages.
  const furnitureGeometries = createFurnitureGeometries(THREEns);
  const furnitureMaterial = createFurnitureMaterial(THREEns);

  /** Ce que `canopy`/`rows` ont posé sur la tuile pour le mot courant. */
  const overlay = new THREEns.Group();
  tile.add(overlay);

  function clearOverlay() {
    while (overlay.children.length) {
      const child = overlay.children.pop();
      // La géométrie du catalogue (`furnitureGeometries`) est partagée d'un
      // mot à l'autre ; seule une géométrie teintée à la volée (lavande) est
      // à elle et se libère ici.
      if (child.userData.disposableGeometry) child.geometry?.dispose?.();
      overlay.remove(child);
    }
  }

  let currentField = null;
  let currentEntries = [];

  /** Vide la grille et libère géométries et matériaux propres à une case. */
  function clearGrid() {
    while (grid.children.length) {
      const child = grid.children.pop();
      child.traverse?.((node) => {
        // Le catalogue de formes (`furnitureGeometries`/`furnitureMaterial`)
        // est partagé entre toutes les cases « arbre » et la tuile : une case
        // ne possède que sa propre géométrie (bloc, maison) et son étiquette.
        if (node.geometry && !node.userData.sharedGeometry) node.geometry.dispose();
        if (node.material && node.material !== furnitureMaterial) {
          node.material.map?.dispose();
          node.material.dispose();
        }
      });
      grid.remove(child);
    }
  }

  function buildGrid(entries) {
    clearGrid();

    entries.forEach((entry, i) => {
      const col = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      const cell = new THREEns.Group();
      cell.position.set((col - (COLUMNS - 1) / 2) * CELL_M, 0, row * CELL_M);

      if (entry.shape === 'block') cell.add(buildBlock(THREEns, entry));
      else if (entry.shape === 'house') cell.add(buildHouse(THREEns, entry));
      else if (entry.shape === 'tree') {
        const geometry = furnitureGeometries[entry.alignment];
        if (geometry) {
          const mesh = new THREEns.Mesh(geometry, furnitureMaterial);
          mesh.userData.sharedGeometry = true;
          cell.add(mesh);
        }
      }

      const label = makeLabelSprite(entry.unsupported ? `${entry.label} ⚠` : entry.label);
      label.position.set(0, 2.6, 0);
      cell.add(label);

      grid.add(cell);
    });
  }

  /** Peuple la tuile pleine avec un seul mot (`matrix` ou `farming`). */
  function setWord(value) {
    const entry = currentEntries.find((e) => e.value === value);
    if (!entry) return;
    clearOverlay();

    const isFarming = currentField === 'farming';
    tileState.surface = isFarming ? 'farmland' : entry.surface;
    tileState.crop = isFarming ? entry.crop : null;
    tileState.sample = uniformGroundSample(tileState.surface);
    groundPlane.material.color = linearColor(entry.albedo);

    grassCover.mesh.visible = !isFarming;
    cropCover.mesh.visible = isFarming;
    if (isFarming) cropCover.update(0, 0, { force: true });
    else grassCover.update(0, 0, { force: true });

    // Couvert d'un mot boisé : la matrice ne le pose jamais elle-même (voir
    // `WOOD_CANOPY`), un repère isolé du catalogue évite qu'un bois ne rende
    // qu'un sol nu à l'écran.
    if (!isFarming && entry.canopy) {
      const geometry = furnitureGeometries[entry.canopy];
      if (geometry) {
        const areaM = 90;
        overlay.add(
          scatterRows(THREEns, geometry, furnitureMaterial, { areaM, spacingX: 9, spacingZ: 9, offsetZ: areaM / 2 + 3 })
        );
      }
    }

    // Rangs d'une culture que `CropLayer` ne sème pas (vigne, verger, lavande) :
    // voir `ROW_CROPS`, dans `src/inspect/showcase.js`.
    if (isFarming && entry.rows) {
      const { kind, areaM, spacingX, spacingZ } = entry.rows;
      let geometry = null;
      let disposableGeometry = false;
      if (kind === 'stakes') geometry = furnitureGeometries.vineStock;
      else if (kind === 'trees') geometry = furnitureGeometries.treeOval;
      else if (kind === 'bushes') {
        geometry = recoloredGeometry(THREEns, furnitureGeometries.bush, entry.albedo);
        disposableGeometry = true;
      }
      if (geometry) {
        overlay.add(
          scatterRows(THREEns, geometry, furnitureMaterial, { areaM, spacingX, spacingZ, offsetZ: areaM / 2 + 3, disposableGeometry })
        );
      }
    }
  }

  /** Bascule vers un champ. Rend la liste de ses mots (pour peupler le sélecteur). */
  function setField(field) {
    currentField = field;
    currentEntries = showcaseEntries(field);
    const isTile = TILE_FIELDS.has(field);
    tile.visible = isTile;
    grid.visible = !isTile;
    if (isTile) setWord(currentEntries[0]?.value);
    else buildGrid(currentEntries);
    return currentEntries;
  }

  function dispose() {
    clearGrid();
    clearOverlay();
    grassCover.dispose();
    cropCover.dispose();
    groundPlane.geometry.dispose();
    groundPlane.material.dispose();
    for (const geometry of Object.values(furnitureGeometries)) geometry.dispose();
    furnitureMaterial.dispose();
  }

  return { scene, setField, setWord, dispose, fields: SHOWCASE_FIELDS, isTileField: (field) => TILE_FIELDS.has(field) };
}
