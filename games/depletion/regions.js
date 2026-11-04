// Ways of dividing a Hex rhombus into k contiguous regions of near-equal size.
// Pure: no DOM.
//
// Every layout returns an array mapping cell id -> region index (0..k-1).
// Most layouts sweep the cells in the order of a key (position across or
// along the long diagonal, rhombus rings, angle about the centre), filling
// one region at a time through adjacent cells. "patches" grows blobs from
// seeds instead. A final pass evens out the sizes, so regions are contiguous
// and differ in size by at most a cell or two.

export const LAYOUTS = [
  { value: "bands", label: "Diagonal bands" },
  { value: "stripes", label: "Long stripes" },
  { value: "nested", label: "Nested rhombi" },
  { value: "pinwheel", label: "Pinwheel" },
  { value: "patches", label: "Patches" },
];

// Geometry is computed from axial coords, so layouts do not depend on how the
// board is rotated for display: x along a row, y down the rows.
const SQRT3 = Math.sqrt(3);
const pos = ({ coord: { q, r } }) => [SQRT3 * (q + r / 2), 1.5 * r];

// Angle of (dx, dy) measured from the board's long diagonal (the line through
// the two acute corners, at 30 degrees in these coordinates), in [0, 2pi).
function angleFromDiagonal(dx, dy) {
  const a = Math.atan2(dy, dx) - Math.PI / 6;
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

function centre(board) {
  let x = 0, y = 0;
  for (const c of board.cells) { const [px, py] = pos(c); x += px; y += py; }
  return [x / board.size, y / board.size];
}

const dist = (a, b) => { const [ax, ay] = pos(a), [bx, by] = pos(b); return Math.hypot(ax - bx, ay - by); };

// Target sizes for k regions, spreading the larger ones evenly.
function targetSizes(total, k) {
  const base = Math.floor(total / k), extra = total % k;
  return Array.from({ length: k }, (_, r) => base + Math.floor(((r + 1) * extra) / k) - Math.floor((r * extra) / k));
}

const compareKeys = (a, b) => {
  for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
  return a.id - b.id;
};

// Sweep the cells in key order (arrays compared element by element), filling
// one region at a time. Each region starts at the lowest unassigned key and
// only takes cells adjacent to it, so regions are contiguous even where a
// key's level sets are not.
function sweep(board, k, keyOf) {
  const keys = board.cells.map((c) => ({ id: c.id, key: keyOf(c) }));
  const order = keys.slice().sort(compareKeys);
  const region = new Array(board.size).fill(-1);
  const sizes = targetSizes(board.size, k);
  for (let r = 0; r < k; r++) {
    const start = order.find((e) => region[e.id] < 0);
    if (!start) break;
    const frontier = new Set([start.id]);
    for (let taken = 0; taken < sizes[r] && frontier.size; taken++) {
      let best = null;
      for (const id of frontier) if (!best || compareKeys(keys[id], best) < 0) best = keys[id];
      frontier.delete(best.id);
      region[best.id] = r;
      for (const n of board.neighbours[best.id]) if (region[n] < 0) frontier.add(n);
    }
  }
  // Cells cut off from the sweep join a neighbouring region.
  for (let changed = true; changed;) {
    changed = false;
    for (const c of board.cells) {
      if (region[c.id] >= 0) continue;
      const n = board.neighbours[c.id].find((m) => region[m] >= 0);
      if (n !== undefined) { region[c.id] = region[n]; changed = true; }
    }
  }
  return region;
}

// Is the region still connected without `skip`?
function connectedWithout(board, region, r, skip) {
  let start = -1, count = 0;
  for (let id = 0; id < board.size; id++) {
    if (region[id] === r && id !== skip) { count++; if (start < 0) start = id; }
  }
  if (count === 0) return false;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    for (const n of board.neighbours[stack.pop()]) {
      if (n !== skip && region[n] === r && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return seen.size === count;
}

// Even out region sizes by moving boundary cells from a region to a
// neighbouring one at least two cells smaller, never disconnecting the
// donor. Prefers the largest imbalance, then the cell with the most
// neighbours in the receiving region (keeps shapes compact).
function rebalance(board, region, k) {
  const sizes = new Array(k).fill(0);
  for (const r of region) sizes[r]++;
  for (let guard = 0; guard < 4 * board.size; guard++) {
    const moves = [];
    for (const c of board.cells) {
      const from = region[c.id];
      const counts = new Map();
      for (const n of board.neighbours[c.id]) {
        const to = region[n];
        if (to !== from) counts.set(to, (counts.get(to) || 0) + 1);
      }
      for (const [to, touching] of counts) {
        const gap = sizes[from] - sizes[to];
        if (gap >= 2) moves.push({ id: c.id, from, to, gap, touching });
      }
    }
    moves.sort((a, b) => b.gap - a.gap || b.touching - a.touching || a.id - b.id);
    const move = moves.find((m) => connectedWithout(board, region, m.from, m.id));
    if (!move) break;
    region[move.id] = move.to;
    sizes[move.from]--;
    sizes[move.to]++;
  }
  return region;
}

// Grow k regions from seeds, always extending the smallest region that can
// still grow, with the unassigned neighbour nearest its seed.
function grow(board, seeds) {
  const k = seeds.length;
  const region = new Array(board.size).fill(-1);
  const sizes = new Array(k).fill(0);
  const frontier = seeds.map(() => new Set());
  const assign = (id, r) => {
    region[id] = r;
    sizes[r]++;
    for (const n of board.neighbours[id]) if (region[n] < 0) frontier[r].add(n);
  };
  seeds.forEach((id, r) => assign(id, r));
  for (let left = board.size - k; left > 0; left--) {
    let best = null;
    for (let r = 0; r < k; r++) {
      for (const id of frontier[r]) if (region[id] >= 0) frontier[r].delete(id);
      if (!frontier[r].size) continue;
      if (best === null || sizes[r] < sizes[best]) best = r;
    }
    const s = board.cells[seeds[best]];
    let pick = -1, pickD = Infinity;
    for (const id of frontier[best]) {
      const d = dist(board.cells[id], s);
      if (d < pickD - 1e-9 || (Math.abs(d - pickD) <= 1e-9 && id < pick)) { pick = id; pickD = d; }
    }
    assign(pick, best);
  }
  return region;
}

// The cell nearest to a point.
function nearestCell(board, x, y, exclude = new Set()) {
  let best = -1, bestD = Infinity;
  for (const c of board.cells) {
    if (exclude.has(c.id)) continue;
    const [cx, cy] = pos(c);
    const d = Math.hypot(cx - x, cy - y);
    if (d < bestD - 1e-9) { best = c.id; bestD = d; }
  }
  return best;
}

// Blobs: seeds at the centre and evenly around it, relaxed by a few rounds of
// moving each seed to its region's centroid (Lloyd's algorithm).
function patches(board, k) {
  const [cx, cy] = centre(board);
  let radius = 0;
  for (const c of board.cells) { const [x, y] = pos(c); radius = Math.max(radius, Math.hypot(x - cx, y - cy)); }
  const used = new Set();
  const seeds = [];
  const around = k - 1;
  seeds.push(nearestCell(board, cx, cy));
  used.add(seeds[0]);
  for (let i = 0; i < around; i++) {
    const a = Math.PI / 6 + (2 * Math.PI * i) / around;
    const id = nearestCell(board, cx + 0.55 * radius * Math.cos(a), cy + 0.55 * radius * Math.sin(a), used);
    seeds.push(id);
    used.add(id);
  }
  let region = grow(board, seeds);
  for (let round = 0; round < 4; round++) {
    const sum = seeds.map(() => [0, 0, 0]);
    for (const c of board.cells) {
      const s = sum[region[c.id]];
      const [x, y] = pos(c);
      s[0] += x; s[1] += y; s[2]++;
    }
    const taken = new Set();
    for (let r = 0; r < k; r++) {
      const [x, y, n] = sum[r];
      seeds[r] = nearestCell(board, x / n, y / n, taken);
      taken.add(seeds[r]);
    }
    region = grow(board, seeds);
  }
  return region;
}

// Region index for every cell of an n x n rhombus board (see hex.js).
export function makeRegions(board, k, layout) {
  const n = board.n;
  const [cx, cy] = centre(board);
  const angle = (c) => { const [x, y] = pos(c); return angleFromDiagonal(x - cx, y - cy); };
  const radius = (c) => { const [x, y] = pos(c); return Math.hypot(x - cx, y - cy); };
  let region;
  switch (layout) {
    case "bands":       // stripes crossing the long diagonal
      region = sweep(board, k, ({ coord: { q, r } }) => [q + r, q]);
      break;
    case "stripes":     // stripes along the long diagonal
      region = sweep(board, k, ({ coord: { q, r } }) => [q - r, q + r]);
      break;
    case "nested":      // concentric rhombus rings, cut around by angle
      region = sweep(board, k, (c) => [
        Math.max(Math.abs(2 * c.coord.q - (n - 1)), Math.abs(2 * c.coord.r - (n - 1))), angle(c)]);
      break;
    case "pinwheel":    // wedges around the centre
      region = sweep(board, k, (c) => [angle(c), radius(c)]);
      break;
    case "patches":
      region = patches(board, k);
      break;
    default:
      throw new Error(`unknown layout ${layout}`);
  }
  return rebalance(board, region, k);
}
