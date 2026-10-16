/*
 * Retire la marge de duplication des tuiles avant la construction du décor.
 * Le découpage garde les portions de chaque côté, jamais une seule copie
 * choisie par identifiant : une entité peut traverser plusieurs tuiles.
 */

function segment(a, b, bounds) {
  let start = 0, end = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - bounds.west], [dx, bounds.east - a[0]],
    [-dy, a[1] - bounds.south], [dy, bounds.north - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) start = Math.max(start, t);
    else end = Math.min(end, t);
    if (start >= end) return null;
  }
  return [start === 0 ? a : [a[0] + start * dx, a[1] + start * dy],
    end === 1 ? b : [a[0] + end * dx, a[1] + end * dy]];
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1];

function linesIn(lines, bounds) {
  const result = [];
  for (const line of lines) {
    let run = null;
    for (let i = 1; i < line.length; i++) {
      const part = segment(line[i - 1], line[i], bounds);
      if (!part || same(part[0], part[1])) { run = null; continue; }
      // Une ligne exactement sur une couture appartient au côté ouest/nord.
      if (part.every(p => p[0] === bounds.west) || part.every(p => p[1] === bounds.north)) {
        run = null; continue;
      }
      if (run && same(run[run.length - 1], part[0])) run.push(part[1]);
      else { run = part; result.push(run); }
    }
  }
  return result;
}

function ringIn(ring, bounds) {
  let points = ring.slice(0, -1);
  for (const [axis, value, sign] of [[0, bounds.west, 1], [0, bounds.east, -1],
    [1, bounds.south, 1], [1, bounds.north, -1]]) {
    const output = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length], b = points[i];
      const insideA = sign * (a[axis] - value) >= 0;
      const insideB = sign * (b[axis] - value) >= 0;
      if (insideA !== insideB) {
        const t = (value - a[axis]) / (b[axis] - a[axis]);
        const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        p[axis] = value;
        output.push(p);
      }
      if (insideB) output.push(b);
    }
    points = output.filter((p, i) => !i || !same(p, output[i - 1]));
  }
  if (points.length > 1 && same(points[0], points.at(-1))) points.pop();
  if (points.length < 3) return null;
  const area = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + (p[0] - points[0][0]) * (q[1] - points[0][1])
      - (q[0] - points[0][0]) * (p[1] - points[0][1]);
  }, 0);
  return area === 0 ? null : [...points, points[0]];
}

function polygonIn(rings, bounds) {
  const outer = ringIn(rings[0], bounds);
  return outer ? [outer, ...rings.slice(1).map(ring => ringIn(ring, bounds)).filter(Boolean)] : null;
}

export function geometryInTile(geometry, bounds) {
  const { type, coordinates } = geometry;
  if (type === 'LineString' || type === 'MultiLineString') {
    const lines = linesIn(type === 'LineString' ? [coordinates] : coordinates, bounds);
    return lines.length ? { type: 'MultiLineString', coordinates: lines } : null;
  }
  if (type === 'Polygon' || type === 'MultiPolygon') {
    const polygons = (type === 'Polygon' ? [coordinates] : coordinates)
      .map(rings => polygonIn(rings, bounds)).filter(Boolean);
    return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null;
  }
  return geometry;
}
