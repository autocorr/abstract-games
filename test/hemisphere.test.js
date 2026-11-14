import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/hemisphere/game.js";
import { newGame } from "../common/engine.js";
import { seededRng } from "../common/rng.js";

const { BOARDS, hasLoop, winningLoop } = internals;
const SIZES = BOARDS.map(([size]) => size);

// Play `red` and `blue` cells in turn (Red first); returns the state.
function play(s, red, blue) {
  for (let i = 0; i < red.length; i++) {
    game.applyMove(s, [red[i]]);
    if (i < blue.length && !s.winner) game.applyMove(s, [blue[i]]);
  }
  return s;
}

test("the boards have an even number of cells", () => {
  for (const cells of SIZES) {
    assert.equal(newGame(game, { cells }).board.size, cells);
    assert.equal(cells % 2, 0);
  }
});

test("a full board holds a loop for exactly one player", () => {
  const rng = seededRng(7);
  for (const cells of SIZES) {
    const { board } = newGame(game, { cells });
    for (let k = 0; k < 200; k++) {
      const fill = Uint8Array.from({ length: board.size }, () => 1 + Math.floor(rng() * 2));
      assert.notEqual(hasLoop(board, fill, 1), hasLoop(board, fill, 2), `${cells} cells, fill ${k}`);
    }
  }
});

test("a loop through the rim wins as its last stone is placed", () => {
  for (const cells of SIZES) {
    const s = newGame(game, { cells });
    const loop = winningLoop(s.board, new Uint8Array(s.board.size).fill(1), 1);
    const others = s.board.cells.map((c) => c.id).filter((id) => !loop.includes(id));
    play(s, loop.slice(0, -1), others);
    assert.equal(s.winner, null, `${cells}: no win before the loop closes`);
    game.applyMove(s, [loop.at(-1)]);
    assert.deepEqual(game.outcome(s), { winner: 1 });
    assert.deepEqual(game.legalMoves(s), []);
    const outlined = game.markers(s).filter((m) => m.kind === "square").map((m) => m.id);
    assert.deepEqual(outlined.sort((a, b) => a - b), loop.slice().sort((a, b) => a - b));
  }
});

test("a loop around the centre can be shrunk to a point and does not win", () => {
  const s = newGame(game, { cells: 46 });
  const centre = s.board.cells.find((c) => c.tags.name === "1").id;
  const ring = s.board.neighbours[centre];
  const far = s.board.cells.map((c) => c.id).filter((id) => id !== centre && !ring.includes(id));
  play(s, ring, far);
  assert.equal(s.winner, null);
  assert.ok(ring.every((id) => s.cells[id] === 1));
});

test("the incremental check agrees with a fresh one after every move", () => {
  const rng = seededRng(3);
  for (const cells of SIZES) {
    for (let k = 0; k < 20; k++) {
      const s = newGame(game, { cells });
      while (!game.outcome(s)) {
        const moves = game.legalMoves(s);
        const mover = game.toMove(s);
        game.applyMove(s, moves[Math.floor(rng() * moves.length)]);
        assert.equal(s.winner === mover, hasLoop(s.board, s.cells, mover));
        assert.ok(!hasLoop(s.board, s.cells, 3 - mover));
      }
    }
  }
});

test("the playout's winner is who would make a loop first", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = newGame(game, { cells: 46 });
    play(s, [0, 5], [9]);
    const a = game.clone(s), b = game.clone(s);
    const winner = game.playout(a, seededRng(seed));
    // Replay the same fill as moves.
    const order = [...a.cells.keys()].filter((id) => !s.cells[id]);
    const byTurn = [order.filter((id) => a.cells[id] === game.toMove(s)), order.filter((id) => a.cells[id] !== game.toMove(s))];
    for (let i = 0; !b.winner; i++) game.applyMove(b, [byTurn[i % 2][i >> 1]]);
    assert.equal(b.winner, winner);
  }
});

test("swap hands Red's opening to Blue", () => {
  const s = newGame(game, { cells: 46 });
  game.applyMove(s, [4]);
  assert.ok(game.legalMoves(s).includes("swap"));
  game.applyMove(s, "swap");
  assert.equal(s.cells[4], 2);
  assert.equal(game.toMove(s), 1);
});

