/*
 * Antenne relais : trois montants reliés par des croix sur chaque face,
 * une galerie et des équipements portés par le treillis. Les barres joignent
 * leurs extrémités dans l'espace ; leur pied ne sert jamais de centre de rotation.
 * Le thème porte le gabarit, la pointe porte la balise de `obstacleLights`.
 */
import { Kit } from './kit.js';
import { defaultTheme } from '../themes/default.js';

export function radioMast(C = defaultTheme.furniture.colors, look = defaultTheme.furniture) {
  const forme = look.radioMast ?? defaultTheme.furniture.radioMast;
  const feu = look.obstacleLight ?? defaultTheme.furniture.obstacleLight;
  const k = new Kit(C);
  const rayon = (t) => forme.footRadiusM + (forme.headRadiusM - forme.footRadiusM) * t;
  const point = (i, t) => {
    const a = i * Math.PI * 2 / 3;
    return [Math.cos(a) * rayon(t), forme.heightM * t, Math.sin(a) * rayon(t)];
  };
  const barre = (a, b, largeur, color) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    k.box({ width: largeur, depth: largeur, height: Math.hypot(dx, dy, dz),
      x: a[0], y: a[1], z: a[2], tilt: Math.atan2(Math.hypot(dx, dz), dy), yaw: Math.atan2(dx, dz), color });
  };
  for (let i = 0; i < 3; i++) {
    const p = point(i, 0);
    k.box({ width: forme.footingM, depth: forme.footingM, height: forme.footingHeightM,
      x: p[0], z: p[2], color: C.concrete });
  }
  for (let s = 0; s < forme.stages; s++) {
    const t0 = s / forme.stages, t1 = (s + 1) / forme.stages;
    for (let i = 0; i < 3; i++) {
      const a = point(i, t0), b = point(i, t1);
      const c = point((i + 1) % 3, t0), d = point((i + 1) % 3, t1);
      barre(a, b, forme.legM, C.galvanised);
      barre(b, d, forme.braceM, C.steelDark);
      barre(a, d, forme.braceM, C.galvanised);
      barre(c, b, forme.braceM, C.galvanised);
      if (s === 0) barre(a, c, forme.braceM, C.steelDark);
    }
  }
  const galerieY = forme.heightM * forme.platformAt;
  const r = forme.platformRadiusM;
  k.cylinder({ radiusBottom: r, radiusTop: r, height: forme.platformThicknessM,
    radial: 6, y: galerieY, color: C.steelDark });
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3, b = (i + 1) * Math.PI / 3;
    const p = [Math.cos(a) * r, galerieY, Math.sin(a) * r];
    const haut = [p[0], galerieY + forme.railHeightM, p[2]];
    barre(p, haut, forme.braceM, C.galvanised);
    barre(haut, [Math.cos(b) * r, haut[1], Math.sin(b) * r], forme.braceM, C.galvanised);
  }
  for (let i = 0; i < 3; i++) {
    const p = point(i, forme.panelAt);
    k.box({ width: forme.panelWidthM, depth: forme.panelDepthM, height: forme.panelHeightM,
      x: p[0], y: p[1], z: p[2], yaw: i * Math.PI * 2 / 3, color: C.white });
  }
  for (const parabole of forme.dishes) {
    const y = parabole.at * forme.heightM, r = rayon(parabole.at);
    const direction = [Math.sin(parabole.yaw), Math.cos(parabole.yaw)];
    const bout = [(r + parabole.radiusM) * direction[0], y, (r + parabole.radiusM) * direction[1]];
    barre([r * direction[0], y, r * direction[1]], bout, forme.legM, C.steelDark);
    k.cylinder({ radiusBottom: parabole.radiusM, radiusTop: parabole.radiusM, height: forme.panelDepthM,
      radial: 10, x: bout[0], y, z: bout[2], yaw: parabole.yaw, tilt: Math.PI / 2,
      color: C.white, colorTop: C.slate });
  }
  k.cylinder({ radiusBottom: forme.spireRadiusM, radiusTop: forme.spireRadiusM / 2,
    height: forme.spireM, radial: 6, y: forme.heightM, color: C.galvanised });
  k.box({ width: feu.lensM, height: feu.lensM, depth: feu.lensM,
    y: forme.heightM + forme.spireM, color: C.signRed });
  return k;
}
