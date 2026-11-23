import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/runaway/game.js";
import { newGame } from "../common/engine.js";

const { settle, territory } = internals;

// An empty side-4 board (no starting chickens), White to move, with chickens
// and eggs placed at axial coords: eggs as [q, r, countdown].
function position({ white = [], black = [], whiteEggs = [], blackEggs = [], owned = [], movement = "slide", turn = 1 }) {
  const s = newGame(game, { size: 4, start: 1, movement, hatch: 3, swap: "off" });
  s.who.fill(0); s.egg.fill(0); s.owner.fill(0);
  const at = ([q, r]) => s.board.at(q, r);
  const put = (list, p) => { for (const c of list) { const id = at(c); s.who[id] = s.owner[id] = p; if (c[2]) s.egg[id] = c[2]; } };
  put(white, 1); put(black, 2); put(whiteEggs, 1); put(blackEggs, 2);
  for (const [q, r, p] of owned) s.owner[at([q, r])] = p;
  s.turn = turn;
  settle(s);
  return { s, at };
}

const targets = (s, from) => new Set(game.legalMoves(s).filter((m) => m[0] === from).map((m) => m[1]));

test("start: three chickens each on alternating corners, White to move", () => {
  const s = newGame(game, { size: 5, start: 3, movement: "slide", hatch: 3, swap: "off" });
  const corners = s.board.corners;
  assert.deepEqual(corners.map((id) => s.who[id]), [1, 2, 1, 2, 1, 2]);
  assert.equal(territory(s, 1), 3);
  assert.equal(game.toMove(s), 1);
});

test("a step goes to a neighbour; a slide runs over empty cells", () => {
  let { s, at } = position({ white: [[0, 0]], movement: "step" });
  assert.equal(targets(s, at([0, 0])).size, 6);
  ({ s, at } = position({ white: [[0, 0]] }));
  assert.equal(targets(s, at([0, 0])).size, 18, "three cells in each of six directions");
});

test("eggs block and cannot be captured; owned empty cells are crossed, not landed on", () => {
  const { s, at } = position({
    white: [[0, 0]], blackEggs: [[1, 0, 2]], owned: [[0, -1, 2]],
  });
  const t = targets(s, at([0, 0]));
  assert.ok(!t.has(at([1, 0])) && !t.has(at([2, 0])), "the egg blocks the row");
  assert.ok(!t.has(at([0, -1])), "an owned empty cell is no landing");
  assert.ok(t.has(at([0, -2])), "but may be crossed");
});

test("a plain move lays an egg; a capture lays none", () => {
  const { s, at } = position({ white: [[0, 0], [-3, 0]], black: [[2, 0], [3, -3]] });
  game.applyMove(s, [at([0, 0]), at([0, 1])]);
  assert.equal(s.who[at([0, 0])], 1);
  assert.equal(s.egg[at([0, 0])], 3);
  assert.equal(s.owner[at([0, 1])], 1);
  game.applyMove(s, [at([3, -3]), at([3, -2])]);   // Black
  // White's egg counted down at the start of White's turn.
  assert.equal(s.egg[at([0, 0])], 2);
  game.applyMove(s, [at([0, 1]), at([2, -1])]);
  game.applyMove(s, [at([3, -2]), at([3, -1])]);   // Black
  const cap = game.applyMove(s, [at([2, -1]), at([2, 0])]);
  assert.equal(cap.capture, true);
  assert.equal(s.who[at([2, -1])], 0, "no egg behind a capture");
  assert.equal(s.owner[at([2, -1])], 1, "the cell left stays White's");
  assert.equal(s.owner[at([2, 0])], 1);
});

test("an egg hatches at the start of its owner's third turn and moves at once", () => {
  const { s, at } = position({ white: [[0, 0]], black: [[3, -3]], movement: "step" });
  const egg = at([0, 0]);
  game.applyMove(s, [egg, at([0, 1])]);
  const blackHop = () => game.applyMove(s, game.legalMoves(s).find(Array.isArray));
  blackHop();
  assert.equal(s.egg[egg], 2);
  game.applyMove(s, [at([0, 1]), at([0, 2])]);
  blackHop();
  assert.equal(s.egg[egg], 1);
  game.applyMove(s, [at([0, 2]), at([0, 3])]);
  blackHop();
  assert.equal(s.egg[egg], 0, "hatched");
  assert.ok(game.legalMoves(s).some((m) => m[0] === egg), "the new chicken can move");
});

test("capturing the last chicken with no eggs left annihilates", () => {
  const { s, at } = position({ white: [[0, 0]], black: [[1, 0]] });
  game.applyMove(s, [at([0, 0]), at([1, 0])]);
  assert.deepEqual(game.outcome(s), { winner: 1 });
  assert.equal(s.reason, "annihilated");
});

test("a player with no move passes; the game ends by territory when nobody can move", () => {
  // White's chicken boxed in by Black eggs; Black has a chicken with one cell to go.
  const { s, at } = position({
    white: [[-3, 0]],
    blackEggs: [[-2, 0, 1], [-3, 1, 1], [-2, -1, 1]],
    black: [[3, -3]],
  });
  assert.deepEqual(game.legalMoves(s), ["pass"]);
  game.applyMove(s, "pass");
  assert.equal(game.toMove(s), 2);
  assert.ok(territory(s, 2) > territory(s, 1));
});

test("captures only a neighbouring chicken, even when sliding", () => {
  const { s, at } = position({ white: [[0, 0]], black: [[3, 0], [0, 1]] });
  const t = targets(s, at([0, 0]));
  assert.ok(t.has(at([0, 1])), "a neighbour is captured");
  assert.ok(!t.has(at([3, 0])), "no capture at range");
  assert.ok(t.has(at([2, 0])), "but the slide runs up to it");
});

test("every opening position offers White no capture", () => {
  for (const size of [4, 5, 6, 7]) for (const start of [1, 3]) for (const movement of ["slide", "step"]) {
    const s = newGame(game, { size, start, movement, hatch: 3, swap: "off" });
    assert.ok(game.legalMoves(s).every((m) => !s.who[m[1]]), `${size} ${start} ${movement}`);
  }
});
