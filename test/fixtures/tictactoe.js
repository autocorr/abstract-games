// Tic-tac-toe implementing the Game contract: a small, fully understood game
// for testing shared code (MCTS, engine helpers, conformance checks).

import { makeBoard } from "../../common/board/graph.js";

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export default {
  id: "tictactoe",
  title: "Tic-tac-toe",
  url: import.meta.url,
  players: {
    1: { name: "X", fill: "#202329", mark: "#ffffff" },
    2: { name: "O", fill: "#f2f2f0", mark: "#0e0f13" },
  },
  options: {},

  createBoard() {
    const cells = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        cells.push({ x: c, y: r, poly: [[c - 0.5, r - 0.5], [c + 0.5, r - 0.5], [c + 0.5, r + 0.5], [c - 0.5, r + 0.5]] });
      }
    }
    return makeBoard(cells);
  },
  initialState(board) {
    return { board, cells: new Array(9).fill(0), toMove: 1 };
  },
  clone(s) {
    return { ...s, cells: s.cells.slice() };
  },
  toMove(s) {
    return s.toMove;
  },
  legalMoves(s) {
    if (this.outcome(s)) return [];
    const out = [];
    for (let i = 0; i < 9; i++) if (!s.cells[i]) out.push([i]);
    return out;
  },
  applyMove(s, [id]) {
    s.cells[id] = s.toMove;
    s.toMove = 3 - s.toMove;
  },
  outcome(s) {
    for (const [a, b, c] of LINES) {
      if (s.cells[a] && s.cells[a] === s.cells[b] && s.cells[a] === s.cells[c]) return { winner: s.cells[a] };
    }
    return s.cells.every((v) => v) ? { winner: 0 } : null;
  },
};
