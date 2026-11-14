// Boards as graphs of polygonal cells. Pure: no DOM.
//
// Every tiling (square, hex, Cairo, ...) is reduced to the same structure so
// that one renderer, one input handler and one set of graph helpers serve all
// games. See ARCHITECTURE.md for the Board shape.

const KEY_SCALE = 1e4;

// A coordinate rounded to 4 decimals, for viewBoxes and SVG attributes.
export const round4 = (v) => +v.toFixed(4);

// Key of a point rounded to 1e-4, so float noise in shared vertices
// coincides; adding 0 turns the -0 produced by rounding tiny negatives
// into +0.
export function pointKey([x, y]) {
  const r = (v) => Math.round(v * KEY_SCALE) / KEY_SCALE + 0;
  return r(x) + "," + r(y);
}

// Key of the undirected edge a-b (the same either way round).
export function edgeKey(a, b) {
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
  const viewBox = [minX - p, minY - p, maxX - minX + 2 * p, maxY - minY + 2 * p].map(round4).join(" ");

  return { cells, neighbours: nbrs, size: cells.length, unit, bounds: { minX, minY, maxX, maxY }, pad: p, viewBox };
}

// Widen a board's viewBox to take in `points` drawn outside the cells (e.g. a
// frame), keeping the same margin; rotatedViewBox includes them too.
export function extendView(board, points) {
  board.extent = points;
  let { minX, minY, maxX, maxY } = board.bounds;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const p = board.pad;
  board.viewBox = [minX - p, minY - p, maxX - minX + 2 * p, maxY - minY + 2 * p].map(round4).join(" ");
  return board;
}

// Does the cells' area fill the board's bounding box (a square grid)?
export function fillsRectangle(board) {
  const { minX, minY, maxX, maxY } = board.bounds;
  let area = 0;
  for (const { poly } of board.cells) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      area += x1 * y2 - x2 * y1;
    }
  }
  return Math.abs(area) / 2 >= 0.98 * (maxX - minX) * (maxY - minY);
}

// Distance from a cell's centre to the nearest point of its outline: the
// radius of the largest circle about the centre that fits in the cell.
export function inradius({ x, y, poly }) {
  let best = Infinity;
  poly.forEach(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  });
  return best;
}

// "a1"-style cell name for grid generators: file letter from `col`, rank
// number from `row` (both from 0).
export function gridName(col, row) {
  return "abcdefghijklmnopqrstuvwxyz"[col] + (row + 1);
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

// ---- connection games ------------------------------------------------------
//
// Players who connect sides of the board (two opposite sides in Hex and its
// relatives, all three in Y) list them as `sides: [a, b, ...]`, names from
// the cells' `edges` tags.

// Per player, a mask over cell ids: bit i set for cells on the player's i-th
// side. players: { [p]: { sides: [a, b, ...] } }.
export function goalMasks(board, players) {
  const out = {};
  for (const [p, { sides }] of Object.entries(players)) {
    out[p] = Uint8Array.from(board.cells, (c) => sides.reduce((m, side, i) => m | (c.tags.edges.includes(side) ? 1 << i : 0), 0));
  }
  return out;
}

// Does the group of cells[id]'s owner containing `id` touch every one of the
// `sides` sides of `mask` (one of goalMasks)? Stops as soon as it does.
export function connectsSides(board, cells, id, mask, sides = 2) {
  const player = cells[id];
  const all = (1 << sides) - 1;
  const seen = new Uint8Array(board.size);
  const stack = [id];
  seen[id] = 1;
  let touched = 0;
  while (stack.length) {
    const cur = stack.pop();
    touched |= mask[cur];
    if (touched === all) return true;
    for (const n of board.neighbours[cur]) {
      if (!seen[n] && cells[n] === player) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return false;
}

// ---- coordinates and directions -----------------------------------------
//
// Grid generators (square.js, hex.js) give each cell an integer `coord` and
// attach to the board:
//
//   board.dirs:      [[dx, dy], ...] steps in coordinate space
//   board.at(...c):  cell id at a coordinate, or -1 off the board
//   board.step(id, d): neighbour of `id` one step in direction index `d`, or -1
//
// The helpers below work on any board that has them.

// Attach `at`, `step` and `dirs` to a board whose cells have coords that
// `coordKey(coord)` turns into a unique string; `coordStep(coord, dir)` is
// the coord one step in direction `dir`.
export function attachGrid(board, dirs, coordKey, coordStep) {
  const index = new Map(board.cells.map((c) => [coordKey(c.coord), c.id]));
  board.dirs = dirs;
  board.at = (...coord) => index.get(coordKey(coord.length === 1 ? coord[0] : coord)) ?? -1;
  board.step = (id, d) => index.get(coordKey(coordStep(board.cells[id].coord, dirs[d]))) ?? -1;
  return board;
}

// Cells from `id` (exclusive) stepping in direction `d` until the edge, or
// while `include(id)` holds when given.
export function ray(board, id, d, include = null) {
  const out = [];
  for (let n = board.step(id, d); n >= 0 && (!include || include(n)); n = board.step(n, d)) out.push(n);
  return out;
}

// Length of the line through `id` along direction `d` and its opposite `od`
// made of cells for which `include` holds (counting `id` itself).
export function lineLength(board, id, d, od, include) {
  return 1 + ray(board, id, d, include).length + ray(board, id, od, include).length;
}

// The connected group containing `id` (cells with include() true), or [].
export function groupAt(board, id, include) {
  if (!include(id)) return [];
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of board.neighbours[cur]) {
      if (!seen.has(n) && include(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return [...seen];
}

// Empty neighbours of a group (`isEmpty(id)`), as a sorted array of ids.
export function liberties(board, group, isEmpty) {
  const libs = new Set();
  for (const id of group) for (const n of board.neighbours[id]) if (isEmpty(n)) libs.add(n);
  return [...libs].sort((a, b) => a - b);
}

// Index of the direction opposite `d` (directions come in opposite pairs half
// the list apart).
export function opposite(board, d) {
  return (d + board.dirs.length / 2) % board.dirs.length;
}
