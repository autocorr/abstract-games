// Patches of the Cairo pentagonal tiling. Pure: no DOM.
//
// The Cairo tiling is the dual of the snub square tiling: each vertex of the
// snub square tiling is the centre of one pentagon, and the pentagon's corners
// are the centres of the triangles and squares meeting at that vertex. With a
// unit snub-square edge, neighbouring pentagon centres are exactly one unit
// apart.
//
// A patch is described by the list of its pentagon centres (snub-square
// vertices); see games/filament/boards.js for examples.
//
// Tags: tone (pentagon orientation), colour (if given with the centre), and
// name ("1".."n" in reading order, for the move log).

import { makeBoard, rotatePoint, pointKey } from "./graph.js";

const EPS = 1e-3;
const S = (1 + Math.sqrt(3)) / 2;   // spacing of the square-centre lattice

function unitApart(p, q) {
  return Math.abs(Math.hypot(p[0] - q[0], p[1] - q[1]) - 1) < EPS;
}

// All snub-square vertices within `radius` of the origin, in a spatial hash
// with unit buckets so unit-distance neighbours are found in the 3x3 block.
function snubSquareVertices(radius) {
  const v1 = [S * Math.cos(Math.PI / 6), S * Math.sin(Math.PI / 6)];
  const v2 = [S * Math.cos((2 * Math.PI) / 3), S * Math.sin((2 * Math.PI) / 3)];
  const n = Math.ceil(radius / S) + 2;
  const points = new Map();   // rounded key -> [x, y]
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const cx = i * v1[0] + j * v2[0], cy = i * v1[1] + j * v2[1];
      if (Math.hypot(cx, cy) > radius + 2) continue;
      // Squares alternate between two orientations 60 degrees apart.
      const d = (i + j) % 2 === 0 ? 0 : 60;
      for (const corner of [[0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]]) {
        const [dx, dy] = rotatePoint(corner, d);
        const p = [cx + dx, cy + dy];
        const key = pointKey(p);
        if (!points.has(key)) points.set(key, p);
      }
    }
  }
  const buckets = new Map();
  for (const p of points.values()) {
    const bk = Math.floor(p[0]) + "," + Math.floor(p[1]);
    if (!buckets.has(bk)) buckets.set(bk, []);
    buckets.get(bk).push(p);
  }
  const near = (p, test) => {
    const bx = Math.floor(p[0]), by = Math.floor(p[1]);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const q of buckets.get(bx + dx + "," + (by + dy)) || []) {
          if (test(p, q)) out.push(q);
        }
      }
    }
    return out;
  };
  return {
    // Exact lattice vertex for an approximate (e.g. rounded) position.
    snap(p) {
      const hits = near(p, (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS);
      if (hits.length !== 1) throw new Error(`(${p}) is not a snub-square vertex`);
      return hits[0];
    },
    neighbours: (p) => near(p, unitApart),
  };
}

// The pentagon around snub-square vertex `p`, with corners in angular order.
function pentagonAt(p, lattice) {
  const ns = lattice.neighbours(p);
  if (ns.length !== 5) throw new Error(`(${p}) is not a snub-square vertex`);
  ns.sort((a, b) => Math.atan2(a[1] - p[1], a[0] - p[0]) - Math.atan2(b[1] - p[1], b[0] - p[0]));
  const poly = [];
  for (let t = 0; t < 5; t++) {
    const a = ns[t], b = ns[(t + 1) % 5];
    // Consecutive neighbours that are themselves adjacent bound a triangle
    // (corner at its centroid); otherwise they are opposite corners of a
    // square (corner at its centre).
    poly.push(unitApart(a, b)
      ? [(p[0] + a[0] + b[0]) / 3, (p[1] + a[1] + b[1]) / 3]
      : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return poly;
}

// Classify a pentagon by the orientation of its unique short edge. The short
// edges come in two orientations 90 degrees apart, giving a two-colouring
// ("tone" 0 or 1) that is stable under any display rotation.
export function toneOf(poly) {
  let si = 0, best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = poly[(i + 1) % poly.length];
    const d = Math.hypot(poly[i][0] - q[0], poly[i][1] - q[1]);
    if (d < best) { best = d; si = i; }
  }
  const p = poly[si], q = poly[(si + 1) % poly.length];
  let a = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
  a = ((a % 180) + 180) % 180;
  return a >= 45 && a < 135 ? 1 : 0;
}

// Build a Board from pentagon centres.
//
//   centres: [[x, y, tag?], ...]   tag (if given) becomes cell.tags.colour
//   rotate:  display rotation in degrees, applied after construction
//
// Cells get tags { colour, tone } where tone is the two-colouring above.
export function cairoBoard(centres, { rotate = 0, pad } = {}) {
  let radius = 0;
  for (const [x, y] of centres) radius = Math.max(radius, Math.hypot(x, y));
  const lattice = snubSquareVertices(radius);
  const cells = centres.map(([x, y, colour]) => {
    // Centres are given rounded; snap to the exact vertex so that corners
    // shared by neighbouring pentagons coincide exactly.
    const p = lattice.snap([x, y]);
    const poly = pentagonAt(p, lattice).map((v) => rotatePoint(v, rotate));
    const [rx, ry] = rotatePoint(p, rotate);
    const tags = { tone: toneOf(poly) };
    if (colour !== undefined) tags.colour = colour;
    return { x: rx, y: ry, poly, tags };
  });
  // Names for the move log: numbers in reading order of the drawn board
  // (top to bottom, then left to right).
  const key = (v) => Math.round(v * 1e3);
  const order = cells.map((c, i) => i).sort((a, b) => key(cells[a].y) - key(cells[b].y) || cells[a].x - cells[b].x);
  order.forEach((i, k) => { cells[i].tags.name = String(k + 1); });
  return makeBoard(cells, { pad });
}
