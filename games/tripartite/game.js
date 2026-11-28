// Tripartite: fill a hex-hex board, scoring groups by the edges they touch.
// Pure: no DOM.
//
// The cells are 3-coloured (tags.tri, so no two neighbours match), and each
// pair of opposite sides takes one of those colours: side d (0-5, see
// hex.js) has colour d % 3. The colour schemes are Okabe-Ito triples. Black moves
// first; a turn places one stone on an empty cell. The game ends when the
// board is full.
//
// Scoring: for each side, every group (connected stones of one colour) that
// touches the side scores one point per stone of the group standing on a
// cell of the side's colour. A group touching several sides scores for each
// (a corner cell lies on two). White adds a fractional komi, so there are no
// draws.

import { hexHexBoard } from "../../common/board/hex.js";
import { extendView } from "../../common/board/graph.js";
import { cachedBoards } from "../../common/engine.js";
import { shuffle } from "../../common/rng.js";

const BLACK = 1, WHITE = 2;
const PLAYERS = {
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff" },
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
};

// Blend a #rrggbb colour towards `base` by `t` (0 = colour, 1 = base).
function mix(hex, base, t) {
  const c = (h, i) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return "#" + [0, 1, 2].map((i) =>
    Math.round(c(hex, i) * (1 - t) + c(base, i) * t).toString(16).padStart(2, "0")).join("");
}

// Colour schemes: the edge colours by colour index; the cells are lighter
// tints of them.
function scheme(name, edges) {
  const cells = edges.map((e) => mix(e, "#f7f3ea", 0.55));
  return { name, edges, cellFill: (cell) => cells[cell.tags.tri] };
}
const SCHEMES = {
  vermilion: scheme("Vermilion, sky blue, yellow", ["#D55E00", "#56B4E9", "#F0E442"]),
  orange: scheme("Orange, sky blue, green", ["#E69F00", "#56B4E9", "#009E73"]),
};
export const sideColor = (d) => d % 3;

const SIZES = [4, 5, 6, 7];
// Self-play trials (MCTS, 20,000 iterations a move, 30 games per size) found
// Black ahead by a median of about 5-7 points on sides 4 and 5; on larger
// boards the margins were too wide (MCTS plays to win, not by more) to say.
const KOMIS = Array.from({ length: 21 }, (_, i) => i + 0.5);

// How far the frame reaches past the outermost cell corners, in cells.
const FRAME_MARGIN = 0.32;

// A band round the board in six pieces, one per side: each is a triangle
// from the side's two outer corners to the centre, drawn under the cells,
// which hide all but the band. Side d faces between the corner cells in
// directions d and d + 1.
function frame(board) {
  const m = board.side - 1;
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const corner = DIRS.map(([dq, dr]) => board.cells[board.at(m * dq, m * dr)]);
  const centre = board.cells[board.at(0, 0)];
  const pts = board.cells.flatMap((c) => c.poly);
  const lines = DIRS.map((_, d) => {
    const a = corner[d], b = corner[(d + 1) % 6];
    let n = [(a.x + b.x) / 2 - centre.x, (a.y + b.y) / 2 - centre.y];
    const len = Math.hypot(n[0], n[1]) || 1;
    n = [n[0] / len, n[1] / len];
    const reach = Math.max(...pts.map((p) => (p[0] - centre.x) * n[0] + (p[1] - centre.y) * n[1])) + FRAME_MARGIN * board.unit;
    return { n, reach };
  });
  // Where the outer lines of sides s and t meet.
  const meet = (s, t) => {
    const A = lines[s], B = lines[t];
    const det = A.n[0] * B.n[1] - A.n[1] * B.n[0];
    return [centre.x + (A.reach * B.n[1] - B.reach * A.n[1]) / det, centre.y + (A.n[0] * B.reach - B.n[0] * A.reach) / det];
  };
  return DIRS.map((_, d) => [meet((d + 5) % 6, d), meet(d, (d + 1) % 6), [centre.x, centre.y]]);
}

function buildBoard(side) {
  const board = hexHexBoard(side);
  // Per cell: its colour, and a bit mask of the sides it lies on.
  board.color = Uint8Array.from(board.cells, (c) => c.tags.tri);
  board.sideMask = Uint8Array.from(board.cells, (c) => c.tags.edges.reduce((m, d) => m | (1 << d), 0));
  board.frame = frame(board);
  return extendView(board, board.frame.flat());
}

// ---- scoring ---------------------------------------------------------------

// Each player's points: [_, black, white], without komi. Also fills
// `groupPoints` (if given) with each stone's group total, for display.
export function scores(board, cells, groupPoints = null) {
  const out = [0, 0, 0];
  const seen = new Uint8Array(cells.length);
  const group = [];
  for (let start = 0; start < cells.length; start++) {
    const p = cells[start];
    if (!p || seen[start]) continue;
    seen[start] = 1;
    group.length = 0;
    group.push(start);
    let sides = 0;
    const byColor = [0, 0, 0];
    for (let i = 0; i < group.length; i++) {
      const id = group[i];
      sides |= board.sideMask[id];
      byColor[board.color[id]]++;
      for (const n of board.neighbours[id]) if (cells[n] === p && !seen[n]) { seen[n] = 1; group.push(n); }
    }
    let points = 0;
    for (let d = 0; d < 6; d++) if (sides & (1 << d)) points += byColor[sideColor(d)];
    out[p] += points;
    if (groupPoints) for (const id of group) groupPoints[id] = points;
  }
  return out;
}

const totals = (s) => {
  const t = scores(s.board, s.cells);
  return { [BLACK]: t[BLACK], [WHITE]: t[WHITE] + s.komi };
};

function apply(s, move) {
  s.cells[move[0]] = s.turn;
  s.empty--;
  s.turn = 3 - s.turn;
  if (!s.empty) {
    const t = totals(s);
    s.winner = t[BLACK] > t[WHITE] ? BLACK : WHITE;
  }
  return null;
}

export default {
  id: "tripartite",
  title: "Tripartite",
  url: import.meta.url,
  players: PLAYERS,
  options: {
    size: { label: "Board side", choices: SIZES, default: 5 },
    komi: { label: "Komi", choices: KOMIS, default: 5.5, testDefault: true },
  },
  colorSchemes: SCHEMES,
  pieceLabels: "Group points",
  pieceLabelsDefault: "off",

  createBoard: cachedBoards((o) => o.size, ({ size }) => buildBoard(size)),
  initialState(board, { komi }) {
    return { board, cells: new Uint8Array(board.size), turn: BLACK, empty: board.size, komi, winner: null };
  },
  clone(s) {
    return { ...s, cells: s.cells.slice() };
  },
  toMove(s) {
    return s.turn;
  },
  legalMoves(s) {
    if (!s.empty) return [];
    const out = [];
    for (let id = 0; id < s.cells.length; id++) if (!s.cells[id]) out.push([id]);
    return out;
  },
  applyMove: apply,
  outcome(s) {
    return s.empty ? null : { winner: s.winner };
  },

  // Fill the rest of the board at random, alternating from the player to move.
  playout(s, rng) {
    const empties = [];
    for (let id = 0; id < s.cells.length; id++) if (!s.cells[id]) empties.push(id);
    shuffle(empties, rng);
    for (const id of empties) apply(s, [id]);
    return s.winner;
  },

  piecesOf(s) {
    const points = new Int16Array(s.cells.length);
    scores(s.board, s.cells, points);
    const out = [];
    for (let id = 0; id < s.cells.length; id++) {
      if (s.cells[id]) out.push({ id, player: s.cells[id], label: String(points[id]) });
    }
    return out;
  },
  boardDecor(board, scheme) {
    const { edges } = scheme || SCHEMES.vermilion;
    return board.frame.map((poly, d) => ({ polygons: [poly], fill: edges[sideColor(d)] }));
  },

  turnHint(s) {
    return s.empty ? `${PLAYERS[s.turn].name}: place a stone on an empty cell.` : "";
  },
  scoreSummary(s, player) {
    const t = totals(s);
    const komi = player === WHITE ? `, including ${s.komi} komi` : "";
    return { main: t[player], sub: PLAYERS[player].name, title: `${PLAYERS[player].name}'s points${komi}` };
  },
  outcomeLines(s) {
    const t = scores(s.board, s.cells);
    return [`Black ${t[BLACK]}, White ${t[WHITE] + s.komi} (${t[WHITE]} + ${s.komi} komi).`];
  },
};

export const internals = { scores, SCHEMES };
