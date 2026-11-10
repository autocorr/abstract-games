// Tunneling: each player has four grasshoppers, which move like the
// Grasshopper of fairy chess. A grasshopper slides along any of the eight
// queen lines over empty squares, hops the first piece it meets and lands on
// the square just beyond it, which must be on the board and empty. Any piece
// may be hopped, and nothing is captured. The square the grasshopper left
// gets a neutral stone, so every move uses up one square for good. A player
// with no legal move on their turn loses. Pure: no DOM.
//
// Cells hold EMPTY, a player number (WHITE, BLACK) for a grasshopper, or STONE.
// A move is [from, to]. White moves first.

import { squareBoard } from "../../common/board/square.js";
import { ray } from "../../common/board/graph.js";
import { cachedBoards } from "../../common/engine.js";

const EMPTY = 0, WHITE = 1, BLACK = 2, STONE = 3;
const other = (p) => 3 - p;

const PLAYERS = {
  1: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
  2: { name: "Black", fill: "#202329", mark: "#ffffff" },
};

// Lichess board colours: [light, dark].
const SCHEMES = {
  brown: { name: "Brown", colours: ["#f0d9b5", "#b58863"] },
  blue: { name: "Blue", colours: ["#dee3e6", "#8ca2ad"] },
};
const colorSchemes = Object.fromEntries(Object.entries(SCHEMES).map(([key, { name, colours: [light, dark] }]) =>
  [key, { name, cellFill: (cell) => (cell.tags.dark ? dark : light) }]));

// Grasshoppers are drawn as upside-down Queens, as in fairy chess diagrams.
const HOPPER_URL = {
  [WHITE]: new URL("../../common/pieces/cburnett/wQ.svg", import.meta.url).href,
  [BLACK]: new URL("../../common/pieces/cburnett/bQ.svg", import.meta.url).href,
};
const STONE_PIECE = { player: null, fill: "#8c8c8c", mark: "#ffffff", size: 0.65, shadow: false };

// Starting positions, as White's grasshoppers in doubled coordinates about the
// board's centre (x = 2 * col - (n - 1), likewise y from the row; both odd).
// Black's grasshoppers are White's turned half a turn about the centre, so every
// setup looks the same from either side of the board.
const SETUPS = {
  // The published position: the 4x4 square around the centre without its
  // corners, the colours alternating in pairs.
  ring: { label: "Ring", white: [[-1, 3], [-3, -1], [-1, -3], [3, -1]] },
  // The same pattern with the arms one square further out.
  wide: { label: "Wide ring", white: [[-1, 5], [-5, -1], [-1, -5], [5, -1]] },
  // The central 2x2 and the corners of the 4x4 around it.
  diagonals: { label: "Diagonals", white: [[-1, -1], [1, -1], [-3, 3], [3, 3]] },
};

// Each cell's rays along the 8 directions (square.js's DIRS8), to the edge.
function buildBoard(size) {
  const board = squareBoard({ cols: size, look: "lichess" });
  board.rays = board.cells.map((c) => board.dirs.map((_, d) => ray(board, c.id, d)).filter((r) => r.length));
  return board;
}

function setupCells(board, setup) {
  const n = board.cols;
  const at = ([x, y]) => board.at((x + n - 1) / 2, (y + n - 1) / 2);
  const cells = new Uint8Array(board.cells.length);
  for (const xy of SETUPS[setup].white) {
    cells[at(xy)] = WHITE;
    cells[at([-xy[0], -xy[1]])] = BLACK;
  }
  return cells;
}

// The hop along one ray: the square past the first piece, or -1.
function landing(cells, r) {
  for (let i = 0; i < r.length; i++) {
    if (cells[r[i]] !== EMPTY) return i + 1 < r.length && cells[r[i + 1]] === EMPTY ? r[i + 1] : -1;
  }
  return -1;
}

function movesFor(s, player) {
  const out = [];
  const { cells } = s;
  for (const from of s.hoppers[player]) {
    for (const r of s.board.rays[from]) {
      const to = landing(cells, r);
      if (to >= 0) out.push([from, to]);
    }
  }
  return out;
}

function hasMove(s, player) {
  for (const from of s.hoppers[player]) for (const r of s.board.rays[from]) if (landing(s.cells, r) >= 0) return true;
  return false;
}

export default {
  id: "tunneling",
  title: "Tunneling",
  url: import.meta.url,
  players: PLAYERS,
  options: {
    size: { label: "Board", choices: [{ value: 8, label: "8×8" }, { value: 10, label: "10×10" }], default: 8 },
    setup: {
      label: "Start",
      choices: Object.entries(SETUPS).map(([value, { label }]) => ({ value, label })),
      default: "ring",
    },
  },
  colorSchemes,

  createBoard: cachedBoards((o) => o.size, ({ size }) => buildBoard(size)),

  initialState(board, opts) {
    const cells = setupCells(board, opts.setup);
    const hoppers = { [WHITE]: [], [BLACK]: [] };
    cells.forEach((x, id) => { if (x === WHITE || x === BLACK) hoppers[x].push(id); });
    const s = { board, cells, hoppers, turn: WHITE, last: null, winner: null };
    if (!hasMove(s, WHITE)) s.winner = BLACK;
    return s;
  },

  clone(s) {
    return {
      ...s,
      cells: s.cells.slice(),
      hoppers: { [WHITE]: s.hoppers[WHITE].slice(), [BLACK]: s.hoppers[BLACK].slice() },
    };
  },

  toMove: (s) => s.turn,

  legalMoves(s) {
    return s.winner === null ? movesFor(s, s.turn) : [];
  },

  applyMove(s, [from, to]) {
    const p = s.turn;
    s.cells[to] = p;
    s.cells[from] = STONE;
    const list = s.hoppers[p];
    list[list.indexOf(from)] = to;
    s.last = [from, to];
    s.turn = other(p);
    if (!hasMove(s, s.turn)) s.winner = p;
    return null;
  },

  outcome: (s) => (s.winner === null ? null : { winner: s.winner }),

  outcomeLines(s) {
    return [`${PLAYERS[other(s.winner)].name} has no legal move.`];
  },

  piecesOf(s) {
    const out = [];
    s.cells.forEach((x, id) => {
      if (x === STONE) out.push({ id, ...STONE_PIECE });
      else if (x) out.push({ id, player: x, image: HOPPER_URL[x], rotate: 180 });
    });
    return out;
  },

  markers(s) {
    // The last move's squares, tinted Lichess's green as in the chess variants.
    return s.last ? s.last.map((id) => ({ id, kind: "tint" })) : [];
  },
};

export const internals = { EMPTY, WHITE, BLACK, STONE, SETUPS, landing };
