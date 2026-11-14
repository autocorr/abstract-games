// Zone Y: the game of Y with two zones. Pure: no DOM.
//
// The board is a triangle of hexagons (common/board/hex.js) with a smaller
// triangle at its centre, concentric with it: the inner zone, drawn darker.
// The rest is the outer zone. The inner triangle has `inner` cells a side,
// and the outer zone is (size - inner) / 3 rows wide all round, so the two
// sizes must differ by a multiple of 3.
//
// Black moves first. On a turn a player places either one stone in the inner
// zone or two stones in the outer zone, one ply per stone: the first stone
// may go on any empty cell, and if it is in the outer zone a second ply
// places another outer stone. If the outer zone has no empty cell left for
// it, or the first stone wins, the turn ends after one stone.
//
// A player wins by joining all three sides with one group of stones; corner
// cells lie on two sides. As in Y, a full board always holds exactly one such
// group, so there are no draws, and stones are never removed, so the first
// player to connect is the one who connects on the full board (used by the
// playouts).
//
// Swap (pie rule, common/swap.js): at the start of White's first turn, White
// may take over Black's opening instead.

import { triangleBoard } from "../../common/board/hex.js";
import { goalMasks, connectsSides, components } from "../../common/board/graph.js";
import { cachedBoards } from "../../common/engine.js";
import { withSwap, swapStones } from "../../common/swap.js";

const BLACK = 1, WHITE = 2;
const SIDES = ["W", "E", "S"];
const PLAYERS = {
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff", sides: SIDES },
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13", sides: SIDES },
};

const SIZES = Array.from({ length: 12 }, (_, i) => 8 + i);   // 8-19
const INNERS = Array.from({ length: 16 }, (_, i) => 1 + i);  // 1-16

// The inner triangle must be concentric, with an outer zone at least a row wide.
const innerAllowed = (inner, { size }) => inner <= size - 3 && (size - inner) % 3 === 0;

// Board colours from Lichess's brown and blue boards: dark for the inner zone.
const colorSchemes = {
  brown: { name: "Brown", cellFill: (cell) => (cell.tags.inner ? "#b58863" : "#f0d9b5") },
  blue: { name: "Blue", cellFill: (cell) => (cell.tags.inner ? "#8ca2ad" : "#dee3e6") },
};

function buildBoard({ size, inner }) {
  const board = triangleBoard(size);
  const width = (size - inner) / 3;
  board.inner = new Uint8Array(board.size);
  for (const c of board.cells) {
    c.tags.inner = Math.min(...c.coord.d) >= width;
    board.inner[c.id] = c.tags.inner ? 1 : 0;
  }
  board.outerCount = board.size - board.inner.reduce((a, x) => a + x, 0);
  board.goal = goalMasks(board, { 1: PLAYERS[1] })[1];   // the same three sides for both
  return board;
}

const wins = (s, id) => connectsSides(s.board, s.cells, id, s.board.goal, SIDES.length);

// Place the mover's stone on `id` and move the turn on as needed.
function place(s, id) {
  const { board, cells } = s;
  cells[id] = s.turn;
  if (board.inner[id]) s.innerFree--;
  else s.outerFree--;
  const second = s.second;
  s.placed = second ? [...s.placed, id] : [id];
  if (wins(s, id)) {
    s.winner = s.turn;
    s.second = false;
    return null;
  }
  if (!second && !board.inner[id] && s.outerFree > 0) {
    s.second = true;
  } else {
    s.second = false;
    s.turn = 3 - s.turn;
  }
  return null;
}

// The winner of a full board: the player with a group touching all three sides.
function fullBoardWinner(board, cells) {
  for (const group of components(board, (id) => cells[id] === BLACK)) {
    let touched = 0;
    for (const id of group) touched |= board.goal[id];
    if (touched === 7) return BLACK;
  }
  return WHITE;
}

const zoneHint = (s) => {
  const { innerFree, outerFree } = s;
  if (!innerFree) return outerFree > 1 ? "place two stones in the outer zone." : "place a stone in the outer zone.";
  if (!outerFree) return "place a stone in the inner zone.";
  return outerFree > 1
    ? "place one stone in the inner zone, or two in the outer zone."
    : "place one stone in the inner zone, or the last one in the outer zone.";
};

export default withSwap({
  id: "zone-y",
  title: "Zone Y",
  url: import.meta.url,
  players: PLAYERS,
  options: {
    size: { label: "Board side", choices: SIZES, default: 13 },
    inner: { label: "Inner zone side", choices: INNERS, default: 4, allowed: innerAllowed },
  },
  colorSchemes,

  createBoard: cachedBoards((o) => `${o.size}/${o.inner}`, buildBoard),
  initialState(board) {
    return {
      board,
      cells: new Uint8Array(board.size),
      turn: BLACK,
      second: false,          // the mover places their second outer stone
      placed: [],             // stones of the current (or last) turn
      innerFree: board.size - board.outerCount,
      outerFree: board.outerCount,
      winner: null,
    };
  },
  clone(s) {
    return { ...s, cells: s.cells.slice(), placed: s.placed.slice() };
  },
  toMove(s) {
    return s.turn;
  },
  currentPlayer(s) {
    return s.turn;
  },
  legalMoves(s) {
    if (s.winner) return [];
    const out = [];
    for (let id = 0; id < s.cells.length; id++) {
      if (!s.cells[id] && !(s.second && s.board.inner[id])) out.push([id]);
    }
    return out;
  },
  applyMove(s, move) {
    return place(s, move[0]);
  },
  // The board is symmetric and both players share the goal: recolour the
  // stones and hand the move over.
  swapColours: swapStones,
  outcome(s) {
    return s.winner ? { winner: s.winner } : null;
  },

  // Fill the board by random turns, then read off the winner of the full
  // board (the same player who would have connected first).
  playout(s, rng) {
    if (s.winner) return s.winner;
    const { board } = s;
    const cells = s.cells;
    const free = [], outer = [];
    for (let id = 0; id < cells.length; id++) {
      if (cells[id]) continue;
      free.push(id);
      if (!board.inner[id]) outer.push(id);
    }
    // Remove `id` from a list by swapping in the last element.
    const drop = (list, id) => { const i = list.indexOf(id); list[i] = list[list.length - 1]; list.pop(); };
    let turn = s.turn;
    if (s.second && outer.length) {
      const id = outer[Math.floor(rng() * outer.length)];
      cells[id] = turn;
      drop(outer, id);
      drop(free, id);
      turn = 3 - turn;
    } else if (s.second) {
      turn = 3 - turn;
    }
    while (free.length) {
      const id = free[Math.floor(rng() * free.length)];
      cells[id] = turn;
      drop(free, id);
      if (!board.inner[id]) {
        drop(outer, id);
        if (outer.length) {
          const id2 = outer[Math.floor(rng() * outer.length)];
          cells[id2] = turn;
          drop(outer, id2);
          drop(free, id2);
        }
      }
      turn = 3 - turn;
    }
    s.winner = fullBoardWinner(board, cells);
    return s.winner;
  },

  // Rings on the stones of the turn in progress, or else of the last turn.
  markers(s) {
    return s.placed.map((id) => ({ id, kind: "ring" }));
  },
  scoreSummary(s, player) {
    return { sub: PLAYERS[player].name, title: `${PLAYERS[player].name} connects all three sides` };
  },
  turnHint(s) {
    if (s.winner) return "";
    const name = PLAYERS[s.turn].name;
    return s.second ? `${name}: place a second stone in the outer zone.` : `${name}: ${zoneHint(s)}`;
  },
});

export const internals = { fullBoardWinner, innerAllowed };
