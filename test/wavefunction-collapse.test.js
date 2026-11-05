import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/wavefunction-collapse/game.js";
import { newGame, CHANCE } from "../common/engine.js";
import { describeMove } from "../common/log.js";

const { BACK_RANKS, WHITE, BLACK } = internals;

const sq = (s, name) => s.board.cells.find((c) => c.tags.name === name).id;
const names = (s, player) => s.board.cells.filter((c) => s.cells[c.id] === player).map((c) => c.tags.name).sort();
const keys = (s, moves) => moves.map(([f, t]) => `${s.board.cells[f].tags.name}-${s.board.cells[t].tags.name}`).sort();

// A position with checkers on the named squares; `turn` has drawn `marble`.
// `colour` is what gray would stand for (the last W or B drawn).
function position({ white = [], black = [], turn = WHITE, marble = "W", colour = null }) {
  const s = newGame(game, {});
  game.applyMove(s, "setup:adeh");
  s.cells.fill(0);
  for (const n of white) s.cells[sq(s, n)] = WHITE;
  for (const n of black) s.cells[sq(s, n)] = BLACK;
  s.turn = turn;
  s.colour = colour;
  game.applyMove(s, `draw:${marble}`);
  return s;
}

test("the setup ply picks one of 70 back ranks, turned 180 degrees for Black", () => {
  const s = newGame(game, {});
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), null);
  assert.equal(game.chances(s).length, 70);
  assert.equal(new Set(BACK_RANKS).size, 70);
  game.applyMove(s, "setup:abcf");
  assert.deepEqual(names(s, WHITE), ["a1", "a2", "b1", "b2", "c1", "c2", "d2", "e2", "f1", "f2", "g2", "h2"]);
  assert.deepEqual(names(s, BLACK), ["a7", "b7", "c7", "c8", "d7", "e7", "f7", "f8", "g7", "g8", "h7", "h8"]);
  // Same square colours for both sides.
  const dark = (p) => s.board.cells.filter((c) => s.cells[c.id] === p && c.tags.dark).length;
  assert.equal(dark(WHITE), dark(BLACK));
  assert.equal(describeMove(game, newGame(game, {}), "setup:abcf"), "back rank a b c f");
});

test("the bag starts 3W 3B 1G and refills after 7 draws", () => {
  const s = newGame(game, {});
  game.applyMove(s, "setup:adeh");
  assert.deepEqual(s.bag.counts, { W: 3, B: 3, G: 1 });
  for (const m of ["W", "B", "W", "B", "W", "B", "G"]) {
    game.applyMove(s, `draw:${m}`);
    game.applyMove(s, game.legalMoves(s)[0]);
  }
  assert.deepEqual(s.bag.counts, { W: 3, B: 3, G: 1 });
  assert.deepEqual(s.bag.drawn, []);
});

test("white moves light-square checkers, black dark ones, diagonally forward", () => {
  let s = position({ white: ["b1", "c1", "e2"], marble: "W" });   // b1 light, c1 dark, e2 light
  assert.deepEqual(keys(s, game.legalMoves(s)), ["b1-a2", "b1-c2", "e2-d3", "e2-f3"]);
  s = position({ white: ["b1", "c1"], marble: "B" });
  assert.deepEqual(keys(s, game.legalMoves(s)), ["c1-b2", "c1-d2"]);
  s = position({ black: ["b8", "a7"], turn: BLACK, marble: "B" });   // b8 and a7 dark; b8-a7 blocked
  assert.deepEqual(keys(s, game.legalMoves(s)), ["a7-b6", "b8-c7"]);
});

test("gray copies the last colour, across refills; first gray is any", () => {
  let s = position({ white: ["b1", "c1"], marble: "G" });
  assert.equal(game.legalMoves(s).length, 4);
  assert.equal(describeMove(game, position({ white: ["b1"], marble: "W" }), "draw:G"), "drew gray (white)");
  s = position({ white: ["b1", "c1"], marble: "G", colour: "B" });
  assert.deepEqual(keys(s, game.legalMoves(s)), ["c1-b2", "c1-d2"]);
  // Gray keeps its colour into the next cycle.
  game.applyMove(s, game.legalMoves(s)[0]);
  assert.equal(s.colour, "B");
});

test("landing beside one opposing checker captures it; between two captures nothing", () => {
  let s = position({ white: ["c3"], black: ["a4"], marble: "B" });   // c3 dark
  game.applyMove(s, [sq(s, "c3"), sq(s, "b4")]);
  assert.deepEqual(names(s, BLACK), []);
  assert.equal(s.captured, sq(s, "a4"));

  s = position({ white: ["c3"], black: ["a4", "c4"], marble: "B" });
  const move = [sq(s, "c3"), sq(s, "b4")];
  assert.equal(describeMove(game, s, move), "c3–b4");
  game.applyMove(s, move);
  assert.deepEqual(names(s, BLACK), ["a4", "c4"]);

  s = position({ white: ["c3"], black: ["c4"], marble: "B" });
  assert.equal(describeMove(game, s, [sq(s, "c3"), sq(s, "d4")]), "c3–d4 ×c4");
  // A friendly neighbour does not shield.
  s = position({ white: ["c3", "a4"], black: ["c4"], marble: "B" });
  game.applyMove(s, [sq(s, "c3"), sq(s, "b4")]);
  assert.deepEqual(names(s, BLACK), []);
});

test("reaching the far rank wins", () => {
  const s = position({ white: ["b7"], black: ["h8"], marble: "W" });   // b7 light
  game.applyMove(s, [sq(s, "b7"), sq(s, "a8")]);
  assert.deepEqual(game.outcome(s), { winner: WHITE });
  assert.deepEqual(game.legalMoves(s), []);
});

test("no move for the drawn colour loses, even with other moves", () => {
  const s = position({ white: ["c1", "b2"], black: ["a3", "c3"], marble: "B" });   // c1 and b2 dark; only c1-d2 is open
  assert.equal(game.legalMoves(s).length, 1);
  const t = position({ white: ["b1"], black: ["h8"], marble: "B" });   // only a light checker
  assert.deepEqual(game.outcome(t), { winner: BLACK });
  assert.equal(t.reason, "stalemate");
  assert.deepEqual(game.legalMoves(t), []);
});
