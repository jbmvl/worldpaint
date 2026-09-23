/* Appui sur les triangles réellement chargés, coutures et déblais compris.
 * La diagonale b–c est celle de TerrainBubble : interpoler les quatre sommets
 * bilinéairement place les racines dans une autre surface que le maillage.
 */
export function meshSupport(geometry, segments, originX, originZ, size, x, z, out = {}) {
  const p = geometry?.attributes?.position?.array;
  if (!p || !segments) return null;
  const step = size / segments;
  const u = Math.max(0, Math.min(segments - 1e-8, (x-originX)/step));
  const v = Math.max(0, Math.min(segments - 1e-8, (z-originZ)/step));
  const i = Math.floor(u), j = Math.floor(v), fx = u-i, fz = v-j;
  const a = j*(segments+1)+i, b = a+1, c = a+segments+1, d = c+1;
  const ya=p[a*3+1], yb=p[b*3+1], yc=p[c*3+1], yd=p[d*3+1];
  if (fx+fz<=1) {
    out.y=ya+(yb-ya)*fx+(yc-ya)*fz;
    out.slopeX=(yb-ya)/step; out.slopeZ=(yc-ya)/step;
  } else {
    out.y=yd+(yc-yd)*(1-fx)+(yb-yd)*(1-fz);
    out.slopeX=(yd-yc)/step; out.slopeZ=(yd-yb)/step;
  }
  return out;
}
