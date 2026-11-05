import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/bivalent/game.js";
import { newGame, CHANCE } from "../common/engine.js";
import { describeMove } from "../common/log.js";

const { WHITE, BLACK, RED } = internals;

// A position with stones at the named points; `turn` has drawn `colour`.
// The bag holds 5 gray and one red marble per red stone not on the board.
function position({ white = [], black = [], red = [], turn = WHITE, colour = "G", komi = 0.5 }) {
  const s = newGame(game, { komi });
  const at = (name) => s.board.cells.find((c) => c.tags.name === name).id;
  for (const n of white) s.cells[at(n)] = WHITE;
  for (const n of black) s.cells[at(n)] = BLACK;
  for (const n of red) s.cells[at(n)] = RED;
  s.empty -= white.length + black.length + red.length;
  s.bag.counts.R -= red.length;
  s.bag.drawn = red.map(() => "R");
  s.turn = turn;
  game.applyMove(s, `draw:${colour}`);
  return { s, at };
}

const play = (s, at, name) => game.applyMove(s, [at(name)]);

test("a turn is a draw, then a placement", () => {
  const s = newGame(game, { komi: 0.5 });
  assert.equal(game.toMove(s), CHANCE);
  assert.deepEqual(game.chances(s), [{ move: "draw:G", p: 0.5 }, { move: "draw:R", p: 0.5 }]);
  game.applyMove(s, "draw:G");
  assert.equal(game.toMove(s), WHITE);
  assert.equal(game.legalMoves(s).length, 49);
  game.applyMove(s, [24]);
  assert.equal(s.cells[24], WHITE);
  assert.deepEqual(s.bag.counts, { G: 5, R: 5 }, "a gray marble goes back");
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), BLACK);
});

test("a red marble is set aside and places a red stone", () => {
  const s = newGame(game, { komi: 0.5 });
  game.applyMove(s, "draw:R");
  game.applyMove(s, [24]);
  assert.equal(s.cells[24], RED);
  assert.deepEqual(s.bag.counts, { G: 5, R: 4 });
  assert.deepEqual(s.bag.drawn, ["R"]);
  const red = game.chances(s).find((o) => o.move === "draw:R");
  assert.equal(red.p, 4 / 9);
});

test("four scores for the mover, three for the opponent, five for nobody", () => {
  let { s, at } = position({ white: ["a1", "b1", "c1"] });
  let info = play(s, at, "d1");
  assert.deepEqual(info.points, { [WHITE]: 1, [BLACK]: 0 });

  ({ s, at } = position({ white: ["a1", "b1"] }));
  info = play(s, at, "c1");
  assert.deepEqual(info.points, { [WHITE]: 0, [BLACK]: 1 });

  ({ s, at } = position({ white: ["a1", "b1", "d1", "e1"] }));
  info = play(s, at, "c1");
  assert.deepEqual(info.points, { [WHITE]: 0, [BLACK]: 0 }, "an overline scores nothing");
  assert.deepEqual(s.score, { [WHITE]: 0, [BLACK]: 0 });
});

test("each line scores on its own, in all four directions", () => {
  // d4 makes a horizontal three (c4-e4), a vertical three (d3-d5) and a
  // diagonal four (a1-d4): Black +2, White +1.
  const { s, at } = position({ white: ["c4", "e4", "d3", "d5", "a1", "b2", "c3"] });
  const info = play(s, at, "d4");
  assert.deepEqual(info.points, { [WHITE]: 1, [BLACK]: 2 });
});

test("opponent stones don't count", () => {
  const { s, at } = position({ white: ["a1", "b1"], black: ["d1"] });
  const info = play(s, at, "c1");
  assert.deepEqual(info.points, { [WHITE]: 0, [BLACK]: 1 });
});

test("red stones count for the mover and convert when they score", () => {
  const { s, at } = position({ white: ["a1", "b1"], red: ["c1"] });
  const info = play(s, at, "d1");
  assert.deepEqual(info.points, { [WHITE]: 1, [BLACK]: 0 });
  assert.equal(s.cells[at("c1")], WHITE);
  assert.deepEqual(info.converted, [at("c1")]);
  assert.deepEqual(s.bag.counts, { G: 5, R: 5 }, "the red marble goes back");
  assert.deepEqual(s.bag.drawn, []);
});

test("a red stone that makes no line stays red", () => {
  const { s, at } = position({ white: ["a1"], colour: "R" });
  play(s, at, "b1");
  assert.equal(s.cells[at("b1")], RED);
  assert.deepEqual(s.bag.drawn, ["R"]);
});

test("a red trap scores against the opponent on their turn, wherever they play", () => {
  // Black draws red and plays c1 next to White's a1-b1, with d1 blocked by
  // Black: on Black's turn the red stone counts as black and scores nothing.
  const { s, at } = position({ white: ["a1", "b1"], black: ["d1"], turn: BLACK, colour: "R" });
  let info = play(s, at, "c1");
  assert.deepEqual(info.points, { [WHITE]: 0, [BLACK]: 0 });
  assert.equal(s.cells[at("c1")], RED);
  // White plays far away: the red stone now completes White's three.
  game.applyMove(s, "draw:G");
  info = play(s, at, "g7");
  assert.deepEqual(info.points, { [WHITE]: 0, [BLACK]: 1 });
  assert.equal(s.cells[at("c1")], WHITE);
  assert.deepEqual(s.score, { [WHITE]: 0, [BLACK]: 1 });
});

test("a red stone can be extended into a four instead", () => {
  // As above, but d1 is open: White plays it and scores a four.
  const { s, at } = position({ white: ["a1", "b1"], red: ["c1"] });
  const info = play(s, at, "d1");
  assert.deepEqual(info.points, { [WHITE]: 1, [BLACK]: 0 });
});

test("a line through two red stones is counted once", () => {
  const { s, at } = position({ white: ["a1", "b1"], red: ["c1", "d1"], turn: WHITE });
  const info = play(s, at, "g7");
  assert.deepEqual(info.points, { [WHITE]: 1, [BLACK]: 0 });
  assert.equal(info.lines, 1);
  assert.equal(s.cells[at("c1")], WHITE);
  assert.equal(s.cells[at("d1")], WHITE);
  assert.equal(s.bag.counts.R, 5);
});

test("a full board ends the game; komi decides for Black", () => {
  const { s } = position({});
  s.score = { [WHITE]: 10, [BLACK]: 10 };
  s.empty = 1;
  s.cells.fill(WHITE);
  s.cells[48] = 0;
  // A lone white stone at g7 joins White's full board: overlines only.
  const info = game.applyMove(s, [48]);
  assert.deepEqual(info.points, { [WHITE]: 0, [BLACK]: 0 });
  assert.deepEqual(game.outcome(s), { winner: BLACK });
  assert.deepEqual(game.legalMoves(s), []);
});

test("a negative komi goes to White", () => {
  const s = newGame(game, { komi: -1.5 });
  s.score = { [WHITE]: 9, [BLACK]: 10 };
  s.cells.fill(BLACK);
  s.cells[48] = 0;
  s.empty = 1;
  game.applyMove(s, "draw:G");
  game.applyMove(s, [48]);
  assert.deepEqual(game.outcome(s), { winner: WHITE });
  assert.deepEqual(game.outcomeLines(s), ["White: 9 points + 1.5 komi = 10.5", "Black: 10 points"]);
});

test("a whole-number komi can tie", () => {
  const s = newGame(game, { komi: 0 });
  s.score = { [WHITE]: 3, [BLACK]: 3 };
  s.cells.fill(BLACK);
  s.cells[48] = 0;
  s.empty = 1;
  game.applyMove(s, "draw:G");
  game.applyMove(s, [48]);
  assert.deepEqual(game.outcome(s), { winner: 0 });
});

test("log text names the point, red stones and points scored", () => {
  const { s, at } = position({ white: ["a1", "b1"] });
  const before = game.clone(s);
  const info = play(s, at, "c1");
  assert.equal(describeMove(game, before, [at("c1")], info, null), "c1: Black +1");
  const r = position({ colour: "R" });
  const b2 = game.clone(r.s);
  assert.equal(describeMove(game, b2, [r.at("d4")], play(r.s, r.at, "d4"), null), "d4 red");
});
