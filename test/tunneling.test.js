import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/tunneling/game.js";
import { newGame, replay } from "../common/engine.js";

const { EMPTY, WHITE, BLACK, STONE, SETUPS } = internals;

const opts = (o = {}) => ({ size: 8, setup: "ring", ...o });
const idOf = (s, name) => s.board.cells.find((c) => c.tags.name === name).id;
const nameOf = (s, id) => s.board.cells[id].tags.name;
const named = (s, player) =>
  [...s.cells].flatMap((x, id) => (x === player ? [nameOf(s, id)] : [])).sort();
const targets = (s, from) =>
  game.legalMoves(s).filter(([f]) => f === idOf(s, from)).map(([, to]) => nameOf(s, to)).sort();

// A position from scratch: White to move, the given squares filled.
function position({ white = [], black = [], stones = [] }) {
  const s = newGame(game, opts());
  s.cells.fill(EMPTY);
  for (const [list, x] of [[white, WHITE], [black, BLACK], [stones, STONE]]) for (const n of list) s.cells[idOf(s, n)] = x;
  s.hoppers = { [WHITE]: white.map((n) => idOf(s, n)), [BLACK]: black.map((n) => idOf(s, n)) };
  return s;
}

test("the published start: a ring around the centre", () => {
  const s = newGame(game, opts());
  assert.deepEqual(named(s, WHITE), ["c4", "d3", "d6", "f4"]);
  assert.deepEqual(named(s, BLACK), ["c5", "e3", "e6", "f5"]);
  assert.equal(game.toMove(s), WHITE);
});

test("the move example: hops over any piece, blocked when the landing square is taken", () => {
  const s = position({
    white: ["d4", "c5"],
    black: ["d6", "c4"],
    stones: ["d7", "f4", "g4", "d3", "b2", "f2", "g7"],
  });
  // Up: d6 then d7 occupied. Right: f4 then g4 occupied.
  assert.deepEqual(targets(s, "d4"), ["a1", "b4", "b6", "d2", "g1", "h8"]);
});

test("no landing off the board", () => {
  const s = position({ white: ["a1"], black: ["a8"], stones: ["h8"] });
  assert.deepEqual(targets(s, "a1"), []);
});

test("the example opening: White d3-g6, Black e3-g5", () => {
  const { state: s } = replay(game, opts(), []);
  const d3 = idOf(s, "d3"), g6 = idOf(s, "g6"), e3 = idOf(s, "e3"), g5 = idOf(s, "g5");
  game.applyMove(s, game.legalMoves(s).find(([f, t]) => f === d3 && t === g6));
  assert.equal(s.cells[d3], STONE);
  assert.equal(s.cells[g6], WHITE);
  assert.equal(game.toMove(s), BLACK);
  game.applyMove(s, game.legalMoves(s).find(([f, t]) => f === e3 && t === g5));
  assert.deepEqual(named(s, STONE), ["d3", "e3"]);
  assert.deepEqual(named(s, BLACK), ["c5", "e6", "f5", "g5"]);
});

test("a player who cannot move loses", () => {
  // White's only move is a1-c1 over b1; afterwards Black's lone piece on h8
  // has nothing to hop.
  const s = position({ white: ["a1"], black: ["h8"], stones: ["b1"] });
  assert.equal(game.legalMoves(s).length, 1);
  game.applyMove(s, game.legalMoves(s)[0]);
  assert.deepEqual(game.outcome(s), { winner: WHITE });
  assert.deepEqual(game.legalMoves(s), []);
});

test("every start places four each, symmetric under a half turn, and White can move", () => {
  for (const size of [8, 10]) {
    for (const setup of Object.keys(SETUPS)) {
      const s = newGame(game, opts({ size, setup }));
      const n = size * size;
      assert.equal(named(s, WHITE).length, 4, `${size} ${setup}`);
      assert.equal(named(s, BLACK).length, 4, `${size} ${setup}`);
      s.cells.forEach((x, id) => {
        if (x === WHITE) assert.equal(s.cells[n - 1 - id], BLACK, `${size} ${setup}`);
      });
      assert.ok(game.legalMoves(s).length > 0, `${size} ${setup}`);
    }
  }
});

test("grasshoppers are drawn upside down, stones at 65% of a square without shadows", () => {
  const s = newGame(game, opts());
  game.applyMove(s, game.legalMoves(s)[0]);
  const pieces = game.piecesOf(s);
  assert.ok(pieces.filter((p) => p.player).every((p) => p.image && p.rotate === 180));
  const stone = pieces.find((p) => p.player === null);
  assert.equal(stone.size, 0.65);
  assert.equal(stone.shadow, false);
});
