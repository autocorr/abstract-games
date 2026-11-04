import { test } from "node:test";
import assert from "node:assert/strict";
import game from "../games/depletion/game.js";
import { LAYOUTS, makeRegions } from "../games/depletion/regions.js";
import { rhombusBoard } from "../common/board/hex.js";
import { components } from "../common/board/graph.js";
import { newGame, replay, CHANCE } from "../common/engine.js";

const opts = (o = {}) => ({ size: 7, colours: 3, layout: "bands", ...o });

test("every layout gives contiguous regions within two cells of each other", () => {
  for (const { value } of LAYOUTS) {
    for (let n = 7; n <= 19; n++) {
      for (const k of [3, 4, 5]) {
        const board = rhombusBoard(n);
        const region = makeRegions(board, k, value);
        const sizes = new Array(k).fill(0);
        for (const r of region) sizes[r]++;
        const label = `${value} n=${n} k=${k}`;
        assert.ok(sizes.every((x) => x > 0), label);
        assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 2, `${label}: sizes ${sizes}`);
        for (let r = 0; r < k; r++) {
          assert.equal(components(board, (id) => region[id] === r).length, 1, `${label}: region ${r} split`);
        }
      }
    }
  }
});

test("the bag holds one marble per colour and a draw comes first", () => {
  const s = newGame(game, opts({ colours: 5 }));
  assert.deepEqual(s.bag.counts, { R: 1, B: 1, Y: 1, G: 1, P: 1 });
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), 1);
  assert.deepEqual(game.chances(s).map((o) => o.p), [0.2, 0.2, 0.2, 0.2, 0.2]);
});

test("the drawn colour restricts play to its region", () => {
  const { state } = replay(game, opts(), ["draw:B"]);
  const legal = game.legalMoves(state);
  const blue = state.board.regionCells[1];
  assert.equal(legal.length, blue.length);
  for (const [id] of legal) assert.equal(state.board.cells[id].tags.region, 1);
});

test("drawn marbles stay out until the bag is empty, then all return", () => {
  const s = newGame(game, opts());
  const play = (m) => game.applyMove(s, m);
  const anyIn = (r) => [s.board.regionCells[r].find((id) => !s.cells[id])];
  play("draw:Y"); play(anyIn(2));
  assert.deepEqual(s.bag.counts, { R: 1, B: 1, Y: 0 });
  play("draw:R"); play(anyIn(0));
  assert.deepEqual(game.chances(s), [{ move: "draw:B", p: 1 }]);
  play("draw:B"); play(anyIn(1));
  assert.deepEqual(s.bag, { counts: { R: 1, B: 1, Y: 1 }, drawn: [] });
  assert.equal(game.currentPlayer(s), 2, "with 3 colours the next cycle starts with White");
});

test("a full region forces a pass", () => {
  const s = newGame(game, opts());
  for (const id of s.board.regionCells[0]) s.cells[id] = 2;   // fill red (no win check needed)
  game.applyMove(s, "draw:R");
  assert.deepEqual(game.legalMoves(s), ["pass"]);
  assert.match(game.moveLabel(s, "pass"), /red region is full/);
  game.applyMove(s, "pass");
  assert.equal(game.currentPlayer(s), 2);
  assert.equal(game.toMove(s), CHANCE);
});

test("Black wins by joining top and bottom; White by joining left and right", () => {
  for (const [player, line] of [[1, (b, i) => b.at(3, i)], [2, (b, i) => b.at(i, 3)]]) {
    const s = newGame(game, opts());
    s.turn = player;
    const cells = Array.from({ length: 7 }, (_, i) => line(s.board, i));
    for (const id of cells.slice(0, 6)) s.cells[id] = player;
    // Play the last cell directly in its region.
    const last = cells[6];
    s.bag.counts = { R: 0, B: 0, Y: 0, [["R", "B", "Y"][s.board.cells[last].tags.region]]: 1 };
    game.applyMove(s, `draw:${["R", "B", "Y"][s.board.cells[last].tags.region]}`);
    assert.equal(game.outcome(s), null);
    game.applyMove(s, [last]);
    assert.deepEqual(game.outcome(s), { winner: player });
    assert.deepEqual(game.legalMoves(s), []);
  }
});

test("a chain touching only one side does not win", () => {
  const s = newGame(game, opts());
  const ids = [0, 1, 2, 3, 4, 5].map((r) => s.board.at(3, r));
  for (const id of ids.slice(0, 5)) s.cells[id] = 1;
  const region = s.board.cells[ids[5]].tags.region;
  const key = ["R", "B", "Y"][region];
  s.bag.counts = { R: 0, B: 0, Y: 0, [key]: 1 };
  game.applyMove(s, `draw:${key}`);
  game.applyMove(s, [ids[5]]);
  assert.equal(game.outcome(s), null);
});

test("goal edges are drawn for both players", () => {
  const decor = game.boardDecor(game.createBoard(opts()));
  assert.equal(decor.length, 2);
  for (const d of decor) assert.equal(d.segments.length, 28);
});
