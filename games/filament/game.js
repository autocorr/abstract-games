// Filament: rules engine (pure, no DOM). See index.html for the rules text.
//
// Players alternately place stones on empty cells of a Cairo pentagonal
// patch. After each placement, any empty cell where more than half of its
// neighbours hold one colour is filled with the opposite colour; fills
// cascade until none remain. When the board is full, the player with fewer
// groups wins, ties broken by comparing group sizes largest-first (smaller
// wins).

import { cairoBoard } from "../../common/board/cairo.js";
import { components } from "../../common/board/graph.js";
import { BOARDS, ROTATION } from "./boards.js";

const BLACK = 1, WHITE = 2;
const other = (p) => 3 - p;

// The colour an empty cell would be filled with (0 if none): the opposite of
// a strict majority of *all* its neighbours (3 of 5, or 2 of 3). Such a
// majority can never be overturned by later stones, so the order in which a
// cascade is evaluated does not affect its result.
export function fillColour(cells, neighbours, id) {
  const ns = neighbours[id];
  let black = 0, white = 0;
  for (const n of ns) {
    if (cells[n] === BLACK) black++;
    else if (cells[n] === WHITE) white++;
  }
  if (2 * black > ns.length) return WHITE;
  if (2 * white > ns.length) return BLACK;
  return 0;
}

// Place `player` at `id` and run the fill cascade. Mutates `cells`; returns
// the filled cell ids in fill order. Only neighbours of changed cells can
// gain a majority, so a worklist replaces whole-board rescans.
export function placeAndFill(cells, neighbours, id, player) {
  cells[id] = player;
  const fills = [];
  const work = neighbours[id].slice();
  while (work.length) {
    const c = work.pop();
    if (cells[c]) continue;
    const colour = fillColour(cells, neighbours, c);
    if (!colour) continue;
    cells[c] = colour;
    fills.push(c);
    for (const n of neighbours[c]) if (!cells[n]) work.push(n);
  }
  return fills;
}

// Group sizes for `player`, largest first.
export function groupStats(state, player) {
  const { cells } = state;
  const sizes = components(state.board, (id) => cells[id] === player).map((g) => g.length);
  sizes.sort((a, b) => b - a);
  return { count: sizes.length, sizes };
}

// Winner of a full board: fewer groups wins; on a tie compare group sizes
// largest-first and the first smaller size wins; identical lists draw.
export function decideWinner(state) {
  const a = groupStats(state, BLACK), b = groupStats(state, WHITE);
  if (a.count !== b.count) return a.count < b.count ? BLACK : WHITE;
  for (let i = 0; i < a.count; i++) {
    if (a.sizes[i] !== b.sizes[i]) return a.sizes[i] < b.sizes[i] ? BLACK : WHITE;
  }
  return 0;
}

const uniform = (colour) => () => colour;

export default {
  id: "filament",
  title: "Filament",
  url: import.meta.url,
  players: {
    [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff" },
    [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
  },
  options: {
    size: { label: "Board size", choices: [48, 160], default: 48 },
  },
  colorSchemes: {
    sand: { name: "Sand", cellFill: uniform("#ffd890") },
    gold: { name: "Gold", cellFill: uniform("#f4bf57") },
    pastel3: {
      name: "Pastel",
      cellFill: (cell) => ({ A: "#f2d8a7", B: "#bcdcc6", C: "#bcccee" })[cell.tags.colour],
    },
    slate: { name: "Slate", cellFill: (cell) => (cell.tags.tone ? "#8ca2ad" : "#dee3e6") },
  },

  createBoard({ size }) {
    return cairoBoard(BOARDS[size], { rotate: ROTATION[size] || 0 });
  },

  initialState(board) {
    return { board, cells: new Int8Array(board.size), toMove: BLACK, empty: board.size };
  },

  clone(state) {
    return { ...state, cells: state.cells.slice() };
  },

  toMove(state) {
    return state.toMove;
  },

  legalMoves(state) {
    const out = [];
    if (!state.empty) return out;
    const { cells } = state;
    for (let id = 0; id < cells.length; id++) if (!cells[id]) out.push([id]);
    return out;
  },

  applyMove(state, [id]) {
    const fills = placeAndFill(state.cells, state.board.neighbours, id, state.toMove);
    state.empty -= 1 + fills.length;
    state.toMove = other(state.toMove);
    return { fills };
  },

  outcome(state) {
    return state.empty ? null : { winner: decideWinner(state) };
  },

  // Random playout tracking empty cells in a swap-remove list, so each step
  // costs O(1) plus the cascade instead of a whole-board scan.
  playout(state, rng) {
    const { cells } = state;
    const neighbours = state.board.neighbours;
    const empties = [];
    const pos = new Int32Array(cells.length).fill(-1);
    for (let id = 0; id < cells.length; id++) {
      if (!cells[id]) { pos[id] = empties.length; empties.push(id); }
    }
    const remove = (id) => {
      const i = pos[id], last = empties.pop();
      if (last !== id) { empties[i] = last; pos[last] = i; }
      pos[id] = -1;
    };
    let player = state.toMove;
    while (empties.length) {
      const id = empties[Math.floor(rng() * empties.length)];
      remove(id);
      for (const f of placeAndFill(cells, neighbours, id, player)) remove(f);
      player = other(player);
    }
    state.empty = 0;
    state.toMove = player;
    return decideWinner(state);
  },

  // Ring on the placed stone, dots on the cascade fills.
  markers(state, move, info) {
    const out = [{ id: move[0], kind: "ring" }];
    if (info) for (const id of info.fills) out.push({ id, kind: "dot" });
    return out;
  },

  // Log text: the placement, and how many cells it filled.
  moveText(state, [id], info) {
    const n = info ? info.fills.length : 0;
    return n ? `${state.board.cells[id].tags.name} (${n} filled)` : null;
  },

  scoreSummary(state, player) {
    const { count, sizes } = groupStats(state, player);
    const name = this.players[player].name;
    return {
      main: count,
      sub: `${sizes[0] || 0} · ${sizes[1] || 0}`,
      title: `${name}: ${count} groups · largest ${sizes[0] || 0} · second ${sizes[1] || 0}`,
    };
  },

  outcomeLines(state) {
    return [BLACK, WHITE].map((p) => {
      const g = groupStats(state, p);
      const plural = g.count === 1 ? "group" : "groups";
      const sizes = g.sizes.length ? g.sizes.join(" · ") : "—";
      return `${this.players[p].name}: <b>${g.count}</b> ${plural} &nbsp;[${sizes}]`;
    });
  },
};
