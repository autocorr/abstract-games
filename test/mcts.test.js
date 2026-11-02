import { test } from "node:test";
import assert from "node:assert/strict";
import { mcts } from "../common/ai/mcts.js";
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
