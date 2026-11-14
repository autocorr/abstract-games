// Goldberg polyhedra and hemi-Goldberg boards. Pure: no DOM.
//
// A Goldberg polyhedron GP(m, n) has 12 pentagons and 10T - 10 hexagons,
// T = m^2 + mn + n^2. It is the dual of a geodesic sphere: each face of an
// icosahedron is covered by a patch of the triangular lattice whose corners
// sit at the lattice points 0, m*e1 + n*e2 and that rotated by 60 degrees.
// The lattice points, pushed out onto the unit sphere, are the cells'
// centres; each cell's corners are the centres of the lattice triangles
// around it.
//
// GP(m, 0) and GP(m, m) are symmetric under the antipodal map, which pairs
// every cell with the opposite one. Keeping one cell of each pair gives a
// hemi-Goldberg board: a tiling of the real projective plane. It is drawn as
// the northern hemisphere seen from above, the rim of the picture glued to
// itself: a cell that crosses the rim touches the cell on the far side, so
// those adjacencies are "twisted" (they pass through the rim once). A loop
// of cells passing through the rim an odd number of times cannot be shrunk
// to a point.

import { makeBoard } from "./graph.js";

const EPS = 1e-9;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => scale(a, 1 / Math.hypot(...a));

// An icosahedron with a vertex at each pole: the upper ring at longitudes
// 0, 72, ... and the lower ring halfway between them.
function icosahedron() {
  const z = 1 / Math.sqrt(5), r = 2 / Math.sqrt(5);
  const ring = (k, lon, h) => [r * Math.cos(lon + (2 * Math.PI * k) / 5), r * Math.sin(lon + (2 * Math.PI * k) / 5), h];
  const verts = [[0, 0, 1], [0, 0, -1]];
  for (let k = 0; k < 5; k++) verts.push(ring(k, 0, z));
  for (let k = 0; k < 5; k++) verts.push(ring(k, Math.PI / 5, -z));
  const up = (k) => 2 + (k % 5), lo = (k) => 7 + (k % 5);
  const faces = [];
  for (let k = 0; k < 5; k++) {
    faces.push([0, up(k), up(k + 1)]);
    faces.push([up(k), lo(k), up(k + 1)]);
    faces.push([up(k + 1), lo(k), lo(k + 1)]);
    faces.push([1, lo(k + 1), lo(k)]);
  }
  return { verts, faces };
}

// The cells of GP(m, n) on the unit sphere: { centres, rings }, where
// rings[i] lists cell i's neighbours in angular order around it.
export function goldbergSphere(m, n) {
  const { verts, faces } = icosahedron();
  // Lattice basis e1 = (1, 0), e2 = (1/2, sqrt3/2); a face's corners are at
  // 0, b and c (b turned by 60 degrees).
  const s3 = Math.sqrt(3) / 2;
  const b = [m + n / 2, n * s3], c = [b[0] / 2 - b[1] * s3, b[0] * s3 + b[1] / 2];
  const det = b[0] * c[1] - b[1] * c[0];
  const span = m + n;
  const centres = [];
  const pentagon = new Set();
  for (const [ia, ib, ic] of faces) {
    const [A, B, C] = [verts[ia], verts[ib], verts[ic]];
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        const x = i + j / 2, y = j * s3;
        // Barycentric coordinates of the lattice point in the face.
        const u = (x * c[1] - y * c[0]) / det, v = (b[0] * y - b[1] * x) / det, w = 1 - u - v;
        if (u < -EPS || v < -EPS || w < -EPS) continue;
        const p = unit(add(add(scale(A, w), scale(B, u)), scale(C, v)));
        // A point on a face's edge or corner is shared with the neighbouring
        // faces: keep the first copy, matched by direction (rounded keys
        // could split it over float noise).
        if (Math.min(u, v, w) < EPS && centres.some((q) => dot(p, q) > 1 - EPS)) continue;
        if (Math.max(u, v, w) > 1 - EPS) pentagon.add(centres.length);
        centres.push(p);
      }
    }
  }
  const expected = 10 * (m * m + m * n + n * n) + 2;
  if (centres.length !== expected) throw new Error(`GP(${m},${n}): ${centres.length} cells, expected ${expected}`);

  // Neighbours: the 5 (pentagons) or 6 nearest centres, in angular order
  // about the centre's outward normal.
  const rings = centres.map((p, i) => {
    const near = centres.map((q, k) => [k, dot(p, q)]).filter(([k]) => k !== i);
    near.sort((x, y) => y[1] - x[1]);
    const ring = near.slice(0, pentagon.has(i) ? 5 : 6).map(([k]) => k);
    const t1 = unit(cross(Math.abs(p[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], p)), t2 = cross(p, t1);
    const angle = (k) => { const d = sub(centres[k], p); return Math.atan2(dot(d, t2), dot(d, t1)); };
    return ring.sort((x, y) => angle(x) - angle(y));
  });
  rings.forEach((ring, i) => {
    for (const k of ring) if (!rings[k].includes(i)) throw new Error(`GP(${m},${n}): asymmetric neighbours`);
  });
  return { centres, rings };
}

// Azimuthal equal-area projection of the sphere about the north pole,
// scaled so the equator has radius 1 (cells keep their areas). Longitude 0,
// where a pentagon of the upper ring lies, points up the screen.
function project([x, y, z]) {
  const r = Math.sqrt(Math.max(0, 1 - z));   // sqrt2 sin(colatitude / 2), over sqrt2
  const h = Math.hypot(x, y);
  return h < EPS ? [0, 0] : [(-r * y) / h, (-r * x) / h];
}

// Points along the great-circle arc from a to b (excluding b), `steps` of them.
function arc(a, b, steps) {
  const out = [];
  for (let t = 0; t < steps; t++) out.push(unit(add(scale(a, 1 - t / steps), scale(b, t / steps))));
  return out;
}

// Does a cell centre belong to the drawn (northern) half? On the equator,
// one of each antipodal pair is chosen with the five-fold symmetry kept:
// longitudes in [0, 36) mod 72.
function northern([x, y, z]) {
  if (Math.abs(z) > 1e-7) return z > 0;
  const lon = ((Math.atan2(y, x) * 180) / Math.PI + 360 + 1e-6) % 72;
  return lon < 36;
}

// A hemi-Goldberg board: one cell of each antipodal pair of GP(m, n) (n = 0
// or n = m), drawn as the northern hemisphere, a pentagon at the centre.
//
// board.twists[id] parallels board.neighbours[id]: 1 where the adjacency
// crosses the rim. Cell tags: pentagon (true for the six pentagons), name
// ("1".."n" spiralling out from the centre: by rings of neighbours, each
// clockwise from the top).
export function hemiGoldbergBoard(m, n, { segments = 4 } = {}) {
  if (n !== 0 && n !== m) throw new Error(`GP(${m},${n}) is not centrally symmetric`);
  const { centres, rings } = goldbergSphere(m, n);
  // Each centre's opposite: the most nearly opposite centre (looked up by
  // direction, not by rounded coordinates, which float noise can split).
  const antipode = centres.map((p) => {
    let best = -1, bestDot = Infinity;
    centres.forEach((q, k) => { const d = dot(p, q); if (d < bestDot) { bestDot = d; best = k; } });
    if (bestDot > -1 + 1e-6) throw new Error(`GP(${m},${n}) is not centrally symmetric`);
    return best;
  });
  const kept = centres.map((p, i) => i).filter((i) => northern(centres[i]));
  if (kept.length * 2 !== centres.length) throw new Error(`GP(${m},${n}): the halves differ`);
  const id = new Map(kept.map((i, k) => [i, k]));

  const cells = kept.map((i) => {
    const p = centres[i], ring = rings[i];
    const corners = ring.map((k, t) => unit(add(add(p, centres[k]), centres[ring[(t + 1) % ring.length]])));
    const poly = corners.flatMap((a, t) => arc(a, corners[(t + 1) % corners.length], segments)).map(project);
    const [x, y] = project(p);
    return { x, y, poly, coord: { sphere: p }, tags: { pentagon: ring.length === 5 } };
  });
  const neighbours = [], twists = [];
  for (const i of kept) {
    const ns = [], ts = [];
    for (const k of rings[i]) {
      const twisted = !id.has(k);
      ns.push(id.get(twisted ? antipode[k] : k));
      ts.push(twisted ? 1 : 0);
    }
    neighbours.push(ns);
    twists.push(ts);
  }

  // Names spiral out from the centre cell (the north pole's pentagon).
  const depth = new Array(cells.length).fill(-1);
  const centre = cells.findIndex((c) => Math.hypot(c.x, c.y) < EPS);
  depth[centre] = 0;
  for (let queue = [centre], h = 0; h < queue.length; h++) {
    for (const k of neighbours[queue[h]]) if (depth[k] < 0) { depth[k] = depth[queue[h]] + 1; queue.push(k); }
  }
  const bearing = (c) => (Math.atan2(c.x, -c.y) + 2 * Math.PI + 1e-9) % (2 * Math.PI);
  const order = cells.map((c, k) => k).sort((a, b) => depth[a] - depth[b] || bearing(cells[a]) - bearing(cells[b]));
  order.forEach((k, r) => { cells[k].tags.name = String(r + 1); });

  const board = makeBoard(cells, { neighbours });
  board.twists = twists;
  return board;
}
