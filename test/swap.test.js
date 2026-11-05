import { test } from "node:test";
import assert from "node:assert/strict";
import { withSwap, SWAP } from "../common/swap.js";
import { mcts } from "../common/ai/mcts.js";
import { newGame, replay, seatOf } from "../common/engine.js";
import { seededRng } from "../common/rng.js";
import ttt from "./fixtures/tictactoe.js";

const game = withSwap(ttt);

test("the swap is offered once, on the second player's first move", () => {
  const s = newGame(game);
  assert.ok(!game.legalMoves(s).includes(SWAP));
  game.applyMove(s, [4]);
  assert.ok(game.legalMoves(s).includes(SWAP));
  const declined = game.clone(s);
  game.applyMove(declined, [0]);
  game.applyMove(declined, [1]);
  assert.ok(!game.legalMoves(declined).includes(SWAP));
  assert.equal(declined.swapClosed, true);
});

test("swapping keeps the position and crosses the seats", () => {
  const { state: s } = replay(game, {}, [[4], SWAP]);
  assert.deepEqual(s.cells, [0, 0, 0, 0, 1, 0, 0, 0, 0]);
  assert.equal(game.toMove(s), 2);
  assert.equal(seatOf(game, s, 1), 2);
  assert.equal(seatOf(game, s, 2), 1);
  assert.ok(!game.legalMoves(s).includes(SWAP));
  const c = game.clone(s);
  assert.equal(c.swapped, true);
  assert.equal(c.swapClosed, true);
});

test("games without swap map seats to themselves", () => {
  assert.equal(seatOf(ttt, newGame(ttt), 2), 2);
});

test("an offer predicate narrows when the swap is available", () => {
  const never = withSwap(ttt, { offer: () => false });
  const { state } = replay(never, {}, [[4]]);
  assert.ok(!never.legalMoves(state).includes(SWAP));
});

test("mcts credits the swap to the seat that makes it", () => {
  // A centre opening is strong for X; O does best by taking it over.
  const { state } = replay(game, {}, [[4]]);
  assert.equal(mcts(game, state, { iterations: 4000, rng: seededRng(7) }), SWAP);
  // After the swap, X (now seat 2) still takes an immediate win.
  const { state: t } = replay(game, {}, [[4], SWAP, [0], [3], [1]]);
  assert.equal(game.toMove(t), 1);
  assert.deepEqual(mcts(game, t, { iterations: 2000, rng: seededRng(1) }), [5]);
});

test("the swap hint passes the colour scheme through", () => {
  const seen = [];
  const hinted = withSwap({ ...ttt, turnHint: (s, scheme) => { seen.push(scheme); return "Move."; } });
  const scheme = { name: "Test" };
  const { state } = replay(hinted, {}, [[4]]);
  assert.equal(hinted.turnHint(state, scheme), "Move. Or swap sides and take over X.");
  assert.deepEqual(seen, [scheme]);
});
