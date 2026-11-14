// Hemisphere: a connection game on the real projective plane. Pure: no DOM.
//
// The board is half of a Goldberg polyhedron (common/board/goldberg.js), one
// cell of each pair of opposite cells, drawn as a disk whose rim is glued to
// itself: a cell at the rim touches the cells across the rim on the far
// side. Players take turns placing a stone of their colour on an empty cell.
//
// A player wins with a loop of their stones that cannot be shrunk to a
// point: one that passes through the rim an odd number of times. Such a loop
// is one-sided (going round it once reverses left and right), and any two
// of them cross, so only one player can make one. Every cell has three
// corners, so stones cannot cross at a corner, and a full board holds
// exactly one: there are no draws. Stones are never removed, so the first
// player to make a loop is the one who has it on the full board (used by
// the playouts).
//
// Loops are found by a union-find over each player's stones that also keeps
// each stone's parity: how many times (mod 2) the path to its group's root
// crosses the rim. A new stone joining two stones of one group closes a
// loop, which crosses the rim an odd number of times when their parities
// and the crossing between them disagree.
//
// Swap (pie rule, common/swap.js): at Blue's first turn, Blue may take over
// Red's opening instead.

import { hemiGoldbergBoard } from "../../common/board/goldberg.js";
import { cachedBoards } from "../../common/engine.js";
import { withSwap } from "../../common/swap.js";

const RED = 1, BLUE = 2;
const RING = 0.52;        // the last-move ring's width, of the circle inscribed in its cell
// Okabe-Ito vermilion and blue, called Red and Blue as in Hex.
const PLAYERS = {
  [RED]: { name: "Red", fill: "#d55e00", mark: "#ffffff" },
  [BLUE]: { name: "Blue", fill: "#0072b2", mark: "#ffffff" },
};
const LOOP = "#f0e442";   // the winning loop's outline: Okabe-Ito yellow

// Achiral Goldberg polyhedra (only these have opposite cells to pair) with
// an even number of cells on the half: [cells, m, n].
const BOARDS = [[16, 1, 1], [46, 3, 0], [126, 5, 0], [136, 3, 3]];

// The colours are fixed: one scheme, a light stone board with the six
// pentagons a shade darker.
const colorSchemes = {
  stone: { name: "Stone", cellFill: (cell) => (cell.tags.pentagon ? "#cbc6bc" : "#e4e1da") },
};

function buildBoard({ cells }) {
  const [, m, n] = BOARDS.find(([size]) => size === cells);
  const board = hemiGoldbergBoard(m, n);
  // Every adjacency once, as flat arrays, for the full-board check.
  const eu = [], ev = [], et = [];
  board.neighbours.forEach((ns, a) => ns.forEach((b, t) => {
    if (a < b) { eu.push(a); ev.push(b); et.push(board.twists[a][t]); }
  }));
  board.edges = { u: Int16Array.from(eu), v: Int16Array.from(ev), twist: Uint8Array.from(et) };
  // Last-move rings: the cells differ in size (the projection squashes them
  // towards the rim, and board.unit is set by the most squashed), so each
  // ring is sized to its own cell, in the proportion a default ring has to
  // a regular hexagon.
  board.ringSize = board.cells.map((c) => (RING * 2 * inradius(c)) / board.unit);
  return board;
}

// Distance from a cell's centre to the nearest point of its outline.
function inradius({ x, y, poly }) {
  let best = Infinity;
  poly.forEach(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  });
  return best;
}

// ---- parity union-find ------------------------------------------------------
//
// parent[id] links a stone towards its group's root; parity[id] is whether
// the link crosses the rim an odd number of times. find() returns the root
// and leaves the stone's parity relative to it in `found`.

let found = 0;
function find(parent, parity, x) {
  let root = x, p = 0;
  while (parent[root] !== root) { p ^= parity[root]; root = parent[root]; }
  // Path compression, keeping each stone's parity to the root.
  for (let cur = x, cp = p; parent[cur] !== root;) {
    const next = parent[cur], np = cp ^ parity[cur];
    parent[cur] = root;
    parity[cur] = cp;
    cur = next;
    cp = np;
  }
  found = p;
  return root;
}

// Join stones a and b across an adjacency of the given twist; true if they
// were already in one group and the loop this closes crosses the rim an odd
// number of times.
function join(parent, parity, a, b, twist) {
  const ra = find(parent, parity, a), pa = found;
  const rb = find(parent, parity, b), pb = found;
  if (ra === rb) return (pa ^ pb ^ twist) === 1;
  parent[ra] = rb;
  parity[ra] = pa ^ pb ^ twist;
  return false;
}

// Does `player` have a loop on a (typically full) board? A fresh union-find
// over every adjacency.
function hasLoop(board, cells, player) {
  const parent = Int16Array.from({ length: board.size }, (_, i) => i), parity = new Uint8Array(board.size);
  const { u, v, twist } = board.edges;
  for (let e = 0; e < u.length; e++) {
    if (cells[u[e]] === player && cells[v[e]] === player && join(parent, parity, u[e], v[e], twist[e])) return true;
  }
  return false;
}

// The winner's shortest loop through the rim, for display: the shortest
// path from a stone to its own copy in the double cover (where crossing the
// rim switches sheets).
function winningLoop(board, cells, player) {
  let best = null;
  const n = board.size;
  for (let start = 0; start < n; start++) {
    if (cells[start] !== player) continue;
    const prev = new Int32Array(2 * n).fill(-2);
    prev[2 * start] = -1;
    const queue = [2 * start];
    for (let h = 0; h < queue.length && prev[2 * start + 1] === -2; h++) {
      const x = queue[h], id = x >> 1, sheet = x & 1;
      board.neighbours[id].forEach((k, t) => {
        const y = 2 * k + (sheet ^ board.twists[id][t]);
        if (cells[k] === player && prev[y] === -2) { prev[y] = x; queue.push(y); }
      });
    }
    if (prev[2 * start + 1] === -2) continue;
    const path = [];
    for (let x = prev[2 * start + 1]; x !== -1; x = prev[x]) path.push(x >> 1);
    if (!best || path.length < best.length) best = path;
  }
  return best || [];
}

function place(s, id) {
  const { board, cells, parent, parity } = s;
  const player = s.turn;
  cells[id] = player;
  parent[id] = id;
  parity[id] = 0;
  s.last = id;
  const ns = board.neighbours[id], ts = board.twists[id];
  let loop = false;
  for (let t = 0; t < ns.length; t++) {
    if (cells[ns[t]] === player && join(parent, parity, id, ns[t], ts[t])) loop = true;
  }
  if (loop) s.winner = player;
  else s.turn = 3 - player;
}

export default withSwap({
  id: "hemisphere",
  title: "Hemisphere",
  url: import.meta.url,
  players: PLAYERS,
  options: {
    cells: { label: "Cells", choices: BOARDS.map(([size]) => size), default: 46 },
  },
  colorSchemes,

  createBoard: cachedBoards((o) => String(o.cells), buildBoard),
  initialState(board) {
    return {
      board,
      cells: new Uint8Array(board.size),
      parent: Int16Array.from({ length: board.size }, (_, i) => i),
      parity: new Uint8Array(board.size),
      turn: RED,
      last: -1,
      winner: null,
    };
  },
  clone(s) {
    return { ...s, cells: s.cells.slice(), parent: s.parent.slice(), parity: s.parity.slice() };
  },
  toMove(s) {
    return s.turn;
  },
  legalMoves(s) {
    if (s.winner) return [];
    const out = [];
    for (let id = 0; id < s.cells.length; id++) if (!s.cells[id]) out.push([id]);
    return out;
  },
  applyMove(s, move) {
    place(s, move[0]);
    return null;
  },
  // Both players share the goal and the board: recolour the stones and hand
  // the move over. The groups stay as they are.
  swapColours(s) {
    for (let id = 0; id < s.cells.length; id++) if (s.cells[id]) s.cells[id] = 3 - s.cells[id];
    s.turn = 3 - s.turn;
  },
  outcome(s) {
    return s.winner ? { winner: s.winner } : null;
  },

  // Fill the board by random turns, then read off the winner of the full
  // board (the same player who would have made a loop first).
  playout(s, rng) {
    if (s.winner) return s.winner;
    const { cells } = s;
    const free = [];
    for (let id = 0; id < cells.length; id++) if (!cells[id]) free.push(id);
    let turn = s.turn;
    for (let i = free.length - 1; i >= 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      cells[free[j]] = turn;
      free[j] = free[i];
      turn = 3 - turn;
    }
    s.winner = hasLoop(s.board, cells, RED) ? RED : BLUE;
    return s.winner;
  },

  // Stones fill their cells, as the cells differ in size and shape.
  piecesOf(s) {
    const out = [];
    s.cells.forEach((player, id) => { if (player) out.push({ id, player, tile: true }); });
    return out;
  },
  // A ring on the last stone; when the game is over, the winning loop
  // outlined.
  markers(s) {
    const out = s.winner ? winningLoop(s.board, s.cells, s.winner).map((id) => ({ id, kind: "square", color: LOOP })) : [];
    if (s.last >= 0) out.push({ id: s.last, kind: "ring", size: s.board.ringSize[s.last] });
    return out;
  },
  scoreSummary(s, player) {
    const { name } = PLAYERS[player];
    return { sub: name, title: `${name} makes a loop through the rim` };
  },
});

export const internals = { BOARDS, hasLoop, winningLoop };
