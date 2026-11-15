/*
 * Mise en lumière nocturne des repères bâtis (église, château, mosquée,
 * muraille, ruine) : des projecteurs encastrés au pied des façades, dont la
 * lumière monte et s'évase. Aucune géométrie ni lampe de scène : le matériau
 * du bâti s'émet lui-même dans la boîte orientée des repères les plus proches,
 * dont le nombre est borné (`FLOODLIT_MAX`). De jour, le compte est nul.
 *
 * Les sommets d'un repère éclairé (murs, tours, clocher, colonnes de ruine)
 * portent dans les cinq bits faibles du bleu le rang de sa boîte, à partir
 * de 1 ; tous les autres portent 0 (`markFloodlit`). L'écart de couleur,
 * 31/65535 au plus, ne se voit pas et ne coûte aucun octet ; une maison
 * collée à l'église reste dans l'ombre, et un fragment ne lit que sa boîte :
 * le coût ne croît pas avec le nombre de repères. Les pans quasi horizontaux
 * (toits) restent sombres, comme sous un vrai éclairage rasant.
 */
import { defaultTheme } from '../themes/default.js';

export const FLOODLIT_KINDS = new Set(['castle', 'church', 'mosque', 'rampart', 'ruin']);
const SLOT_BITS = 5;
export const FLOODLIT_MAX = (1 << SLOT_BITS) - 1;

export function createFloodlights(THREE, look = defaultTheme.floodlight) {
  return {
    look,
    night: 0,
    lit: 0,
    box: { value: Array.from({ length: FLOODLIT_MAX }, () => new THREE.Vector4()) },
    size: { value: Array.from({ length: FLOODLIT_MAX }, () => new THREE.Vector4()) },
    count: { value: 0 },
    color: { value: new THREE.Vector4(...look.color, 0) },
    shape: { value: new THREE.Vector3(look.spacingM, look.riseShare, look.marginM) },
  };
}

/**
 * Retient les repères éclairés les plus proches de l'observateur.
 * @param {Array<{x:number, y:number, z:number, top:number, size:number, short?:number, angle?:number, kind:string}>} landmarks
 * @returns {Map<Object, number>} repère → rang de sa boîte, à partir de 1.
 */
export function aimFloodlights(floodlights, landmarks, here) {
  const chosen = (landmarks ?? [])
    .filter((l) => FLOODLIT_KINDS.has(l.kind) && Number.isFinite(l.angle) && l.size > 0)
    .map((l) => ({ l, d: Math.hypot(l.x - here.x, l.z - here.z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, FLOODLIT_MAX);
  chosen.forEach(({ l }, i) => {
    floodlights.box.value[i].set(l.x, l.z, Math.cos(l.angle), Math.sin(l.angle));
    floodlights.size.value[i].set(l.size, l.short ?? l.size, l.y, l.top);
  });
  floodlights.lit = chosen.length;
  setFloodlightNight(floodlights, floodlights.night);
  return new Map(chosen.map(({ l }, i) => [l, i + 1]));
}

export function setFloodlightNight(floodlights, mix) {
  const night = Math.min(1, Math.max(0, Number(mix) || 0));
  floodlights.night = night;
  const on = night > floodlights.look.fromNight ? (night - floodlights.look.fromNight) / (1 - floodlights.look.fromNight) : 0;
  floodlights.color.value.w = floodlights.look.intensity * on * on * (3 - 2 * on);
  floodlights.count.value = on > 0 ? floodlights.lit : 0;
}

/**
 * Écrit le rang de boîte dans le bleu des couleurs (seize bits, trois par
 * sommet). `ranges` : triplets [début, fin[, rang], croissants, en indices de
 * valeurs ; hors de ces bornes, le rang est 0.
 */
export function markFloodlit(colors, length, ranges) {
  const mask = FLOODLIT_MAX;
  let r = 0;
  for (let i = 2; i < length; i += 3) {
    while (r < ranges.length && i >= ranges[r + 1]) r += 3;
    const slot = r < ranges.length && i >= ranges[r] ? ranges[r + 2] : 0;
    colors[i] = (colors[i] & ~mask) | slot;
  }
}

export function installFloodlight(material, floodlights) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    previous?.(shader);
    shader.uniforms.uFloodBox = floodlights.box;
    shader.uniforms.uFloodSize = floodlights.size;
    shader.uniforms.uFloodCount = floodlights.count;
    shader.uniforms.uFloodColor = floodlights.color;
    shader.uniforms.uFloodShape = floodlights.shape;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vFloodPoint;
      varying vec3 vFloodNormal;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      vFloodPoint = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vFloodNormal = mat3(modelMatrix) * objectNormal;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      #define FLOODLIT_MAX ${FLOODLIT_MAX}
      uniform vec4 uFloodBox[FLOODLIT_MAX];
      uniform vec4 uFloodSize[FLOODLIT_MAX];
      uniform int uFloodCount;
      uniform vec4 uFloodColor;
      uniform vec3 uFloodShape;
      varying vec3 vFloodPoint;
      varying vec3 vFloodNormal;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #ifdef USE_COLOR
      int floodSlot = int(mod(floor(vColor.b * 65535.0 + 0.5), ${FLOODLIT_MAX + 1}.0)) - 1;
      if (floodSlot >= 0 && floodSlot < uFloodCount) {
        vec4 b = uFloodBox[floodSlot];
        vec4 s = uFloodSize[floodSlot];
        vec2 d = vFloodPoint.xz - b.xy;
        float u = d.x * b.z + d.y * b.w;
        float v = -d.x * b.w + d.y * b.z;
        if (abs(u) <= s.x + uFloodShape.z && abs(v) <= s.y + uFloodShape.z) {
          vec3 floodN = normalize(vFloodNormal);
          float floodSide = 1.0 - abs(floodN.y);
          floodSide *= floodSide;
          float h = max(vFloodPoint.y - s.z, 0.0);
          float rise = exp(-h / (uFloodShape.y * max(s.w - s.z, 4.0) + 2.0));
          // Le long du pan : un projecteur tous les \`spacingM\`, dont le cône s'ouvre en montant.
          float alongLong = abs(floodN.x * b.z + floodN.z * b.w);
          float alongShort = abs(-floodN.x * b.w + floodN.z * b.z);
          float along = alongLong > alongShort ? v : u;
          float cell = (fract(along / uFloodShape.x + 0.5) - 0.5) * uFloodShape.x;
          float spread = 0.35 + 0.35 * h;
          float cone = exp(-cell * cell / (spread * spread));
          float flood = rise * mix(0.3, 1.0, cone);
          float diode = (1.0 - smoothstep(0.12, 0.3, h)) * (1.0 - smoothstep(0.08, 0.16, abs(cell)));
          totalEmissiveRadiance += uFloodColor.rgb * uFloodColor.w * (diffuseColor.rgb * flood + diode) * floodSide;
        }
      }
      #endif`);
  };
}
