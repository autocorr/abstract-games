// Hexagonal grids: rhombus boards (as in Hex) and hex-hex boards (a hexagon
// of hexagons). Cells are pointy-topped. Pure: no DOM.
//
// Cells have axial coord { q, r }; r grows downwards and q to the right.
// Tags:
//   tri:   0-2, the regular 3-colouring in which no two neighbours match
//   edges: the board sides the cell lies on (corners lie on two)
//          rhombus: "N" (r = 0), "S" (r = n-1), "W" (q = 0), "E" (q = n-1)
//          hex-hex: side index d (0-5) between directions d and d+1
//   name:  "a1"-style: column letter from q, row number from r (top row 1)
//
// The board also gets dirs/at/step (see graph.js). dirs are the 6 neighbour
// steps going round from east, so opposite(board, d) = (d + 3) % 6:
//   0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE

import { makeBoard, attachGrid, rotatePoint } from "./graph.js";

export const DIRS6 = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

const SQRT3 = Math.sqrt(3);
const FILES = "abcdefghijklmnopqrstuvwxyz";

function hexCell(q, r, tags) {
  const x = SQRT3 * (q + r / 2), y = 1.5 * r;
  const poly = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30);
    poly.push([x + Math.cos(a), y + Math.sin(a)]);
  }
  return { x, y, poly, coord: { q, r }, tags: { tri: (((q - r) % 3) + 3) % 3, ...tags } };
}

// `rotate` (degrees, clockwise on screen) turns the drawing only; coords,
// directions and tags are unchanged.
function finish(specs, rotate = 0) {
  if (rotate) {
    for (const spec of specs) {
      [spec.x, spec.y] = rotatePoint([spec.x, spec.y], rotate);
      spec.poly = spec.poly.map((p) => rotatePoint(p, rotate));
    }
  }
  const board = makeBoard(specs);
  board.rotate = rotate;
  return attachGrid(board, DIRS6,
    (c) => (Array.isArray(c) ? c.join(",") : `${c.q},${c.r}`),
    (c, [dq, dr]) => [c.q + dq, c.r + dr]);
}

// n x n rhombus, as used by Hex. With rotate = -30 the long diagonal (between
// the acute corners) is horizontal, so the board is drawn as a diamond.
export function rhombusBoard(n, { rotate = 0 } = {}) {
  const specs = [];
  for (let r = 0; r < n; r++) {
    for (let q = 0; q < n; q++) {
      const edges = [];
      if (r === 0) edges.push("N");
      if (r === n - 1) edges.push("S");
      if (q === 0) edges.push("W");
      if (q === n - 1) edges.push("E");
      specs.push(hexCell(q, r, { edges, name: FILES[q] + (r + 1) }));
    }
  }
  const board = finish(specs, rotate);
  board.shape = "rhombus";
  board.n = n;
  return board;
}

// Hexagon with `side` cells along each edge (side 1 is a single cell).
export function hexHexBoard(side, { rotate = 0 } = {}) {
  const m = side - 1;
  const inside = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= m;
  const specs = [];
  for (let r = -m; r <= m; r++) {
    for (let q = -m; q <= m; q++) {
      if (!inside(q, r)) continue;
      const off = DIRS6.map(([dq, dr]) => !inside(q + dq, r + dr));
      const edges = [];
      for (let d = 0; d < 6; d++) if (off[d] && off[(d + 1) % 6]) edges.push(d);
      specs.push(hexCell(q, r, { edges, name: FILES[q + m] + (r + m + 1) }));
    }
  }
  const board = finish(specs, rotate);
  board.shape = "hexhex";
  board.side = side;
  return board;
}

// Outer edges of a rhombus board grouped by side, for drawing each player's
// goal edges: { N: [[[x1, y1], [x2, y2]], ...], S, W, E }. A corner cell's
// edges are split between its two sides by the direction they face.
export function rhombusSides(board) {
  // Direction indices (see DIRS6) facing out of each side.
  const facing = { N: [1, 2], S: [4, 5], E: [0, 1], W: [3, 4] };
  const out = { N: [], S: [], W: [], E: [] };
  for (const c of board.cells) {
    for (let k = 0; k < 6; k++) {
      const a = c.poly[k], b = c.poly[(k + 1) % 6];
      const angle = Math.atan2((a[1] + b[1]) / 2 - c.y, (a[0] + b[0]) / 2 - c.x) - (board.rotate * Math.PI) / 180;
      const d = ((Math.round(-angle / (Math.PI / 3)) % 6) + 6) % 6;
      if (board.step(c.id, d) >= 0) continue;   // shared with a neighbour
      for (const side of c.tags.edges) if (facing[side].includes(d)) out[side].push([a, b]);
    }
  }
  return out;
}
