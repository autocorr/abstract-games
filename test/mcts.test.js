import { test } from "node:test";
import assert from "node:assert/strict";
import { mcts, searchMove } from "../common/ai/mcts.js";
import { replay } from "../common/engine.js";
import { seededRng } from "../common/rng.js";
import ttt from "./fixtures/tictactoe.js";

const search = (moves, iterations = 3000, seed = 1) =>
  mcts(ttt, replay(ttt, {}, moves).state, { timeMs: 60000, iterations, rng: seededRng(seed) });

test("mcts takes an immediate win", () => {
  // X: 0, 1   O: 3, 4   -> X to move wins at 2
  assert.deepEqual(search([[0], [3], [1], [4]]), [2]);
});

test("mcts blocks an immediate loss", () => {
  // X: 0, 8   O: 4, 5   -> X must block at 3
  assert.deepEqual(search([[0], [4], [8], [5]]), [3]);
});

test("mcts returns null when the game is over", () => {
  const moves = [[0], [3], [1], [4], [2]];
  assert.equal(search(moves), null);
});

test("mcts with zero time still returns a legal move", () => {
  const { state } = replay(ttt, {}, [[4]]);
  const move = mcts(ttt, state, { timeMs: 0 });
  assert.ok(move && state.cells[move[0]] === 0);
});

test("mcts does not mutate the searched state", () => {
  const { state } = replay(ttt, {}, [[0], [4]]);
  const before = JSON.stringify(state.cells);
  search([[0], [4]], 500);
  mcts(ttt, state, { timeMs: 0, iterations: 500 });
  assert.equal(JSON.stringify(state.cells), before);
});

test("mcts is reproducible with a seeded rng", () => {
  assert.deepEqual(search([[4]], 400, 9), search([[4]], 400, 9));
});

// One decision then one draw: "fair" wins with 2 of 4 marbles, "risky" with 9
// of 12 (but only 1 of its 4 colours wins). Choosing "risky" requires
// weighting outcomes by probability rather than treating colours as equal.
import { CHANCE } from "../common/engine.js";
import { makeBag, cloneBag, drawOutcomes, drawMarble } from "../common/bag.js";
import bagTtt from "./fixtures/bag-tictactoe.js";

const gamble = {
  players: { 1: { name: "A" }, 2: { name: "B" } },
  initialState: () => ({ choice: null, drawn: null, bag: null }),
  clone: (s) => ({ ...s, bag: s.bag && cloneBag(s.bag) }),
  toMove: (s) => (s.choice ? CHANCE : 1),
  chances: (s) => drawOutcomes(s.bag),
  legalMoves(s) {
    if (s.drawn) return [];
    return s.choice ? drawOutcomes(s.bag).map((o) => o.move) : ["fair", "risky"];
  },
  applyMove(s, m) {
    if (!s.choice) {
      s.choice = m;
      s.bag = makeBag(m === "fair" ? { W: 2, L: 2 } : { W: 9, X: 1, Y: 1, Z: 1 });
    } else s.drawn = drawMarble(s.bag, m);
  },
  outcome: (s) => (s.drawn ? { winner: s.drawn === "W" ? 1 : 2 } : null),
};

test("mcts weighs chance outcomes by probability", () => {
  for (const seed of [1, 2, 3]) {
    const move = mcts(gamble, gamble.initialState(), { timeMs: 60000, iterations: 2000, rng: seededRng(seed) });
    assert.equal(move, "risky");
  }
});

test("mcts returns null at a chance ply", () => {
  const s = gamble.initialState();
  gamble.applyMove(s, "fair");
  assert.equal(mcts(gamble, s, { timeMs: 0, iterations: 10 }), null);
});

test("mcts on a chance game takes an immediate win", () => {
  // X on 0 and 8 (dark), O on 1 and 3; X drew dark: the centre wins.
  const { state } = replay(bagTtt, {}, ["draw:D", [0], "draw:L", [1], "draw:D", [8], "draw:L", [3], "draw:D"]);
  const move = mcts(bagTtt, state, { timeMs: 60000, iterations: 2000, rng: seededRng(1) });
  assert.deepEqual(move, [4]);
});

test("searchMove replays a request of move keys and answers with a key", () => {
  // X to move after O took the left column's middle: X completes the top row.
  const key = searchMove(ttt, { options: {}, moves: ["0", "3", "1", "4"], timeMs: 50 });
  assert.equal(key, "2");
  assert.equal(searchMove(ttt, { options: {}, moves: ["0", "3", "1", "4", "2"], timeMs: 0 }), null);
});
