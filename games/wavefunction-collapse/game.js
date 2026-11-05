// Wavefunction Collapse: race a checker across the board, moving from the
// square colour a marble drawn from a bag names. From Bag of Tricks. Pure:
// no DOM.
//
// 8x8 chessboard (a1 dark), White first, moving up the board. Ranks 2 and 7
// start full; the game opens with a chance ply ("setup:adeh") that puts
// White's 4 back-rank checkers on 4 of the 8 squares of rank 1, and Black's
// on the same squares turned 180 degrees (a1 <-> h8), so both sides have the
// same square colours.
//
// A turn is a draw ("draw:W", "draw:B", "draw:G") and then a move [from, to]:
//   - White marble: move a checker on a light square; black: a dark square.
//   - Gray takes the colour of the last marble drawn, across refills (and
//     keeps its own colour if that marble was gray). Gray as the game's first
//     draw lets you move any checker.
//   - The bag starts 3W 3B 1G; after all 7 are drawn they go back in.
// A checker steps one square diagonally forward onto an empty square, so it
// never changes square colour. If it lands beside an opposing checker on the
// same rank (left or right), that checker is captured, unless it landed
// between two opposing checkers, which captures nothing.
//
// Reaching the far rank wins. A player with no legal move for the drawn
// colour is stalemated and loses. Every move advances a checker, so games
// always end. See docs/bag-of-tricks/rules.md.

import { squareBoard } from "../../common/board/square.js";
import { makeBag, cloneBag, drawOutcomes, drawMarble, drawnColour, isEmpty, returnDrawn, bagPanel } from "../../common/bag.js";
import { CHANCE, pickWeighted, cachedBoards } from "../../common/engine.js";
import { randInt } from "../../common/rng.js";

const WHITE = 1, BLACK = 2;
const N = 8;
const PLAYERS = {
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff" },
};
const MARBLES = {
  W: { name: "White", fill: "#f2f2f0" },
  B: { name: "Black", fill: "#202329" },
  G: { name: "Gray", fill: "#9aa0a6" },
};
const START_BAG = { W: 3, B: 3, G: 1 };
const SQUARE = { W: "light", B: "dark" };

const SETUP = "setup:";
const FILES = "abcdefgh";
// The 70 back ranks: 4 of the 8 files, as sorted letter strings ("adeh").
const BACK_RANKS = [];
for (let m = 0; m < 1 << N; m++) {
  let bits = 0;
  for (let x = m; x; x &= x - 1) bits++;
  if (bits === 4) BACK_RANKS.push([...FILES].filter((_, f) => m & (1 << f)).join(""));
}
const SETUP_OUTCOMES = BACK_RANKS.map((r) => ({ move: SETUP + r, p: 1 / BACK_RANKS.length }));

// Board colours from Lichess's default boards.
const colorSchemes = {
  brown: { name: "Brown", cellFill: (cell) => (cell.tags.dark ? "#b58863" : "#f0d9b5") },
  blue: { name: "Blue", cellFill: (cell) => (cell.tags.dark ? "#8ca2ad" : "#dee3e6") },
};

const LAST_MOVE = "rgba(14, 15, 19, 0.75)";
const CAPTURED = "#d2453b";

const other = (p) => 3 - p;
const at = (col, row) => row * N + col;
const colOf = (id) => id % N;
const rowOf = (id) => (id - (id % N)) / N;
const farRow = (p) => (p === WHITE ? N - 1 : 0);

function buildBoard() {
  const board = squareBoard({ cols: N, grid: false });
  board.dark = board.cells.map((c) => c.tags.dark);
  return board;
}

// The legal moves [from, to] for `player` from squares of colour `colour`
// ("W" light, "B" dark, null any).
function generateMoves(s, player, colour) {
  const out = [];
  const dr = player === WHITE ? 1 : -1;
  const dark = s.board.dark;
  for (let id = 0; id < N * N; id++) {
    if (s.cells[id] !== player) continue;
    if (colour && dark[id] !== (colour === "B")) continue;
    const row = rowOf(id) + dr, col = colOf(id);
    if (row < 0 || row >= N) continue;
    for (const c of [col - 1, col + 1]) {
      if (c >= 0 && c < N && !s.cells[at(c, row)]) out.push([id, at(c, row)]);
    }
  }
  return out;
}

// The checker a move to `to` by `player` captures, or -1: an opposing checker
// beside `to` on its rank, unless there is one on each side.
function captureAt(cells, player, to) {
  const col = colOf(to), opp = other(player);
  const left = col > 0 && cells[to - 1] === opp;
  const right = col < N - 1 && cells[to + 1] === opp;
  if (left === right) return -1;
  return left ? to - 1 : to + 1;
}

// Apply a draw: work out the colour to move from and the legal moves; with
// none, the player is stalemated.
function applyDraw(s, move) {
  const marble = drawMarble(s.bag, move);
  if (marble !== "G") s.colour = marble;
  s.moves = generateMoves(s, s.turn, s.colour);
  s.phase = "move";
  if (!s.moves.length) {
    s.winner = other(s.turn);
    s.reason = "stalemate";
  }
}

function applyStep(s, [from, to]) {
  const p = s.turn;
  s.cells[to] = p;
  s.cells[from] = 0;
  s.captured = captureAt(s.cells, p, to);
  if (s.captured >= 0) s.cells[s.captured] = 0;
  s.last = [from, to];
  s.moves = null;
  if (rowOf(to) === farRow(p)) {
    s.winner = p;
    s.reason = "crossed";
  }
  if (isEmpty(s.bag)) returnDrawn(s.bag);
  s.turn = other(p);
  s.phase = "draw";
}

// Playout policy: a winning move if there is one, else often a capture,
// else a random move.
function pickPlayoutMove(s, rng) {
  const moves = s.moves, far = farRow(s.turn);
  for (const m of moves) if (rowOf(m[1]) === far) return m;
  if (rng() < 0.5) {
    const captures = moves.filter(([, to]) => captureAt(s.cells, s.turn, to) >= 0);
    if (captures.length) return captures[randInt(rng, captures.length)];
  }
  return moves[randInt(rng, moves.length)];
}

const colourName = (c) => (c ? SQUARE[c] : "any");

const game = {
  id: "wavefunction-collapse",
  title: "Wavefunction Collapse",
  url: import.meta.url,
  players: PLAYERS,
  marbles: MARBLES,
  options: {},
  colorSchemes,

  createBoard: cachedBoards(() => "8", buildBoard),

  initialState(board) {
    const cells = new Uint8Array(N * N);
    for (let c = 0; c < N; c++) {
      cells[at(c, 1)] = WHITE;
      cells[at(c, N - 2)] = BLACK;
    }
    return {
      board,
      cells,
      turn: WHITE,
      phase: "setup",
      bag: makeBag(START_BAG),
      colour: null,     // the colour gray stands for: the last W or B drawn
      moves: null,      // legal moves this turn (after the draw)
      last: null,       // [from, to] of the last move
      captured: -1,     // square of the checker it captured
      backRank: null,   // White's back-rank files, e.g. "adeh"
      winner: null,
      reason: null,
    };
  },

  clone(s) {
    return { ...s, cells: s.cells.slice(), bag: cloneBag(s.bag) };
  },

  toMove(s) {
    return s.phase === "move" ? s.turn : CHANCE;
  },
  // The setup ply belongs to no player (its own line in the log).
  currentPlayer(s) {
    return s.phase === "setup" ? null : s.turn;
  },

  chances(s) {
    return s.phase === "setup" ? SETUP_OUTCOMES : drawOutcomes(s.bag);
  },

  legalMoves(s) {
    if (s.winner !== null) return [];
    return s.phase === "move" ? s.moves : this.chances(s).map((o) => o.move);
  },

  applyMove(s, move) {
    switch (s.phase) {
      case "setup": {
        const files = move.slice(SETUP.length);
        for (const f of files) {
          const col = FILES.indexOf(f);
          s.cells[at(col, 0)] = WHITE;
          s.cells[at(N - 1 - col, N - 1)] = BLACK;
        }
        s.backRank = files;
        s.phase = "draw";
        return null;
      }
      case "draw":
        applyDraw(s, move);
        return null;
      case "move":
        applyStep(s, move);
        return null;
    }
    throw new Error(`no move expected in phase ${s.phase}`);
  },

  outcome(s) {
    return s.winner === null ? null : { winner: s.winner };
  },

  playout(s, rng) {
    while (s.winner === null) {
      if (s.phase === "move") applyStep(s, pickPlayoutMove(s, rng));
      else this.applyMove(s, pickWeighted(this.chances(s), rng));
    }
    return s.winner;
  },

  markers(s) {
    const out = [];
    if (s.last) for (const id of s.last) out.push({ id, kind: "square", color: LAST_MOVE });
    if (s.captured >= 0) out.push({ id: s.captured, kind: "square", color: CAPTURED });
    return out;
  },

  // "d2–e3", "d2–e3 ×f3" for a capture; the setup reads "back rank a d e h";
  // a gray draw names the colour it stands for.
  moveText(s, move) {
    const name = (id) => s.board.cells[id].tags.name;
    if (typeof move === "string") {
      if (move.startsWith(SETUP)) return `back rank ${[...move.slice(SETUP.length)].join(" ")}`;
      if (drawnColour(move) === "G") return `drew gray (${s.colour ? MARBLES[s.colour].name.toLowerCase() : "any"})`;
      return null;
    }
    const [from, to] = move;
    const cap = captureAt(s.cells, s.turn, to);   // `from` is on another rank
    return `${name(from)}–${name(to)}${cap >= 0 ? ` ×${name(cap)}` : ""}`;
  },

  chanceView(s) {
    return [bagPanel(s.bag, { active: s.winner === null && s.phase === "draw" })];
  },

  turnHint(s) {
    if (s.winner !== null) return "";
    if (s.phase === "setup") return "Choosing the back ranks…";
    const name = PLAYERS[s.turn].name;
    if (s.phase === "draw") {
      const gray = s.bag.counts.G ? ` Gray would mean ${s.colour ? SQUARE[s.colour] + " squares" : "any checker"}.` : "";
      return `${name} draws a marble…${gray}`;
    }
    const marble = s.bag.drawn[s.bag.drawn.length - 1];
    const drew = marble === "G" ? `gray (${s.colour ? MARBLES[s.colour].name.toLowerCase() : "any"})` : MARBLES[marble].name.toLowerCase();
    return s.colour
      ? `${name} drew ${drew}: move a checker on a ${colourName(s.colour)} square.`
      : `${name} drew ${drew}: move any checker.`;
  },

  scoreSummary(s, player) {
    let n = 0;
    for (const x of s.cells) if (x === player) n++;
    return { sub: `${n} ${n === 1 ? "checker" : "checkers"}`, title: `${PLAYERS[player].name} crosses to rank ${farRow(player) + 1}` };
  },

  outcomeLines(s) {
    const loser = PLAYERS[other(s.winner)].name;
    switch (s.reason) {
      case "crossed": return [`${PLAYERS[s.winner].name} reached the far rank.`];
      case "stalemate": return [`${loser} has no legal move for the drawn color (stalemate loses).`];
    }
    return [];
  },
};

export default game;

// For tests.
export const internals = { generateMoves, captureAt, BACK_RANKS, WHITE, BLACK };
