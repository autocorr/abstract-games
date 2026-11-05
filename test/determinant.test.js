import { test } from "node:test";
import assert from "node:assert/strict";
import game from "../games/determinant/game.js";
import { newGame, replay, CHANCE } from "../common/engine.js";
import { seededRng } from "../common/rng.js";

const N = 7;
const at = (col, row) => row * N + col;
const opts = { size: N };

// Play a list of moves, accepting [col, row] pairs for points.
function play(moves) {
  return replay(game, opts, moves.map((m) => (Array.isArray(m) ? [at(...m)] : m))).state;
}

// Stones placed far apart so that no cross-cuts arise, alternating colours.
const QUIET = [[0, 0], [6, 6], [2, 0], [4, 6], [6, 0], [0, 6]];

function hasCut(s) {
  return s.board.patches.some(([a, b, c, d]) =>
    s.cells[a] && s.cells[b] && s.cells[a] !== s.cells[b] && s.cells[d] === s.cells[a] && s.cells[c] === s.cells[b]);
}

test("the bag starts with three white and two black marbles; Black moves first", () => {
  const s = newGame(game, opts);
  assert.deepEqual(s.bag.counts, { B: 2, W: 3 });
  assert.equal(game.toMove(s), 1);
  assert.equal(game.legalMoves(s).length, N * N);
});

test("White may swap on their first turn only: the position is mirrored and recoloured", () => {
  assert.ok(game.legalMoves(play([[1, 4]])).includes("swap"));
  const s = play([[1, 4], "swap"]);
  assert.equal(s.cells[at(1, 4)], 0);
  assert.equal(s.cells[at(4, 1)], 2, "Black's stone is reflected across the diagonal and turns white");
  assert.equal(s.cells.filter(Boolean).length, 1);
  assert.equal(s.placed, at(4, 1));
  assert.deepEqual(s.bag.counts, { B: 3, W: 2 }, "the marble colours are exchanged");
  assert.equal(game.toMove(s), 1, "Black moves next");
  assert.ok(!game.legalMoves(s).includes("swap"));
  assert.ok(!game.legalMoves(play([[1, 4], [3, 3]])).includes("swap"));
});

test("a cross-cut leads to a draw, and the drawn colour resolves", () => {
  // Black a1 and b2, White b1; White a2 makes the cut.
  const base = [[0, 0], [1, 0], [1, 1]];
  let s = play(base);
  assert.equal(game.toMove(s), 2);
  s = play([...base, [0, 1]]);
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), 2);
  assert.deepEqual(game.chances(s).map((o) => o.p), [0.4, 0.6]);

  // Black wins the draw: may replace either white stone in the cut.
  const b = play([...base, [0, 1], "draw:B"]);
  assert.equal(game.toMove(b), 1);
  assert.deepEqual(game.legalMoves(b).map((m) => m[0]).sort(), [at(1, 0), at(0, 1)].sort());
  assert.deepEqual(b.bag.counts, { B: 1, W: 4 });
  const after = play([...base, [0, 1], "draw:B", [0, 1]]);
  assert.equal(after.cells[at(0, 1)], 1);
  assert.equal(game.toMove(after), 1, "Black's turn follows White's");
  assert.ok(!hasCut(after));

  // White wins the draw: may replace either black stone, the bag gains a black.
  const w = play([...base, [0, 1], "draw:W"]);
  assert.equal(game.toMove(w), 2);
  assert.deepEqual(w.bag.counts, { B: 3, W: 2 });
  assert.deepEqual(game.legalMoves(w).map((m) => m[0]).sort(), [at(0, 0), at(1, 1)].sort());
});

test("replacements cascade: the resolver keeps going while cross-cuts remain", () => {
  const B = 1, W = 2;
  const s = newGame(game, opts);
  // Patch a1-b2 holds W a1, B b1, B a2, B b2: one flip of b2 away from a cut.
  for (const [c, r, p] of [[0, 0, W], [1, 0, B], [0, 1, B], [1, 1, B], [2, 1, W], [1, 2, W]]) s.cells[at(c, r)] = p;
  // Black c3 makes the cut b2/c3 (black) against c2/b3 (white).
  game.applyMove(s, [at(2, 2)]);
  assert.equal(s.phase, "draw");
  game.applyMove(s, "draw:W");
  // White resolving in Black's turn is not offered the swap.
  assert.deepEqual(game.legalMoves(s).map((m) => m[0]).sort((a, b) => a - b), [at(1, 1), at(2, 2)]);
  // Turning b2 white resolves that cut but makes a1-b2 one; White goes on.
  game.applyMove(s, [at(1, 1)]);
  assert.equal(s.phase, "resolve");
  assert.equal(game.toMove(s), W);
  assert.deepEqual(game.legalMoves(s).map((m) => m[0]).sort((a, b) => a - b), [at(1, 0), at(0, 1)]);
  game.applyMove(s, [at(1, 0)]);
  assert.equal(s.phase, "place");
  assert.equal(game.toMove(s), W, "White's turn follows Black's");
  assert.deepEqual(s.flipped, [at(1, 1), at(1, 0)]);
  assert.ok(!hasCut(s));
});

test("one draw resolves several cross-cuts made by one stone", () => {
  const s = newGame(game, opts);
  // Black diagonals around (3,3), white orthogonals: a black stone at (3,3)
  // makes four cross-cuts.
  for (const [c, r] of [[2, 2], [4, 2], [2, 4], [4, 4]]) s.cells[at(c, r)] = 1;
  for (const [c, r] of [[3, 2], [2, 3], [4, 3], [3, 4]]) s.cells[at(c, r)] = 2;
  game.applyMove(s, [at(3, 3)]);
  assert.equal(s.cuts.length, 4);
  const w = game.clone(s);
  game.applyMove(w, "draw:W");
  assert.ok(game.legalMoves(w).some((m) => m[0] === at(3, 3)));
  game.applyMove(w, [at(3, 3)]);   // the shared stone resolves all four
  assert.equal(w.phase, "place");
  assert.ok(!hasCut(w));
  game.applyMove(s, "draw:B");
  let flips = 0;
  while (s.phase === "resolve") {
    game.applyMove(s, game.legalMoves(s)[0]);
    flips++;
  }
  assert.ok(flips >= 2);
  assert.ok(!hasCut(s));
});

test("a connection wins at the end of the turn, for either player", () => {
  const s = newGame(game, opts);
  for (let row = 0; row < N - 1; row++) s.cells[at(3, row)] = 1;
  s.turn = 1;
  game.applyMove(s, [at(3, N - 1)]);
  assert.deepEqual(game.outcome(s), { winner: 1 });
  assert.deepEqual(game.legalMoves(s), []);

  // A diagonal step does not connect.
  const d = newGame(game, opts);
  for (let row = 0; row < N - 1; row++) d.cells[at(row === N - 2 ? 4 : 3, row)] = 1;
  game.applyMove(d, [at(5, N - 1)]);
  assert.equal(game.outcome(d), null);
});

test("random games always end with a winner and never leave a cross-cut", () => {
  for (const size of [7, 8, 12]) {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = seededRng(seed);
      const s = newGame(game, { size });
      while (!game.outcome(s)) {
        const legal = game.legalMoves(s);
        assert.ok(legal.length, "no moves before the game ended");
        game.applyMove(s, legal[Math.floor(rng() * legal.length)]);
        if (s.phase === "place") assert.ok(!hasCut(s), "cross-cut left at the end of a turn");
        assert.equal(s.bag.counts.B + s.bag.counts.W, 5);
      }
    }
  }
});

test("playout ends with a winner", () => {
  const s = play(QUIET);
  const w = game.playout(game.clone(s), seededRng(3));
  assert.ok(w === 1 || w === 2);
});
