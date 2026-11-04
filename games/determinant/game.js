// Determinant: a connection game on the points of a square Go-style board,
// with orthogonal connection only. Pure: no DOM.
//
// Black connects the N and S edges, White the W and E edges (corner points
// lie on both). A "cross-cut" is a 2x2 patch whose two diagonals hold one
// colour each. When a placement makes cross-cuts, one marble is drawn from
// the bag (3 white, 2 black at the start): its colour names the resolver,
// who replaces one opponent stone in a cross-cut with their own, and keeps
// doing so (including any cross-cuts the replacements make) until no
// cross-cut is left. The drawn marble leaves play and one of the other
// colour goes in, so the bag always holds five.
//
// Each turn ends with no cross-cut on the board, so a diagonal pair of one
// colour always shares an orthogonal neighbour of that colour. Orthogonal
// connection then equals 8-way connection, and as in Hex a full board has
// exactly one winner: games cannot be drawn.
//
// Swap (pie rule, common/swap.js): on White's first turn White may instead
// trade sides, taking Black's opening stone; the bag is unchanged.

import { squareBoard } from "../../common/board/square.js";
import { makeBag, cloneBag, drawOutcomes, drawMarble, addMarbles } from "../../common/bag.js";
import { CHANCE } from "../../common/engine.js";
import { withSwap } from "../../common/swap.js";

const BLACK = 1, WHITE = 2;
const PLAYERS = {
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff", sides: ["N", "S"], marble: "B" },
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13", sides: ["W", "E"], marble: "W" },
};
const MARBLE_PLAYER = { B: BLACK, W: WHITE };
const START_BAG = { B: 2, W: 3 };

const SIZES = Array.from({ length: 13 }, (_, i) => 7 + i);

// Go-style star points: the 3rd line (4th from 13), the centre on odd
// boards, and the side midpoints on large odd boards.
function stars(n) {
  const k = n >= 13 ? 3 : 2, m = (n - 1) / 2, far = n - 1 - k;
  const out = [[k, k], [k, far], [far, k], [far, far]];
  if (n % 2) {
    out.push([m, m]);
    if (n >= 15) out.push([k, m], [far, m], [m, k], [m, far]);
  }
  return out;
}

const boards = new Map();

function buildBoard(n) {
  const board = squareBoard({ cols: n, style: "points", stars: stars(n) });
  // patches[p] = [a, b, c, d]: a = (col, row), b = east of a, c = north of a,
  // d = north-east of a. Diagonals are a-d and b-c.
  board.patches = [];
  board.patchesOf = board.cells.map(() => []);
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const quad = [board.at(col, row), board.at(col + 1, row), board.at(col, row + 1), board.at(col + 1, row + 1)];
      for (const id of quad) board.patchesOf[id].push(board.patches.length);
      board.patches.push(quad);
    }
  }
  // goalSide[p][id]: bit 1 = on the player's first side, 2 = on the second.
  board.goalSide = {};
  for (const [p, { sides }] of Object.entries(PLAYERS)) {
    board.goalSide[p] = Uint8Array.from(board.cells, (c) =>
      (c.tags.edges.includes(sides[0]) ? 1 : 0) | (c.tags.edges.includes(sides[1]) ? 2 : 0));
  }
  return board;
}

function isCut(cells, [a, b, c, d]) {
  const x = cells[a], y = cells[b];
  return x !== 0 && y !== 0 && x !== y && cells[d] === x && cells[c] === y;
}

// The cross-cuts among `patches` (patch indices), without duplicates.
function cutsAmong(cells, board, patches) {
  return [...new Set(patches)].filter((p) => isCut(cells, board.patches[p]));
}

// Stones the resolver may replace: opponent stones in a current cross-cut.
function flippable(s) {
  const opp = 3 - s.resolver, out = new Set();
  for (const p of s.cuts) for (const id of s.board.patches[p]) if (s.cells[id] === opp) out.add(id);
  return [...out].sort((a, b) => a - b);
}

// Does the orthogonal group containing `id` touch both of its owner's sides?
function connects(s, id) {
  const { board, cells } = s;
  const player = cells[id];
  const goal = board.goalSide[player];
  const seen = new Uint8Array(board.size);
  const stack = [id];
  seen[id] = 1;
  let touched = 0;
  while (stack.length) {
    const cur = stack.pop();
    touched |= goal[cur];
    if (touched === 3) return true;
    for (const n of board.neighbours[cur]) {
      if (!seen[n] && cells[n] === player) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return false;
}

// End of turn: only stones that changed colour this turn can complete a
// connection (a player already connected would have won earlier).
function endTurn(s) {
  for (const id of [s.placed, ...s.flipped]) {
    if (connects(s, id)) {
      s.winner = s.cells[id];
      break;
    }
  }
  s.turn = 3 - s.turn;
  s.phase = "place";
  s.resolver = 0;
  s.cuts = [];
}

export default withSwap({
  id: "determinant",
  title: "Determinant",
  url: import.meta.url,
  players: PLAYERS,
  marbles: { B: { name: "Black", fill: PLAYERS[BLACK].fill }, W: { name: "White", fill: PLAYERS[WHITE].fill } },
  options: {
    size: { label: "Board size", choices: SIZES, default: 11 },
  },

  createBoard({ size }) {
    if (!boards.has(size)) boards.set(size, buildBoard(size));
    return boards.get(size);
  },
  initialState(board) {
    return {
      board,
      cells: new Uint8Array(board.size),
      turn: BLACK,
      phase: "place",      // "place" | "draw" (chance) | "resolve"
      resolver: 0,         // player replacing stones in the resolve phase
      cuts: [],            // patch indices of the current cross-cuts
      placed: -1,          // this turn's placed stone
      flipped: [],         // stones replaced this turn
      bag: makeBag(START_BAG),
      winner: null,
    };
  },
  clone(s) {
    return { ...s, cells: s.cells.slice(), cuts: s.cuts.slice(), flipped: s.flipped.slice(), bag: cloneBag(s.bag) };
  },
  toMove(s) {
    return s.phase === "draw" ? CHANCE : s.phase === "resolve" ? s.resolver : s.turn;
  },
  currentPlayer(s) {
    return s.turn;
  },
  chances(s) {
    return drawOutcomes(s.bag);
  },
  legalMoves(s) {
    if (s.winner) return [];
    if (s.phase === "draw") return drawOutcomes(s.bag).map((o) => o.move);
    if (s.phase === "resolve") return flippable(s).map((id) => [id]);
    const out = [];
    for (let id = 0; id < s.cells.length; id++) if (!s.cells[id]) out.push([id]);
    return out;
  },
  applyMove(s, move) {
    const { board, cells } = s;
    if (s.phase === "draw") {
      const colour = drawMarble(s.bag, move);
      s.resolver = MARBLE_PLAYER[colour];
      addMarbles(s.bag, PLAYERS[3 - s.resolver].marble);
      s.phase = "resolve";
      return null;
    }
    if (s.phase === "resolve") {
      const id = move[0];
      cells[id] = s.resolver;
      s.flipped.push(id);
      s.cuts = cutsAmong(cells, board, [...s.cuts, ...board.patchesOf[id]]);
      if (!s.cuts.length) endTurn(s);
      return null;
    }
    const id = move[0];
    cells[id] = s.turn;
    s.placed = id;
    s.flipped = [];
    s.cuts = cutsAmong(cells, board, board.patchesOf[id]);
    if (s.cuts.length) s.phase = "draw";
    else endTurn(s);
    return null;
  },
  outcome(s) {
    return s.winner ? { winner: s.winner } : null;
  },

  // Random playout tracking empty points in a swap-remove list.
  playout(s, rng) {
    const empties = [];
    for (let id = 0; id < s.cells.length; id++) if (!s.cells[id]) empties.push(id);
    while (!s.winner) {
      if (s.phase === "draw") {
        const n = s.bag.counts.B + s.bag.counts.W;
        this.applyMove(s, rng() * n < s.bag.counts.B ? "draw:B" : "draw:W");
      } else if (s.phase === "resolve") {
        const options = flippable(s);
        this.applyMove(s, [options[Math.floor(rng() * options.length)]]);
      } else {
        const i = Math.floor(rng() * empties.length);
        const id = empties[i];
        empties[i] = empties[empties.length - 1];
        empties.pop();
        this.applyMove(s, [id]);
      }
    }
    return s.winner;
  },

  chanceView(s) {
    return [{ title: "Bag", counts: s.bag.counts, drawn: s.bag.drawn, active: s.phase === "draw" && !s.winner }];
  },
  // Ring on this turn's placed and replaced stones; while resolving, target
  // dots on the stones that may be replaced.
  markers(s) {
    const out = [];
    if (s.placed >= 0) out.push({ id: s.placed, kind: "ring" });
    for (const id of s.flipped) out.push({ id, kind: "dot" });
    if (s.phase === "resolve" && !s.winner) for (const id of flippable(s)) out.push({ id, kind: "target" });
    return out;
  },
  turnHint(s) {
    if (s.winner) return "";
    const name = PLAYERS[s.turn].name;
    if (s.phase === "draw") return `${name} made a cross-cut: drawing a marble…`;
    if (s.phase === "resolve") {
      const r = PLAYERS[s.resolver].name, o = PLAYERS[3 - s.resolver].name.toLowerCase();
      return `${r} resolves: replace a ${o} stone in a cross-cut.`;
    }
    return `${name} to play.`;
  },
  scoreSummary(s, player) {
    const sides = player === BLACK ? "top and bottom" : "left and right";
    return { sub: PLAYERS[player].name, title: `${PLAYERS[player].name} connects the ${sides} edges` };
  },
  // Goal bars just outside the outer lines: Black top and bottom, White
  // left and right.
  boardDecor(board) {
    const n = board.cols - 1, o = -0.32, f = n + 0.32;
    return [
      { segments: [[[0, o], [n, o]], [[0, f], [n, f]]], stroke: PLAYERS[BLACK].fill, halo: "#c4c8cf", width: 0.14 },
      { segments: [[[o, 0], [o, n]], [[f, 0], [f, n]]], stroke: PLAYERS[WHITE].fill, halo: "#0e0f13", width: 0.14 },
    ];
  },
});
