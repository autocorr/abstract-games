import { test } from "node:test";
import assert from "node:assert/strict";
import game from "../games/portal-iv/game.js";
import { newGame } from "../common/engine.js";
import { pieceCode, findRoyals, WHITE, BLACK } from "../common/chess/rules.js";

const sq = (board, name) => board.cells.find((c) => c.tags.name === name).id;
const name = (board, id) => board.cells[id].tags.name;
const play = (s, ...ms) => {
  for (const m of ms) {
    const move = m.split("-").map((n) => sq(s.board, n));
    assert.ok(s.moves.some((x) => x[0] === move[0] && x[1] === move[1]), `${m} should be legal`);
    game.applyMove(s, move);
  }
};
const targets = (s, at) => game.legalMoves(s).filter((m) => Array.isArray(m) && m[0] === sq(s.board, at)).map((m) => name(s.board, m[1])).sort();

// A custom position: { e1: "wK", e8: "bR", ... }, portals { 1: "e2", 2: "c7" }.
function position(pieces, { turn = WHITE, portals = {}, castling = 0 } = {}) {
  const s = newGame(game, {});
  s.cells.fill(0);
  for (const [at, code] of Object.entries(pieces)) {
    s.cells[sq(s.board, at)] = pieceCode(s.board.chess.byKey[code.slice(1)], code[0] === "w" ? WHITE : BLACK);
  }
  s.royal = findRoyals(s.board, s.cells);
  s.portals = [-1, portals[1] ? sq(s.board, portals[1]) : -1, portals[2] ? sq(s.board, portals[2]) : -1];
  s.turn = turn;
  s.castling = castling;
  return game.refresh(s);
}

test("each move puts the mover's portal on the square it left", () => {
  const s = newGame(game, {});
  play(s, "e2-e4");
  assert.equal(name(s.board, s.portals[WHITE]), "e2");
  assert.equal(s.portals[BLACK], -1);
  play(s, "c7-c5", "g1-f3");
  assert.equal(name(s.board, s.portals[WHITE]), "g1");
  assert.equal(name(s.board, s.portals[BLACK]), "c7");
});

test("a lone portal can't be entered", () => {
  const s = position({ e1: "wK", e8: "bK", d5: "bR" }, { turn: BLACK, portals: { 1: "d3" } });
  assert.deepEqual(targets(s, "d5").filter((t) => t[0] === "d"), ["d4", "d6", "d7", "d8"]);
});

test("a King steps through a portal to the square past the other", () => {
  const s = position({ e1: "wK", h8: "bK" }, { portals: { 1: "a3", 2: "e2" } });
  // North onto e2, out of a3, on to a4.
  assert.deepEqual(targets(s, "e1"), ["a4", "d1", "d2", "f1", "f2"]);
});

test("a Rook keeps sliding out of the far portal, and a Knight leaps again", () => {
  const s = position({ a1: "wR", b1: "wN", h1: "wK", h8: "bK" }, { portals: { 1: "a4", 2: "f5" } });
  // Up the a-file: a2, a3, then a4 leads out of f5 to f6, f7, f8.
  assert.deepEqual(targets(s, "a1").filter((t) => t !== "b1" && t[1] !== "1"), ["a2", "a3", "f6", "f7", "f8"]);
  const k = position({ b1: "wN", h1: "wK", h8: "bK" }, { portals: { 1: "c3", 2: "e4" } });
  // b1-c3 lands on a portal: out of e4 by the same leap, to f6.
  assert.deepEqual(targets(k, "b1"), ["a3", "d2", "f6"]);
});

test("a step can't be taken when the way on from the far portal is off the board", () => {
  const s = position({ e1: "wK", h8: "bK" }, { portals: { 1: "a8", 2: "e2" } });
  assert.ok(!targets(s, "e1").includes("a9"));
  assert.deepEqual(targets(s, "e1"), ["d1", "d2", "f1", "f2"]);
});

test("a line that comes round to its own square ends there", () => {
  const s = position({ e3: "wR", a1: "wK", h8: "bK" }, { portals: { 1: "e2", 2: "e5" } });
  // North: e4, then e5 leads out of e2 to e3, the Rook itself. South: e2
  // leads out of e5 to e4, then e3 again.
  assert.deepEqual(targets(s, "e3").filter((t) => t[0] === "e"), ["e4"]);
});

test("check works through the portals", () => {
  // The Queen on d1 sees e8 through e2 and d7.
  const s = position({ e1: "wK", d1: "wQ", e8: "bK" }, { turn: BLACK, portals: { 1: "e2", 2: "d7" } });
  assert.match(game.turnHint(s, null), /Check!/);
});

test("a move may not leave your King attacked once your portal moves", () => {
  // After 1.e4, Black's d-pawn may not move: its portal on d7 would let the
  // Queen through e2 and d7 to e8.
  const s = newGame(game, {});
  play(s, "e2-e4");
  assert.deepEqual(targets(s, "d7"), []);
});

test("from the opening: 1.e4 c5 lets the Queen mate on d8 through the portals", () => {
  const s = newGame(game, {});
  play(s, "e2-e4", "c7-c5");
  assert.deepEqual(targets(s, "d1"), ["d8"]);
  const move = [sq(s.board, "d1"), sq(s.board, "d8")];
  // Kxd8 would put the vermilion portal on e8, and the King on e1 sees d8
  // through d1 and e8.
  assert.equal(game.moveText(s, move), "Qxd8#");
});

test("en passant through a portal takes the pawn that double-stepped", () => {
  // Black's pawn on c7 double-steps: c6, then c5. White's b5 pawn takes on c6.
  const s = position({ b5: "wP", e1: "wK", c7: "bP", h8: "bK" }, { turn: BLACK, portals: { 1: "a1" } });
  play(s, "c7-c5");
  assert.equal(name(s.board, s.ep), "c6");
  const move = [sq(s.board, "b5"), sq(s.board, "c6")];
  assert.equal(game.moveText(s, move), "bxc6");
  game.applyMove(s, move);
  assert.equal(s.cells[sq(s.board, "c5")], 0);
});

test("no castling with a portal between the King and Rook", () => {
  const open = position({ e1: "wK", h1: "wR", e8: "bK" }, { castling: 1, portals: { 2: "a5" } });
  assert.ok(targets(open, "e1").includes("g1"));
  const shut = position({ e1: "wK", h1: "wR", e8: "bK" }, { castling: 1, portals: { 1: "a5", 2: "f1" } });
  assert.ok(!targets(shut, "e1").includes("g1"));
});
