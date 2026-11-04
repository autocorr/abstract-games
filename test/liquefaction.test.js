import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/liquefaction/game.js";
import { newGame, replay, moveKey, CHANCE } from "../common/engine.js";
import { bagSize } from "../common/bag.js";
import { seededRng } from "../common/rng.js";
import { describeMove } from "../common/log.js";

const { make, P, N, B, R, K, WHITE, BLACK } = internals;
const TYPES = { P, N, B, R, K };

// Square name -> id on an n x n board.
const sq = (board, name) => board.cells.find((c) => c.tags.name === name).id;
const name = (board, id) => board.cells[id].tags.name;
const keys = (board, moves) => moves.map((m) => (Array.isArray(m) ? m.map((id) => name(board, id)).join("-") : m)).sort();

// A custom position: pieces like { e1: "wK", e8: "bK" }, then `turn` draws
// `colour`. The bag holds 5 marbles including at least one of `colour`.
function position(size, pieces, { turn = WHITE, colour = "B", castling = 0, ep = null } = {}) {
  const s = newGame(game, { size, bag: "fixed" });
  s.cells.fill(0);
  for (const [at, code] of Object.entries(pieces)) {
    const id = sq(s.board, at);
    const player = code[0] === "w" ? WHITE : BLACK;
    s.cells[id] = make(TYPES[code[1]], player);
    if (code[1] === "K") s.kings[player - 1] = id;
  }
  s.turn = turn;
  s.castling = castling;
  s.ep = ep ? sq(s.board, ep) : -1;
  s.bag = { counts: { A: 1, B: 1, C: 1, D: 1 }, drawn: [] };
  s.bag.counts[colour]++;
  game.applyMove(s, "draw:" + colour);
  return s;
}

const movesFrom = (s, from) => keys(s.board, game.legalMoves(s).filter((m) => Array.isArray(m) && m[0] === sq(s.board, from)));

test("square classes follow the Dabbaba sub-grids", () => {
  for (const size of [6, 8]) {
    const board = game.createBoard({ size });
    const cls = (n) => board.chess.cls[sq(board, n)];
    assert.deepEqual(["a1", "b1", "a2", "b2", "c3", "d4"].map(cls), ["A", "B", "C", "D", "A", "D"]);
  }
});

test("each colour scheme keeps the checkerboard: dark A/D, light B/C", () => {
  const board = game.createBoard({ size: 8 });
  for (const scheme of Object.values(game.colorSchemes)) {
    const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, b) => a + b);
    for (const c of board.cells) {
      const quad = c.tags.quad;
      const other = board.cells.find((d) => d.tags.dark !== c.tags.dark);
      assert.ok(c.tags.dark === (quad === 0 || quad === 3));
      if (c.tags.dark) assert.ok(lum(scheme.cellFill(c)) < lum(scheme.cellFill(other)));
    }
    assert.deepEqual(Object.keys(scheme.marbles), ["A", "B", "C", "D"]);
  }
});

test("starting positions and fixed bags give each King's colour once", () => {
  for (const [size, wk, bk] of [[6, "d1", "d6"], [8, "e1", "e8"]]) {
    const s = newGame(game, { size, bag: "fixed" });
    const geo = s.board.chess;
    assert.equal(name(s.board, s.kings[0]), wk);
    assert.equal(name(s.board, s.kings[1]), bk);
    assert.equal(s.bag.counts[geo.cls[s.kings[0]]], 1);
    assert.equal(s.bag.counts[geo.cls[s.kings[1]]], 1);
    assert.equal(bagSize(s.bag), 5);
    assert.equal(game.toMove(s), CHANCE);
    // No Queens, and the Queen's square is empty.
    assert.ok(!Array.from(s.cells).some((x) => (x & 7) === 5));
    assert.equal(s.cells[sq(s.board, size === 6 ? "c1" : "d1")], 0);
  }
  const small = newGame(game, { size: 6 });
  assert.deepEqual(["a1", "b1", "c1", "d1", "e1", "f1"].map((n) => small.cells[sq(small.board, n)]),
    [make(N, WHITE), make(B, WHITE), 0, make(K, WHITE), make(B, WHITE), make(N, WHITE)]);
});

test("random bag: 5 fill plies from the supply before White's draw", () => {
  const s = newGame(game, { size: 6, bag: "random" });
  assert.equal(bagSize(s.bag), 0);
  const first = game.chances(s);
  assert.deepEqual(first.map((o) => [o.move, o.p]), [["fill:A", 0.25], ["fill:B", 0.25], ["fill:C", 0.25], ["fill:D", 0.25]]);
  game.applyMove(s, "fill:A");
  assert.equal(game.chances(s).find((o) => o.move === "fill:A").p, 4 / 19);
  for (const c of ["A", "A", "A", "A"]) game.applyMove(s, "fill:" + c);
  assert.equal(bagSize(s.bag), 5);
  assert.deepEqual(game.chances(s), [{ move: "draw:A", p: 1 }]);
});

test("the bag keeps 5 marbles; the new one matches the landing square", () => {
  const s = newGame(game, { size: 6 });
  game.applyMove(s, "draw:A");
  assert.equal(bagSize(s.bag), 4);
  const b = s.board;
  game.applyMove(s, [sq(b, "a2"), sq(b, "a3")]);   // a3: odd file, odd rank = A
  assert.equal(bagSize(s.bag), 5);
  assert.deepEqual(s.bag.counts, { A: 2, B: 1, C: 1, D: 1 });
  game.applyMove(s, "draw:B");
  game.applyMove(s, [sq(b, "b5"), sq(b, "b4")]);   // b4: even, even = D
  assert.deepEqual(s.bag.counts, { A: 2, B: 0, C: 1, D: 2 });
});

test("a colour-checked King must step off its colour", () => {
  // King on d1 (B) with B drawn: only King moves (the Knight is stuck), and
  // none onto B. Its neighbours are c1, e1 (A), c2, e2 (C) and d2 (D).
  const s = position(6, { d1: "wK", a1: "wN", f6: "bK" }, { colour: "B" });
  const moves = keys(s.board, game.legalMoves(s));
  assert.deepEqual(moves, ["d1-c1", "d1-c2", "d1-d2", "d1-e1", "d1-e2"]);
});

test("the King may not move onto the drawn colour", () => {
  const s = position(6, { d1: "wK", f6: "bK" }, { colour: "A" });
  assert.deepEqual(movesFrom(s, "d1"), ["d1-c2", "d1-d2", "d1-e2"]);   // c1, e1 are A
});

test("normal check still applies alongside the colour-check", () => {
  // Rook on d6 checks d1; the King must leave the d-file and avoid C (c2, e2).
  const s = position(6, { d1: "wK", d6: "bR", a6: "bK" }, { colour: "C" });
  assert.deepEqual(keys(s.board, game.legalMoves(s)), ["d1-c1", "d1-e1"]);
});

test("no legal move after the draw loses, whatever the reason", () => {
  // Colour-mate: King on a1 (A), not in check, with A drawn. The Rook on b6
  // covers b1 and b2, the Bishop on c4 covers a2, and the Knight may not
  // move because the King has to.
  const pieces = { a1: "wK", e1: "wN", b6: "bR", c4: "bB", f6: "bK" };
  const mate = position(6, pieces, { colour: "A" });
  assert.equal(game.outcome(mate).winner, BLACK);
  assert.equal(mate.reason, "colourmate");
  assert.deepEqual(game.legalMoves(mate), []);

  // The same position with another colour drawn is not over: a1 is not checked.
  const ok = position(6, pieces, { colour: "D" });
  assert.equal(game.outcome(ok), null);

  // Stalemate loses: White King a1, no colour or normal check, but boxed in.
  const stale = position(6, { a1: "wK", c2: "bR", b3: "bR", f6: "bK" }, { colour: "D" });
  assert.equal(stale.reason, "stalemate");
  assert.equal(game.outcome(stale).winner, BLACK);
});

test("promotion offers Knight, Bishop or Rook, and the marble follows the square", () => {
  const s = position(6, { a5: "wP", d1: "wK", f4: "bK" }, { colour: "D" });
  game.applyMove(s, [sq(s.board, "a5"), sq(s.board, "a6")]);
  assert.equal(game.toMove(s), WHITE);
  assert.deepEqual(game.legalMoves(s), ["promote:N", "promote:B", "promote:R"]);
  const before = { ...s.bag.counts };
  game.applyMove(s, "promote:R");
  assert.equal(s.cells[sq(s.board, "a6")], make(R, WHITE));
  assert.equal(s.bag.counts.C, before.C + 1);   // a6: odd file, even rank
  assert.equal(game.toMove(s), CHANCE);
});

test("6x6: no double step and no castling", () => {
  const s = newGame(game, { size: 6 });
  game.applyMove(s, "draw:C");
  assert.deepEqual(movesFrom(s, "b2"), ["b2-b3"]);
  assert.equal(s.castling, 0);
});

test("8x8 castling: through the drawn colour is fine, not while colour-checked", () => {
  const pieces = { e1: "wK", h1: "wR", a1: "wR", e8: "bK" };
  // B drawn: f1 (B) is passed over, g1 (A) is the destination.
  let s = position(8, pieces, { colour: "B", castling: 15 });
  assert.ok(movesFrom(s, "e1").includes("e1-g1"));
  assert.ok(movesFrom(s, "e1").includes("e1-c1"));   // d1 (B) passed over
  // A drawn: e1 is colour-checked, so no castling.
  s = position(8, pieces, { colour: "A", castling: 15 });
  assert.ok(!movesFrom(s, "e1").includes("e1-g1"));
  assert.ok(!movesFrom(s, "e1").includes("e1-c1"));
  // An attacked f1 still forbids short castling.
  s = position(8, { ...pieces, f8: "bR" }, { colour: "D", castling: 15 });
  assert.ok(!movesFrom(s, "e1").includes("e1-g1"));
  assert.ok(movesFrom(s, "e1").includes("e1-c1"));
  // Castling moves the rook and drops the rights.
  s = position(8, pieces, { colour: "D", castling: 15 });
  game.applyMove(s, [sq(s.board, "e1"), sq(s.board, "g1")]);
  assert.equal(s.cells[sq(s.board, "f1")], make(R, WHITE));
  assert.equal(s.cells[sq(s.board, "h1")], 0);
  assert.equal(s.castling & 3, 0);
});

test("8x8 en passant", () => {
  const s = newGame(game, { size: 8 });
  const b = s.board;
  const play = (...ms) => { for (const m of ms) game.applyMove(s, typeof m === "string" && !m.includes("-") ? m : m.split("-").map((n) => sq(b, n))); };
  play("draw:B", "e2-e4", "draw:B", "a7-a6", "draw:C", "e4-e5", "draw:A", "d7-d5");
  play("draw:B");
  assert.ok(movesFrom(s, "e5").includes("e5-d6"));
  play("e5-d6");
  assert.equal(s.cells[sq(b, "d5")], 0);
  assert.equal(s.clock, 0);
});

test("the 50-move rule draws after 100 plies without capture or pawn move", () => {
  const s = position(6, { a1: "wK", a3: "wN", f6: "bK", f4: "bN" }, { colour: "D" });
  s.clock = 99;
  game.applyMove(s, [sq(s.board, "a3"), sq(s.board, "b5")]);
  assert.deepEqual(game.outcome(s), { winner: 0 });
  assert.equal(s.reason, "fifty");
});

test("the playout ends the game and agrees with outcome()", () => {
  for (const size of [6, 8]) {
    for (let seed = 1; seed <= 5; seed++) {
      const s = newGame(game, { size });
      const winner = game.playout(s, seededRng(seed));
      assert.equal(winner, game.outcome(s).winner);
    }
  }
});

test("moves round-trip through replay, including promotion choices", () => {
  const rng = seededRng(7);
  const s = newGame(game, { size: 6, bag: "random" });
  const moves = [];
  while (!game.outcome(s) && moves.length < 400) {
    const legal = game.legalMoves(s);
    const m = game.toMove(s) === CHANCE
      ? game.chances(s)[Math.floor(rng() * game.chances(s).length)].move
      : legal[Math.floor(rng() * legal.length)];
    game.applyMove(s, m);
    moves.push(m);
  }
  const r = replay(game, { size: 6, bag: "random" }, moves.map(moveKey).map((k) => (/^\d+(-\d+)*$/.test(k) ? k.split("-").map(Number) : k)));
  assert.deepEqual(Array.from(r.state.cells), Array.from(s.cells));
});

test("the drawn colour's squares are hatched until the move is made", () => {
  const s = position(6, { d1: "wK", a3: "wN", f6: "bK" }, { colour: "A" });
  const shaded = () => game.markers(s).filter((m) => m.kind === "shade").map((m) => s.board.chess.cls[m.id]);
  assert.deepEqual(shaded(), Array(9).fill("A"));   // a quarter of 36 squares
  game.applyMove(s, [sq(s.board, "a3"), sq(s.board, "b5")]);
  assert.deepEqual(shaded(), []);
});

test("log text uses algebraic notation", () => {
  const s = position(8, {
    e1: "wK", a1: "wR", h1: "wR", b1: "wN", f3: "wN", h3: "wN", h5: "wN", e4: "wP", e8: "bK", d5: "bP",
  }, { colour: "D", castling: 15 });
  const text = (move) => describeMove(game, s, move.split("-").map((n) => sq(s.board, n)), null);
  assert.equal(text("e1-g1"), "O-O");
  assert.equal(text("e1-c1"), "O-O-O");
  assert.equal(text("e4-d5"), "exd5");
  assert.equal(text("e4-e5"), "e5");
  assert.equal(text("b1-d2"), "Nbd2");     // the f3 Knight could also go to d2
  assert.equal(text("h3-f4"), "N3f4");     // so could the h5 Knight, on the same file
  assert.equal(text("a1-a8"), "Ra8+");
  assert.equal(describeMove(game, s, "promote:R", null), "=R");
  const scheme = Object.values(game.colorSchemes)[0];
  assert.equal(describeMove(game, s, "fill:A", null, scheme), `added ${scheme.marbles.A.name.toLowerCase()}`);
  assert.equal(describeMove(game, s, "draw:A", null, scheme), `drew ${scheme.marbles.A.name.toLowerCase()}`);
});
