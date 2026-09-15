/*
 * demo/showcase.js — le mode « afficheur » : une scène à part, qui pose côte
 * à côte tous les mots possibles d'un champ de région (`src/inspect/
 * showcase.js`) au lieu de faire rouler la caméra jusqu'au pays qui les
 * emploie. Ce n'est pas un sélecteur de région : le panneau en a déjà un.
 *
 * Scène et éclairage sont les siens, séparés de ceux du monde — `main.js`
 * choisit laquelle rendre selon le mode actif, plutôt que de démonter et
 * remonter le décor à chaque bascule.
 */

import * as THREE from 'three';
import { showcaseEntries, SHOWCASE_FIELDS, createFurnitureGeometries, createFurnitureMaterial } from '../src/index.js';

/** Côté d'une case de la grille, en mètres. */
const CELL_M = 5;
/** Colonnes de la grille, choisi pour rester lisible sur un écran de téléphone en portrait. */
const COLUMNS = 5;

function linearColor(albedo) {
  return new THREE.Color().setRGB(albedo[0], albedo[1], albedo[2], THREE.LinearSRGBColorSpace);
}

/** Étiquette texte, en sprite : elle doit rester lisible de n'importe quel côté de la grille. */
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

/** Un empan de sol coloré : le rendu le plus honnête d'une matière ou d'une culture. */
function buildPlane(THREE, entry) {
  const geometry = new THREE.PlaneGeometry(CELL_M * 0.86, CELL_M * 0.86);
  const material = new THREE.MeshStandardMaterial({ roughness: 1 });
  material.color = linearColor(entry.albedo);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
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

  /** Reconstruit la grille pour un champ. Détruit tout ce qu'il y avait avant. */
  function setField(field) {
    while (grid.children.length) {
      const child = grid.children.pop();
      child.traverse?.((node) => {
        node.geometry?.dispose?.();
        node.material?.dispose?.();
      });
      grid.remove(child);
    }

    const entries = showcaseEntries(field);
    let treeGeometries = null;
    let treeMaterial = null;
    if (entries.some((e) => e.shape === 'tree')) {
      treeGeometries = createFurnitureGeometries(THREEns);
      treeMaterial = createFurnitureMaterial(THREEns);
    }

    entries.forEach((entry, i) => {
      const col = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      const x = (col - (COLUMNS - 1) / 2) * CELL_M;
      const z = row * CELL_M;

      const cell = new THREEns.Group();
      cell.position.set(x, 0, z);

      if (entry.shape === 'plane') cell.add(buildPlane(THREEns, entry));
      else if (entry.shape === 'block') cell.add(buildBlock(THREEns, entry));
      else if (entry.shape === 'house') cell.add(buildHouse(THREEns, entry));
      else if (entry.shape === 'tree') {
        const geometry = treeGeometries[entry.alignment];
        if (geometry) cell.add(new THREEns.Mesh(geometry, treeMaterial));
      }

      const label = makeLabelSprite(entry.unsupported ? `${entry.value} ⚠` : entry.value);
      label.position.set(0, 2.6, 0);
      cell.add(label);

      grid.add(cell);
    });

    return entries.length;
  }

  function dispose() {
    setField(null); // vide la grille et libère géométries et matériaux
  }

  return { scene, setField, dispose, fields: SHOWCASE_FIELDS };
}
