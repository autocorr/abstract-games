// Boards as graphs of polygonal cells. Pure: no DOM.
//
// Every tiling (square, hex, Cairo, ...) is reduced to the same structure so
// that one renderer, one input handler and one set of graph helpers serve all
// games. See ARCHITECTURE.md for the Board shape.

const KEY_DIGITS = 4;

function pointKey([x, y]) {
  // Normalise -0 so that "-0.0000" and "0.0000" coincide.
  return (x + 0).toFixed(KEY_DIGITS) + "," + (y + 0).toFixed(KEY_DIGITS);
}

function edgeKey(a, b) {
  const ka = pointKey(a), kb = pointKey(b);
  return ka < kb ? ka + "|" + kb : kb + "|" + ka;
}

// Cells are neighbours iff their polygons share an edge (both endpoints
// coincide). Cells meeting only at a corner are not neighbours.
export function edgeAdjacency(cells) {
  const byEdge = new Map();
  cells.forEach((cell, i) => {
    const poly = cell.poly;
    for (let k = 0; k < poly.length; k++) {
      const key = edgeKey(poly[k], poly[(k + 1) % poly.length]);
      if (!byEdge.has(key)) byEdge.set(key, []);
      byEdge.get(key).push(i);
    }
  });
  const sets = cells.map(() => new Set());
  for (const owners of byEdge.values()) {
    for (const a of owners) for (const b of owners) if (a !== b) sets[a].add(b);
  }
  return sets.map((s) => [...s].sort((a, b) => a - b));
}

// Rotate a point about the origin by `deg` degrees.
export function rotatePoint([x, y], deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

// Assemble a Board from cell descriptions.
//
//   cells:      [{ x, y, poly, coord?, tags? }]; ids are assigned by index
//   neighbours: optional explicit adjacency (array of id arrays); defaults to
//               shared-edge adjacency
//   pad:        viewBox margin, in multiples of the neighbour distance
export function makeBoard(cellSpecs, { neighbours, pad = 0.15 } = {}) {
  const cells = cellSpecs.map((c, id) => ({
    id,
    x: c.x,
    y: c.y,
    poly: c.poly,
    coord: c.coord ?? null,
    tags: c.tags ?? {},
  }));
  const nbrs = neighbours ? neighbours.map((ns) => ns.slice()) : edgeAdjacency(cells);

  let unit = Infinity;
  for (const c of cells) {
    for (const n of nbrs[c.id]) {
      const d = Math.hypot(c.x - cells[n].x, c.y - cells[n].y);
      if (d > 1e-9 && d < unit) unit = d;
    }
  }
  if (!Number.isFinite(unit)) unit = 1;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    for (const [x, y] of c.poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const p = pad * unit;
  const f = (v) => +v.toFixed(4);
  const viewBox = [minX - p, minY - p, maxX - minX + 2 * p, maxY - minY + 2 * p].map(f).join(" ");

  return { cells, neighbours: nbrs, size: cells.length, unit, bounds: { minX, minY, maxX, maxY }, viewBox };
}

// Connected components of the cells for which `include(id)` is true, each as
// an array of ids. Typical use: groups of one player's stones.
export function components(board, include) {
  const seen = new Uint8Array(board.size);
  const out = [];
  for (let start = 0; start < board.size; start++) {
    if (seen[start] || !include(start)) continue;
    const group = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const id = stack.pop();
      group.push(id);
      for (const n of board.neighbours[id]) {
        if (!seen[n] && include(n)) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    out.push(group);
  }
  return out;
}

// Check structural invariants; returns a list of problems (empty if sound).
export function validateBoard(board) {
  const problems = [];
  const { cells, neighbours } = board;
  if (neighbours.length !== cells.length) problems.push("neighbours length differs from cells");
  cells.forEach((c, i) => {
    if (c.id !== i) problems.push(`cell ${i} has id ${c.id}`);
    if (!Array.isArray(c.poly) || c.poly.length < 3) problems.push(`cell ${i} polygon has < 3 vertices`);
    for (const n of neighbours[i] || []) {
      if (n === i) problems.push(`cell ${i} is its own neighbour`);
      if (!neighbours[n] || !neighbours[n].includes(i)) problems.push(`adjacency ${i}->${n} is not symmetric`);
    }
  });
  return problems;
}
