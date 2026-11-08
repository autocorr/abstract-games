import { test } from "node:test";
import assert from "node:assert/strict";
import { squareBoard } from "../common/board/square.js";
import { KING, QUEEN, ROOK, KNIGHT, NIGHTRIDER, QUEEN_CANNON, pawn, images } from "../common/chess/movement.js";
import {
  attachRules, attacked, inCheck, legalMoves, playMove, notation, pieceCode, WHITE, BLACK,
} from "../common/chess/rules.js";

// A spec with one of each kind of mover; "M" is a royal that turns into "F"
// when it moves, and back.
const SPEC = {
  types: [
    { key: "P", name: "Pawn", letter: "", moves: pawn(), pawn: true, promote: ["Q"] },
    { key: "K", name: "King", letter: "K", moves: KING, royal: true },
    { key: "Q", name: "Queen", letter: "Q", moves: QUEEN },
    { key: "R", name: "Rook", letter: "R", moves: ROOK, castler: true },
    { key: "N", name: "Knight", letter: "N", moves: KNIGHT },
    { key: "NN", name: "Nightrider", letter: "NN", moves: NIGHTRIDER },
    { key: "C", name: "Cannon", letter: "C", moves: QUEEN_CANNON },
    { key: "M", name: "Master", letter: "M", moves: QUEEN, royal: true, becomes: "F" },
    { key: "F", name: "Master", letter: "M", moves: QUEEN_CANNON, royal: true, becomes: "M" },
  ],
  castling: [
    { name: "O-O", king: "e1", rook: "h1", kingTo: "g1", rookTo: "f1" },
    { name: "O-O-O", king: "e1", rook: "a1", kingTo: "c1", rookTo: "d1" },
  ],
};

function position(pieces, { castleMove = "king", castling = 0, turn = WHITE } = {}) {
  const board = attachRules(squareBoard({ cols: 8, grid: false }), { ...SPEC, castleMove });
  const s = { board, cells: new Uint8Array(64), royal: [-1, -1, -1], castling, ep: -1, clock: 0, pending: -1, turn };
  for (const [at, code] of Object.entries(pieces)) {
    const id = sq(board, at), player = code[0] === "w" ? WHITE : BLACK, key = code.slice(1);
    s.cells[id] = pieceCode(board.chess.byKey[key], player);
    if (SPEC.types.find((t) => t.key === key).royal) s.royal[player] = id;
  }
  return s;
}
const sq = (board, name) => board.cells.find((c) => c.tags.name === name).id;
const names = (s, moves) => moves.map((m) => m.map((id) => s.board.cells[id].tags.name).join("-")).sort();
const from = (s, at, player = WHITE) => names(s, legalMoves(s, player).filter((m) => m[0] === sq(s.board, at)));

test("images gives the distinct symmetric vectors", () => {
  assert.equal(images(1, 0).length, 4);
  assert.equal(images(1, 1).length, 4);
  assert.equal(images(1, 2).length, 8);
});

test("a cannon hops one piece of either colour, adjacent or not", () => {
  // Cannon c3: c2 (own) is an adjacent hurdle, so c1 is open; c5 (own) is
  // a hurdle up the file, c6 open, c7 (own) stops it. b4 is a hurdle for
  // a5 (enemy, captured); f3 hurdles e-wards to capture g3.
  const s = position({ c3: "wC", c2: "wP", c5: "wP", c7: "wP", b4: "wP", a5: "bP", f3: "bP", g3: "bP", e5: "bP", h1: "wK", a8: "bK" });
  assert.deepEqual(from(s, "c3"), ["c3-a5", "c3-c1", "c3-c6", "c3-f6", "c3-g3", "c3-g7", "c3-h8"]);
});

test("cannon attacks need exactly one hurdle", () => {
  const s = position({ a1: "wC", a4: "wP", a8: "bK", h1: "wK" });
  assert.ok(attacked(s, sq(s.board, "a8"), WHITE));
  s.cells[sq(s.board, "a6")] = pieceCode(s.board.chess.byKey.P, BLACK);
  assert.ok(!attacked(s, sq(s.board, "a8"), WHITE));   // two hurdles
  const t = position({ a1: "wC", a2: "bK", h1: "wK" });
  assert.ok(!attacked(t, sq(t.board, "a2"), WHITE));   // nothing to hop
});

test("a nightrider rides knight lines until blocked", () => {
  const s = position({ a1: "wNN", c2: "bP", h8: "wK", a8: "bK" });
  assert.deepEqual(from(s, "a1"), ["a1-b3", "a1-c2", "a1-c5", "a1-d7"]);
  assert.ok(attacked(s, sq(s.board, "d7"), WHITE));
});

test("pawns: double step, en passant, captures", () => {
  const s = position({ e2: "wP", d4: "bP", e1: "wK", e8: "bK" });
  playMove(s, [sq(s.board, "e2"), sq(s.board, "e4")]);
  assert.equal(s.board.cells[s.ep].tags.name, "e3");
  s.turn = BLACK;
  assert.deepEqual(from(s, "d4", BLACK), ["d4-d3", "d4-e3"]);
  playMove(s, [sq(s.board, "d4"), sq(s.board, "e3")]);
  assert.equal(s.cells[sq(s.board, "e4")], 0);
});

test("castling by destination or onto the rook, not through check", () => {
  const pieces = { e1: "wK", h1: "wR", a1: "wR", e8: "bK" };
  let s = position(pieces, { castling: 15 });
  assert.ok(from(s, "e1").includes("e1-g1") && from(s, "e1").includes("e1-c1"));
  s = position(pieces, { castling: 15, castleMove: "rook" });
  assert.ok(from(s, "e1").includes("e1-h1") && from(s, "e1").includes("e1-a1"));
  assert.equal(notation(s, [sq(s.board, "e1"), sq(s.board, "a1")]), "O-O-O");
  const info = playMove(s, [sq(s.board, "e1"), sq(s.board, "h1")]);
  assert.equal(info.landing, sq(s.board, "g1"));
  assert.equal(s.cells[sq(s.board, "f1")], pieceCode(s.board.chess.byKey.R, WHITE));
  assert.equal(s.castling & 3, 0);
  s = position({ ...pieces, f8: "bR" }, { castling: 15 });
  assert.ok(!from(s, "e1").includes("e1-g1"));
});

test("a two-faced royal flips when it moves, and its face decides its attacks", () => {
  const s = position({ d1: "wM", d8: "bM", d4: "wP" });
  const info = playMove(s, [sq(s.board, "d1"), sq(s.board, "d2")]);
  assert.equal(info.landing, sq(s.board, "d2"));
  assert.equal(s.cells[sq(s.board, "d2")], pieceCode(s.board.chess.byKey.F, WHITE));
  assert.equal(s.royal[WHITE], sq(s.board, "d2"));
  // White's cannon face on d2 hops the d4 pawn to check d8.
  assert.ok(inCheck(s, BLACK));
  // Black's queen face may not stay on the file above d4, but may take the
  // hurdle, which leaves the cannon nothing to hop.
  const moves = from(s, "d8", BLACK);
  assert.ok(!["d8-d7", "d8-d6", "d8-d5"].some((m) => moves.includes(m)));
  assert.ok(moves.includes("d8-d4"));
});
