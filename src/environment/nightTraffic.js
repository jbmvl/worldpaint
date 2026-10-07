/*
 * Passages nocturnes : trajectoires sur la sphère, indépendantes du regard et
 * de la date simulée. Une horloge locale suffit ; aucun objet three ni tirage
 * aléatoire par image. Le météore décroît derrière sa tête, le satellite reste
 * ponctuel, l'avion se reconnaît à ses feux. Le thème porte leurs dimensions.
 */
const TAU = Math.PI * 2;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const noise = (slot, salt) => {
  let n = Math.imul(slot + salt * 1013, 1597334677);
  n = Math.imul(n ^ (n >>> 16), 2246822519);
  return (n ^ (n >>> 13)) >>> 0;
};
const roll = (slot, salt) => noise(slot, salt) / 4294967296;

function trajectory(slot, salt, progress, elevation, slope, travel) {
  const yaw = roll(slot, salt) * TAU;
  const c = Math.cos(elevation);
  const origin = [Math.sin(yaw) * c, Math.sin(elevation), Math.cos(yaw) * c];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [-Math.sin(yaw) * Math.sin(elevation), c, -Math.cos(yaw) * Math.sin(elevation)];
  const side = roll(slot, salt + 1) < 0.5 ? -1 : 1;
  const tangent = right.map((v, i) => v * Math.cos(slope) * side + up[i] * Math.sin(slope));
  const angle = (progress - 0.5) * travel;
  const at = (a) => origin.map((v, i) => v * Math.cos(a) + tangent[i] * Math.sin(a));
  return { head: at(angle), at, angle, right };
}

export function sampleNightTraffic(seconds) {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const slot = Math.floor(time / 13);
  const age = time - slot * 13 - mix(2, 9, roll(slot, 2));
  const duration = mix(0.65, 0.95, roll(slot, 3));
  let meteor = null;
  if (roll(slot, 4) > 0.25 && age > 0 && age < duration) {
    const p = age / duration;
    const path = trajectory(slot, 5, p, mix(0.38, 1.15, roll(slot, 7)), -0.4 - roll(slot, 8) * 0.35, 0.28);
    const length = mix(0.065, 0.11, roll(slot, 9)) * smooth(0, 0.12, p);
    meteor = { head: path.head, tail: path.at(path.angle - length), gain: smooth(0, 0.09, p) * (1 - smooth(0.5, 1, p)) };
  }
  const satelliteSlot = Math.floor(time / 95);
  const satelliteAge = time % 95;
  const sp = satelliteAge / 68;
  const satellite = satelliteAge < 68 ? {
    head: trajectory(satelliteSlot, 21, sp, 0.55 + roll(satelliteSlot, 23) * 0.45, 0.12, 1.5).head,
    gain: smooth(0, 0.15, sp) * (1 - smooth(0.78, 1, sp)),
  } : null;
  const planeSlot = Math.floor(time / 145);
  const planeAge = time % 145 - 18;
  const pp = planeAge / 105;
  let plane = null;
  if (planeAge > 0 && planeAge < 105) {
    const path = trajectory(planeSlot, 41, pp, 0.25 + roll(planeSlot, 43) * 0.25, 0.025, 1.7);
    const phase = planeAge % 1.15;
    const flash = (1 - smooth(0.025, 0.065, phase)) + smooth(0.15, 0.17, phase) * (1 - smooth(0.195, 0.235, phase));
    plane = { head: path.head, right: path.right, gain: smooth(0, 0.08, pp) * (1 - smooth(0.9, 1, pp)), flash };
  }
  return { meteor, satellite, plane };
}

export function updateNightTraffic(uniforms, seconds) {
  const { meteor, satellite, plane } = sampleNightTraffic(seconds);
  for (const [name, event] of [['uMeteor', meteor], ['uSatellite', satellite], ['uPlane', plane]]) {
    uniforms[name].value.set(...(event?.head || [0, 1, 0]), event?.gain || 0);
  }
  uniforms.uMeteorTail.value.set(...(meteor?.tail || [0, 1, 0]));
  uniforms.uPlaneRight.value.set(...(plane?.right || [1, 0, 0]));
  uniforms.uPlaneFlash.value = plane?.flash || 0;
}

export const NIGHT_TRAFFIC_GLSL = /* glsl */ `
uniform vec4 uMeteor;
uniform vec3 uMeteorTail;
uniform vec4 uSatellite;
uniform vec4 uPlane;
uniform vec3 uPlaneRight;
uniform float uPlaneFlash;
uniform vec4 uTrafficSize;
uniform vec3 uMeteorColor;
uniform vec3 uSatelliteColor;
uniform vec3 uPlaneWhite;
uniform vec3 uPlaneRed;
uniform vec3 uPlaneGreen;

float trafficPoint(vec3 ray, vec3 at, float radius, float pixel) {
  float d = length(ray - normalize(at));
  float aa = max(radius, pixel);
  return (1.0 - smoothstep(0.0, aa, d)) * min(1.0, radius / pixel);
}

vec3 nightTraffic(vec3 ray, float pixel) {
  vec3 light = vec3(0.0);
  if (uMeteor.w > 0.0) {
    vec3 segment = uMeteor.xyz - uMeteorTail;
    float along = clamp(dot(ray - uMeteorTail, segment) / max(dot(segment, segment), 1e-8), 0.0, 1.0);
    vec3 closest = normalize(uMeteorTail + segment * along);
    float width = uTrafficSize.x * mix(0.18, 1.0, along);
    float streak = trafficPoint(ray, closest, width, pixel) * pow(along, 1.7);
    float head = trafficPoint(ray, uMeteor.xyz, uTrafficSize.x * 1.8, pixel);
    light += uMeteorColor * (streak + head * 0.8) * uMeteor.w;
  }
  if (uSatellite.w > 0.0) {
    light += uSatelliteColor * trafficPoint(ray, uSatellite.xyz, uTrafficSize.y, pixel) * uSatellite.w;
  }
  if (uPlane.w > 0.0) {
    float wings = uTrafficSize.w;
    float white = trafficPoint(ray, uPlane.xyz, uTrafficSize.z, pixel);
    float red = trafficPoint(ray, uPlane.xyz - uPlaneRight * wings, uTrafficSize.z * 0.7, pixel);
    float green = trafficPoint(ray, uPlane.xyz + uPlaneRight * wings, uTrafficSize.z * 0.7, pixel);
    light += (uPlaneWhite * white * (0.16 + uPlaneFlash) + uPlaneRed * red + uPlaneGreen * green) * uPlane.w;
  }
  return light;
}
`;
