// Bag tic-tac-toe: a small chance game for testing shared code (chance plies
// in the engine, MCTS chance nodes, conformance checks, bag.js, square.js).
//
// Each turn starts with a draw from a shared bag of 2 dark and 2 light
// marbles, refilled when empty. The player then marks an empty square of the
// drawn colour (corners and centre are dark, edges light), or passes if
// there is none. Three in a row wins; a full board is a draw.

import { squareBoard } from "../../common/board/square.js";
import { makeBag, cloneBag, drawOutcomes, drawMarble, lastDrawn, isEmpty, returnDrawn } from "../../common/bag.js";
import { CHANCE } from "../../common/engine.js";

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export default {
  id: "bag-tictactoe",
  title: "Bag tic-tac-toe",
  url: import.meta.url,
  players: {
    1: { name: "X", fill: "#202329", mark: "#ffffff" },
    2: { name: "O", fill: "#f2f2f0", mark: "#0e0f13" },
  },
  marbles: {
    D: { name: "Dark", fill: "#7a5230" },
    L: { name: "Light", fill: "#f0d9b5" },
  },
  options: {},

  createBoard() {
    return squareBoard({ cols: 3 });
  },
  initialState(board) {
    return { board, cells: new Array(9).fill(0), turn: 1, phase: "draw", bag: makeBag({ D: 2, L: 2 }) };
  },
  clone(s) {
    return { ...s, cells: s.cells.slice(), bag: cloneBag(s.bag) };
  },
  toMove(s) {
    return s.phase === "draw" ? CHANCE : s.turn;
  },
  currentPlayer(s) {
    return s.turn;
  },
  chances(s) {
    return drawOutcomes(s.bag);
  },
  legalMoves(s) {
    if (this.outcome(s)) return [];
    if (s.phase === "draw") return this.chances(s).map((o) => o.move);
    const dark = lastDrawn(s.bag) === "D";
    const out = [];
    for (let i = 0; i < 9; i++) if (!s.cells[i] && s.board.cells[i].tags.dark === dark) out.push([i]);
    return out.length ? out : ["pass"];
  },
  applyMove(s, move) {
    if (s.phase === "draw") {
      drawMarble(s.bag, move);
      s.phase = "move";
      return { drew: lastDrawn(s.bag) };
    }
    if (move !== "pass") s.cells[move[0]] = s.turn;
    s.turn = 3 - s.turn;
    s.phase = "draw";
    if (isEmpty(s.bag)) returnDrawn(s.bag);   // refill so chances() always has outcomes
    return null;
  },
  outcome(s) {
    for (const [a, b, c] of LINES) {
      if (s.cells[a] && s.cells[a] === s.cells[b] && s.cells[a] === s.cells[c]) return { winner: s.cells[a] };
    }
    return s.cells.every((v) => v) ? { winner: 0 } : null;
  },
  chanceView(s) {
    return [{ title: "Bag", counts: s.bag.counts, drawn: s.bag.drawn, active: s.phase === "draw" }];
  },
};
