// Projection: Go on the points of a honeycomb, where each stone must be
// projected from a friendly stone. Pure: no DOM.
//
// The board is a hexagon of hexagons with alternating sides of `side` and
// `side + 1` hexagons (3-fold symmetric), and stones go on the hexagons'
// corners, the points. Points are adjacent along the hexagons' edges, so
// each has three neighbours (two on the edge of the board). Seen another
// way, the points are the triangles of a triangular grid with edge
// adjacency (the hexagons' centres are the triangles' corners), and those
// triangles are the cells: invisible click targets.
//
// Each point projects along three rays, straight on from it through each of
// its neighbours: a ray passes through that neighbour, then the far corner
// of the hexagon beyond it, and so on (distances 1, 3, 4, 6, 7, ... in edge
// lengths), and stops at the first stone or the edge of the board.
//
// Start: Black places one black and one white stone on vacant points (two
// plies). White may then swap (common/swap.js): the two stones change
// colour and Black moves next. This is the book's "the second player
// chooses a colour", with players keeping their colours.
//
// Play: White moves first. A turn either projects a stone of the mover's
// colour onto a vacant point on a ray of one of their stones (before any
// stone on the ray), or passes. After placing, dead (no-liberty) enemy
// groups are removed, then the placed stone's group if it is dead (suicide
// is allowed). A projection may not recreate an earlier position
// (positional superko, by Zobrist hashes).
//
// End: two passes in a row. Area scoring (Tromp-Taylor: dead stones are not
// removed): stones on the board plus vacant regions that border only the
// player's stones. Equal scores: the player who made the first of the two
// final passes wins, so there are no draws.

import { makeBoard, extendView, pointKey, components, gridName } from "../../common/board/graph.js";
import { cachedBoards } from "../../common/engine.js";
import { withSwap, swapStones } from "../../common/swap.js";
import { seededRng } from "../../common/rng.js";

const BLACK = 1, WHITE = 2;
const PLAYERS = {
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff" },
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
};
const PASS = "pass";
const SIDES = [2, 3, 4, 5];
const SQRT3 = Math.sqrt(3);
const FRAME_MARGIN = 0.6;   // the board's surface beyond the outer points, in edge lengths
const BOARD_FILL = "#ffd890";
const GUIDE_STROKE = "#d1a65e";
const STONE_SIZE = 0.76;
const TERRITORY_SIZE = 0.3;

const other = (p) => 3 - p;
const unit = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
// From a hexagon's top corner, the neighbours lie up, down-right and
// down-left; from a bottom corner, down, up-right and up-left. (y is down.)
const DIRS = { top: [-90, 30, 150].map(unit), bottom: [90, -30, 210].map(unit) };

// ---- board ------------------------------------------------------------------

// Hexagon centres, pointy-topped, row by row: widths side, side + 1, ...,
// 2 side, then 2 side - 1, ..., side + 1.
function hexagons(side) {
  const out = [];
  let q0 = 0;
  for (let r = 0; r < 2 * side; r++) {
    const width = r <= side ? side + r : 3 * side - r;
    for (let q = q0; q < q0 + width; q++) out.push({ x: SQRT3 * (q + r / 2), y: 1.5 * r });
    if (r < side) q0--;
  }
  return out;
}

// Corners of a hexagon, clockwise from the top.
const corners = ({ x, y }) => [-90, -30, 30, 90, 150, 210].map((a) => {
  const [dx, dy] = unit(a);
  return [x + dx, y + dy];
});

// A point is a hexagon's top corner when its y is 1.5 r - 1 (2y = 1 mod 3),
// and a bottom corner when it is 1.5 r + 1 (2y = 2 mod 3).
const kind = (y) => ((((Math.round(2 * y) % 3) + 3) % 3) === 1 ? "top" : "bottom");

// The surface under the points: the hexagons' outline pushed out by `m`,
// with rounded convex corners and mitred reflex ones.
function frameOutline(hexes, m) {
  const edges = new Map();   // edge key -> [a, b, hexes...]
  for (const h of hexes) {
    const cs = corners(h);
    for (let k = 0; k < 6; k++) {
      const a = cs[k], b = cs[(k + 1) % 6];
      const ka = pointKey(a), kb = pointKey(b), key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
      if (edges.has(key)) edges.get(key).push(h); else edges.set(key, [a, b, h]);
    }
  }
  // Outer edges (of one hexagon), each from a to b clockwise round its
  // hexagon, and so clockwise round the board.
  const from = new Map();
  for (const e of edges.values()) if (e.length === 3) from.set(pointKey(e[0]), e);
  const loop = [];
  const start = from.values().next().value;
  for (let e = start; ; ) {
    loop.push(e);
    e = from.get(pointKey(e[1]));
    if (e === start) break;
  }
  const normal = ([a, b, h]) => {
    const mx = (a[0] + b[0]) / 2 - h.x, my = (a[1] + b[1]) / 2 - h.y, l = Math.hypot(mx, my);
    return [mx / l, my / l];
  };
  const out = [];
  loop.forEach((e, i) => {
    const f = loop[(i + 1) % loop.length], [px, py] = e[1];
    const n1 = normal(e), n2 = normal(f);
    if (e[2] === f[2]) {   // a convex corner: an arc about it
      const a1 = Math.atan2(n1[1], n1[0]), a2 = Math.atan2(n2[1], n2[0]);
      let da = a2 - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      for (let s = 0; s <= 6; s++) out.push([px + m * Math.cos(a1 + (da * s) / 6), py + m * Math.sin(a1 + (da * s) / 6)]);
    } else {               // a reflex corner: the mitre point
      const k = m / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
      out.push([px + k * (n1[0] + n2[0]), py + k * (n1[1] + n2[1])]);
    }
  });
  return out;
}

function buildBoard(side) {
  const hexes = hexagons(side);
  const seen = new Map(), raw = [];
  for (const h of hexes) {
    for (const p of corners(h)) {
      const k = pointKey(p);
      if (!seen.has(k)) { seen.set(k, raw.length); raw.push(p); }
    }
  }
  // Ids in reading order: top row first, left to right.
  raw.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const at = new Map(raw.map((p, id) => [pointKey(p), id]));
  const find = (x, y) => at.get(pointKey([x, y])) ?? -1;
  const centres = new Set(hexes.map((h) => pointKey([h.x, h.y])));

  // Names: a column letter for each distinct x and a row number for each
  // distinct y, rows counted from the bottom.
  const xs = [...new Set(raw.map(([x]) => Math.round((2 * x) / SQRT3)))].sort((a, b) => a - b);
  const ys = [...new Set(raw.map(([, y]) => Math.round(2 * y)))].sort((a, b) => b - a);

  const specs = raw.map(([x, y]) => {
    const dirs = DIRS[kind(y)];
    // The cell: the triangle of the three hexagon centres round the point,
    // with centres off the board pulled halfway in so cells stay on the frame.
    const poly = dirs.map(([dx, dy]) => (centres.has(pointKey([x - dx, y - dy])) ? [x - dx, y - dy] : [x - dx / 2, y - dy / 2]));
    const col = xs.indexOf(Math.round((2 * x) / SQRT3)), row = ys.indexOf(Math.round(2 * y));
    return { x, y, poly, coord: { col, row }, tags: { name: gridName(col, row) } };
  });
  const neighbours = specs.map(({ x, y }) =>
    DIRS[kind(y)].map(([dx, dy]) => find(x + dx, y + dy)).filter((n) => n >= 0).sort((a, b) => a - b));
  const board = makeBoard(specs, { neighbours, pad: 0.05 });
  board.side = side;
  board.style = "points";

  // rays[id]: up to three arrays of points, nearest first.
  board.rays = specs.map(({ x, y }) => DIRS[kind(y)].map(([dx, dy]) => {
    const ray = [];
    for (let k = 1; ; k += k % 3 === 1 ? 2 : 1) {
      const n = find(x + k * dx, y + k * dy);
      if (n < 0) break;
      ray.push(n);
    }
    return ray;
  }).filter((r) => r.length));

  // Grid lines: the hexagons' edges. Guides: their long diagonals, which the
  // rays follow.
  board.lines = [];
  board.cells.forEach((c) => {
    for (const n of board.neighbours[c.id]) if (n > c.id) board.lines.push([c.x, c.y, board.cells[n].x, board.cells[n].y]);
  });
  board.guides = hexes.flatMap((h) => { const cs = corners(h); return [0, 1, 2].map((k) => [cs[k], cs[k + 3]]); });
  board.frame = frameOutline(hexes, FRAME_MARGIN);

  // Zobrist keys, two 32-bit halves per point and colour.
  const rng = seededRng(0x9e3779b9 + side);
  const rand32 = () => Math.floor(rng() * 4294967296) >>> 0;
  board.zobrist = [null, BLACK, WHITE].map((p) => p && [Uint32Array.from(raw, rand32), Uint32Array.from(raw, rand32)]);
  return extendView(board, board.frame);
}

// ---- positions -----------------------------------------------------------------

// A 53-bit key from the hash halves.
const keyOf = (h1, h2) => h1 * 2097152 + (h2 >>> 11);

function hashCells(board, cells) {
  let h1 = 0, h2 = 0;
  for (let id = 0; id < cells.length; id++) {
    const p = cells[id];
    if (p) { h1 ^= board.zobrist[p][0][id]; h2 ^= board.zobrist[p][1][id]; }
  }
  return [h1 >>> 0, h2 >>> 0];
}

// The group at `id` and whether it has a liberty. Uses and clears `mark`.
function group(board, cells, id, mark) {
  const p = cells[id], out = [id];
  let free = false;
  mark[id] = 1;
  for (let i = 0; i < out.length; i++) {
    for (const n of board.neighbours[out[i]]) {
      if (mark[n]) continue;
      if (cells[n] === 0) free = true;
      else if (cells[n] === p) { mark[n] = 1; out.push(n); }
    }
  }
  for (const g of out) mark[g] = 0;
  return { stones: out, free };
}

// Place `p` at `t` and remove dead groups: enemy groups first, then the
// placed stone's own. Returns the removed stones (enemy, then own) and
// updates s.hash when `hash` is set.
function place(s, t, p, hash = true) {
  const { board, cells } = s, z = board.zobrist;
  const mark = board.mark || (board.mark = new Uint8Array(board.size));
  const removed = [];
  cells[t] = p;
  let h1 = s.h1 ^ z[p][0][t], h2 = s.h2 ^ z[p][1][t];
  const q = other(p);
  for (const n of board.neighbours[t]) {
    if (cells[n] !== q) continue;
    const g = group(board, cells, n, mark);
    if (g.free) continue;
    for (const id of g.stones) { cells[id] = 0; h1 ^= z[q][0][id]; h2 ^= z[q][1][id]; removed.push(id); }
  }
  const own = group(board, cells, t, mark);
  if (!own.free) {
    for (const id of own.stones) { cells[id] = 0; h1 ^= z[p][0][id]; h2 ^= z[p][1][id]; removed.push(id); }
  }
  if (hash) { s.h1 = h1 >>> 0; s.h2 = h2 >>> 0; }
  return removed;
}

// Vacant points `p` can project onto (ignoring the superko rule), in id order.
function targets(s, p) {
  const { cells, board } = s;
  const hit = new Uint8Array(cells.length);
  for (let id = 0; id < cells.length; id++) {
    if (cells[id] !== p) continue;
    for (const ray of board.rays[id]) {
      for (const n of ray) {
        if (cells[n]) break;
        hit[n] = 1;
      }
    }
  }
  const out = [];
  for (let id = 0; id < hit.length; id++) if (hit[id]) out.push(id);
  return out;
}

// Would projecting `p` onto `t` recreate an earlier position?
function repeats(s, t, p) {
  const saved = s.cells.slice();
  const [h1, h2] = [s.h1, s.h2];
  place(s, t, p);
  const bad = s.history.has(keyOf(s.h1, s.h2));
  s.cells.set(saved);
  s.h1 = h1; s.h2 = h2;
  return bad;
}

function generate(s) {
  if (s.over) return [];
  if (s.phase !== "play") {
    const out = [];
    for (let id = 0; id < s.cells.length; id++) if (!s.cells[id]) out.push([id]);
    return out;
  }
  return [...targets(s, s.turn).filter((t) => !repeats(s, t, s.turn)).map((t) => [t]), PASS];
}

// Legal moves, kept per position until it changes (outside the state, so
// that positions compare equal however they were reached).
const cache = new WeakMap();
function legal(s) {
  let moves = cache.get(s);
  if (!moves) cache.set(s, (moves = generate(s)));
  return moves;
}

// Area scores: stones, plus vacant regions bordering one colour only.
// `owner` (optional) receives each vacant point's owner.
function scores(s, owner = null) {
  const { board, cells } = s;
  const out = { [BLACK]: 0, [WHITE]: 0 };
  for (const p of cells) if (p) out[p]++;
  for (const region of components(board, (id) => !cells[id])) {
    let borders = 0;
    for (const id of region) for (const n of board.neighbours[id]) borders |= cells[n];
    if (borders === BLACK || borders === WHITE) {
      out[borders] += region.length;
      if (owner) for (const id of region) owner[id] = borders;
    }
  }
  return out;
}

function finish(s) {
  s.over = true;
  const sc = scores(s);
  s.winner = sc[BLACK] > sc[WHITE] ? BLACK : sc[WHITE] > sc[BLACK] ? WHITE : s.firstPasser;
}

function apply(s, move) {
  const p = s.turn;
  cache.delete(s);
  if (move === PASS) {
    if (!s.passes) s.firstPasser = p;
    s.passes++;
    s.last = { placed: -1, removed: [], pass: true };
    s.turn = other(p);
    if (s.passes >= 2) finish(s);
    return { pass: true };
  }
  const t = move[0];
  if (s.phase === "open1") {
    place(s, t, BLACK);
    s.phase = "open2";
  } else if (s.phase === "open2") {
    place(s, t, WHITE);
    s.phase = "play";
    s.turn = WHITE;
  } else {
    const removed = place(s, t, p);
    s.passes = 0;
    s.last = { placed: t, removed, pass: false };
    s.turn = other(p);
    s.history.add(keyOf(s.h1, s.h2));
    return { removed };
  }
  s.last = { placed: t, removed: [], pass: false };
  s.history.add(keyOf(s.h1, s.h2));
  return { removed: [] };
}

// ---- rollouts --------------------------------------------------------------

// Random projections, never filling a point whose neighbours are all the
// mover's stones (an eye), and without the superko check; a rollout passes
// when it has no other move and stops after two passes or a cap on its
// length, and is then scored.
function playout(s, rng) {
  const { board, cells } = s;
  if (s.phase !== "play") {
    while (s.phase !== "play") {
      const vacant = generate(s);
      apply(s, vacant[Math.floor(rng() * vacant.length)]);
    }
  }
  let passes = s.passes;
  let first = s.firstPasser;
  for (let ply = 0; ply < 3 * board.size && passes < 2; ply++) {
    const p = s.turn;
    const moves = targets(s, p).filter((t) => board.neighbours[t].some((n) => cells[n] !== p));
    if (!moves.length) {
      if (!passes) first = p;
      passes++;
    } else {
      place(s, moves[Math.floor(rng() * moves.length)], p, false);
      passes = 0;
    }
    s.turn = other(p);
  }
  const sc = scores(s);
  s.over = true;
  s.winner = sc[BLACK] > sc[WHITE] ? BLACK : sc[WHITE] > sc[BLACK] ? WHITE : first || other(s.turn);
  return s.winner;
}

// ---- game ----------------------------------------------------------------

const label = (side) => ({ value: side, label: `${side}–${side + 1}` });

export default withSwap({
  id: "projection",
  title: "Projection",
  url: import.meta.url,
  players: PLAYERS,
  options: {
    side: { label: "Board sides", choices: SIDES.map(label), default: 3 },
  },
  moveLabels: { [PASS]: "Pass" },
  colorSchemes: { sand: { name: "Sand", cellFill: () => "transparent" } },

  createBoard: cachedBoards((o) => o.side, ({ side }) => buildBoard(side)),
  initialState(board) {
    return {
      board,
      cells: new Uint8Array(board.size),
      turn: BLACK,
      phase: "open1",     // "open1" | "open2": Black's opening stones; "play"
      h1: 0, h2: 0,
      history: new Set([keyOf(0, 0)]),
      passes: 0,          // passes in a row
      firstPasser: 0,     // who made the first of them
      last: null,         // { placed, removed, pass }
      over: false,
      winner: null,
    };
  },
  clone(s) {
    return { ...s, cells: s.cells.slice(), history: new Set(s.history) };
  },
  toMove(s) {
    return s.turn;
  },
  legalMoves(s) {
    return legal(s);
  },
  applyMove: apply,
  // White swaps the opening: the two stones change colour, Black moves next.
  swapColours(s) {
    swapStones(s);
    [s.h1, s.h2] = hashCells(s.board, s.cells);
    const first = s.cells.findIndex((p, id) => p === WHITE && id !== s.last.placed);
    s.history = new Set([keyOf(0, 0), keyOf(s.board.zobrist[WHITE][0][first], s.board.zobrist[WHITE][1][first] >>> 0), keyOf(s.h1, s.h2)]);
    s.last = null;
    cache.delete(s);
  },
  playout,
  outcome(s) {
    return s.over ? { winner: s.winner } : null;
  },

  boardDecor(board) {
    return [
      { polygons: [board.frame], fill: BOARD_FILL },
      { segments: board.guides, stroke: GUIDE_STROKE, width: 0.025 },
    ];
  },
  // Stones; once the game is over, small stones on the points each player surrounds.
  piecesOf(s) {
    const out = [];
    for (let id = 0; id < s.cells.length; id++) if (s.cells[id]) out.push({ id, player: s.cells[id], size: STONE_SIZE });
    if (s.over) {
      const owner = new Uint8Array(s.cells.length);
      scores(s, owner);
      for (let id = 0; id < owner.length; id++) if (owner[id]) out.push({ id, player: owner[id], size: TERRITORY_SIZE });
    }
    return out;
  },
  // A ring on the last stone placed, dots where stones were removed, and
  // target dots on the points the player to move can project onto.
  markers(s) {
    const out = [];
    if (s.last && s.last.placed >= 0 && s.cells[s.last.placed]) out.push({ id: s.last.placed, kind: "ring" });
    if (s.last) for (const id of s.last.removed) out.push({ id, kind: "dot" });
    if (s.phase === "play" && !s.over) {
      for (const m of legal(s)) if (Array.isArray(m)) out.push({ id: m[0], kind: "target" });
    }
    return out;
  },
  moveText(s, move, info) {
    if (!Array.isArray(move)) return null;
    const name = s.board.cells[move[0]].tags.name;
    if (s.phase === "open1") return `${name} (black)`;
    if (s.phase === "open2") return `${name} (white)`;
    const n = info && info.removed ? info.removed.length : 0;
    return n ? `${name} ×${n}` : name;
  },
  turnHint(s) {
    if (s.over) return "";
    if (s.phase === "open1") return "Black places the opening black stone.";
    if (s.phase === "open2") return "Black places the opening white stone.";
    const name = PLAYERS[s.turn].name;
    if (s.passes) return `${PLAYERS[other(s.turn)].name} passed: ${name} projects, or passes to end the game.`;
    return `${name} projects a stone or passes.`;
  },
  scoreSummary(s, p) {
    const stones = s.cells.reduce((n, c) => n + (c === p), 0);
    return { main: scores(s)[p], sub: `${stones} stone${stones === 1 ? "" : "s"}`, title: "Stones plus the vacant points they surround" };
  },
  outcomeLines(s) {
    const sc = scores(s);
    const lines = [`Score: Black ${sc[BLACK]}, White ${sc[WHITE]}.`];
    if (sc[BLACK] === sc[WHITE]) lines.push(`${PLAYERS[s.winner].name} passed first.`);
    return lines;
  },
});

export const internals = { targets, scores, place, hashCells, keyOf };
