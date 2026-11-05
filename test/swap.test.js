import { test } from "node:test";
import assert from "node:assert/strict";
import { withSwap, SWAP } from "../common/swap.js";
import { mcts } from "../common/ai/mcts.js";
import { newGame, replay } from "../common/engine.js";
import { seededRng } from "../common/rng.js";
import ttt from "./fixtures/tictactoe.js";

// Tic-tac-toe is symmetric, so exchanging colours needs no reflection.
const swappable = {
  ...ttt,
  swapColours(s) {
    s.cells = s.cells.map((c) => (c ? 3 - c : 0));
    s.toMove = 3 - s.toMove;
  },
};
const game = withSwap(swappable);

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

test("swapping exchanges the colours and passes the move", () => {
  const { state: s } = replay(game, {}, [[4], SWAP]);
  assert.deepEqual(s.cells, [0, 0, 0, 0, 2, 0, 0, 0, 0], "X's opening is now O's");
  assert.equal(game.toMove(s), 1, "and X moves next");
  assert.ok(!game.legalMoves(s).includes(SWAP));
  const c = game.clone(s);
  assert.equal(c.swapClosed, true);
});

test("a game needs swapColours to take the swap rule", () => {
  assert.throws(() => withSwap(ttt), /swapColours/);
});

test("an offer predicate narrows when the swap is available", () => {
  const never = withSwap(swappable, { offer: () => false });
  const { state } = replay(never, {}, [[4]]);
  assert.ok(!never.legalMoves(state).includes(SWAP));
});

test("mcts values the swap for the player who makes it", () => {
  // A centre opening is strong for X; O does best by taking it over.
  const { state } = replay(game, {}, [[4]]);
  assert.equal(mcts(game, state, { iterations: 4000, rng: seededRng(7) }), SWAP);
  // After the swap O holds the centre; X 0, O 3, X 1 leaves O a win at 5.
  const { state: t } = replay(game, {}, [[4], SWAP, [0], [3], [1]]);
  assert.equal(game.toMove(t), 2);
  assert.deepEqual(mcts(game, t, { iterations: 2000, rng: seededRng(1) }), [5], "O completes the middle row");
});

test("the swap hint describes the swap and passes the colour scheme through", () => {
  const seen = [];
  const hinted = withSwap({ ...swappable, turnHint: (s, scheme) => { seen.push(scheme); return "Move."; } });
  const scheme = { name: "Test" };
  const { state } = replay(hinted, {}, [[4]]);
  assert.equal(hinted.turnHint(state, scheme), "Move. Or swap: X's opening becomes O's, and X moves next.");
  assert.deepEqual(seen, [scheme]);
});
