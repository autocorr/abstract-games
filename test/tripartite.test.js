import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals, sideColor } from "../games/tripartite/game.js";
import { newGame } from "../common/engine.js";
import { seededRng } from "../common/rng.js";

const { scores } = internals;

// An empty side-4 board with stones at axial coords [q, r].
function position({ black = [], white = [] } = {}) {
  const s = newGame(game, { size: 4, komi: 2.5 });
  const at = ([q, r]) => s.board.at(q, r);
  for (const c of black) s.cells[at(c)] = 1;
  for (const c of white) s.cells[at(c)] = 2;
  return { s, at, score: () => scores(s.board, s.cells) };
}

test("the cells are checkered: no two neighbors share a color", () => {
  const { board } = newGame(game, { size: 7, komi: 5.5 });
  for (const c of board.cells) for (const n of board.neighbours[c.id]) assert.notEqual(board.color[c.id], board.color[n]);
});

test("opposite sides share a color, and the three pairs differ", () => {
  for (let d = 0; d < 3; d++) assert.equal(sideColor(d), sideColor(d + 3));
  assert.deepEqual(new Set([0, 1, 2].map(sideColor)).size, 3);
});

test("a group off the edges scores nothing", () => {
  const { score } = position({ black: [[0, 0], [1, 0], [0, 1]] });
  assert.deepEqual(score(), [0, 0, 0]);
});

test("a group on one side scores its stones matching that side's color", () => {
  // Side 0 runs between the E corner (3, 0) and the NE corner (3, -3): q = 3.
  const { s, at, score } = position({ black: [[3, -1], [3, -2], [2, -1]] });
  assert.deepEqual(s.board.cells[at([3, -1])].tags.edges, [0]);
  const want = [[3, -1], [3, -2], [2, -1]].filter((c) => s.board.color[at(c)] === sideColor(0)).length;
  assert.equal(score()[1], want);
});

test("a group scores separately for every side it touches, corners on two", () => {
  // The E corner (3, 0) lies on sides 0 and 5.
  const { s, at, score } = position({ white: [[3, 0]] });
  assert.deepEqual(s.board.cells[at([3, 0])].tags.edges.sort(), [0, 5]);
  const color = s.board.color[at([3, 0])];
  const want = [0, 5].filter((d) => sideColor(d) === color).length;
  assert.equal(score()[2], want);
  // A line from W to E touches two opposite sides of one color and counts twice.
  const line = [-3, -2, -1, 0, 1, 2, 3].map((q) => [q, 0]);
  const p = position({ black: line });
  const sides = new Set(line.flatMap((c) => p.s.board.cells[p.at(c)].tags.edges));
  let expected = 0;
  for (const d of sides) expected += line.filter((c) => p.s.board.color[p.at(c)] === sideColor(d)).length;
  assert.equal(p.score()[1], expected);
  assert.ok(sides.has(2) || sides.has(3));
});

test("the game ends when the board is full and komi decides close games", () => {
  const s = newGame(game, { size: 4, komi: 2.5 });
  game.playout(s, seededRng(7));
  assert.equal(s.empty, 0);
  assert.deepEqual(game.legalMoves(s), []);
  const t = scores(s.board, s.cells);
  assert.equal(game.outcome(s).winner, t[1] > t[2] + 2.5 ? 1 : 2);
  assert.equal(s.cells.filter((p) => p === 1).length, 19, "Black places the extra stone");
});

test("the edge bands follow the color scheme, opposite sides alike", () => {
  const board = game.createBoard({ size: 5, komi: 5.5 });
  for (const scheme of Object.values(game.colorSchemes)) {
    const fills = game.boardDecor(board, scheme).map((d) => d.fill);
    assert.equal(fills.length, 6);
    for (let d = 0; d < 6; d++) assert.equal(fills[d], scheme.edges[sideColor(d)]);
  }
  assert.deepEqual(game.boardDecor(board, null), game.boardDecor(board, Object.values(game.colorSchemes)[0]));
});
