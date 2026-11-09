import { test } from "node:test";
import assert from "node:assert/strict";
import game, { COLOR_SCHEMES, concreteCount } from "../games/reify/game.js";
import { newGame } from "../common/engine.js";
import { pieceCode, typeOf, findRoyals, WHITE, BLACK } from "../common/chess/rules.js";

const sq = (board, name) => board.cells.find((c) => c.tags.name === name).id;
const name = (board, id) => board.cells[id].tags.name;
const keys = (s, moves) => moves.map((m) => (Array.isArray(m) ? m.map((id) => name(s.board, id)).join("-") : m)).sort();
const keyAt = (s, at) => s.board.chess.types[typeOf(s.cells[sq(s.board, at)])].key;
const play = (s, ...ms) => { for (const m of ms) game.applyMove(s, m.includes("-") ? m.split("-").map((n) => sq(s.board, n)) : m); };
const movesFrom = (s, at) => keys(s, game.legalMoves(s).filter((m) => Array.isArray(m) && m[0] === sq(s.board, at)));

// A custom position: { e1: "wK~", e8: "bR", ... } ("~" abstract), `turn` to move.
function position(pieces, { turn = WHITE, castling = 0 } = {}) {
  const s = newGame(game, {});
  s.cells.fill(0);
  for (const [at, code] of Object.entries(pieces)) {
    s.cells[sq(s.board, at)] = pieceCode(s.board.chess.byKey[code.slice(1)], code[0] === "w" ? WHITE : BLACK);
  }
  s.royal = findRoyals(s.board, s.cells);
  s.turn = turn;
  s.castling = castling;
  return game.refresh(s);
}

test("every piece starts concrete and turns over each time it lands", () => {
  const s = newGame(game, {});
  assert.equal(concreteCount(s, WHITE), 8);
  assert.equal(concreteCount(s, BLACK), 8);
  play(s, "g1-f3");
  assert.equal(keyAt(s, "f3"), "N~");
  assert.equal(concreteCount(s, WHITE), 7);
  play(s, "e7-e5", "f3-e5");   // a capture turns it back
  assert.equal(keyAt(s, "e5"), "N");
  assert.equal(keyAt(s, "e2"), "P");
});

test("castling turns over both the King and the Rook", () => {
  const s = position({ e1: "wK", h1: "wR", a1: "wR", e8: "bK" }, { castling: 15 });
  play(s, "e1-g1");
  assert.equal(keyAt(s, "g1"), "K~");
  assert.equal(keyAt(s, "f1"), "R~");
  assert.equal(concreteCount(s, WHITE), 1);
});

test("no move may turn over the last concrete piece", () => {
  // White's only concrete piece is the Knight: it may not move, but the
  // abstract Rook and the King may.
  const s = position({ e1: "wK~", b1: "wN", h3: "wR~", a2: "wP", e8: "bK", a8: "bR" });
  assert.deepEqual(movesFrom(s, "b1"), []);
  assert.ok(movesFrom(s, "h3").length > 0);
  assert.match(game.turnHint(s), /Only one concrete piece left/);
  // Castling that would turn over the last two concrete pieces is ruled out.
  const c = position({ e1: "wK", h1: "wR", e8: "bK", a8: "bR" }, { castling: 1 });
  assert.ok(!movesFrom(c, "e1").includes("e1-g1"));
  // Either piece alone may move: the other stays concrete.
  assert.ok(movesFrom(c, "e1").includes("e1-f1"));
  assert.ok(movesFrom(c, "h1").includes("h1-h5"));
});

test("a concrete King counts, and an abstract King need not be concrete", () => {
  const s = position({ e1: "wK", e8: "bK", a8: "bR" });
  assert.deepEqual(movesFrom(s, "e1"), []);   // its only concrete piece
  assert.equal(s.winner, BLACK);              // no other move: stalemate loses
  assert.equal(s.reason, "stalemate");
});

test("capturing the opponent's last concrete piece wins at once", () => {
  const s = position({ e1: "wK~", a1: "wR", h7: "wP", e8: "bK~", a8: "bN" });
  play(s, "a1-a8");
  assert.equal(s.winner, WHITE);
  assert.equal(s.reason, "abstract");
  assert.deepEqual(game.outcomeLines(s), ["Blue has no concrete piece left."]);
  assert.deepEqual(game.outcomeLines(s, null, COLOR_SCHEMES.teal), ["Teal has no concrete piece left."]);
});

test("promotion makes a concrete piece", () => {
  const s = position({ e1: "wK~", b1: "wN", a7: "wP", h8: "bK", h1: "bR" });
  play(s, "a7-a8");
  assert.deepEqual(game.legalMoves(s), ["promote:Q", "promote:R", "promote:B", "promote:N"]);
  play(s, "promote:Q");
  assert.equal(keyAt(s, "a8"), "Q");
  assert.equal(concreteCount(s, WHITE), 2);
});

test("checkmate and the threefold rule apply", () => {
  const s = newGame(game, {});
  play(s, "f2-f3", "e7-e5", "g2-g4", "d8-h4");
  assert.equal(s.winner, BLACK);
  assert.equal(s.reason, "checkmate");
  const t = newGame(game, {});
  const shuffle = ["g1-f3", "g8-f6", "f3-g1", "f6-g8"];
  play(t, ...shuffle, ...shuffle);
  assert.equal(t.winner, 0);
  assert.equal(t.reason, "repetition");
  // After 1.e4 no Black pawn can take en passant, so the position counts
  // as the same one when it recurs.
  const u = newGame(game, {});
  const black = ["g8-f6", "g1-f3", "f6-g8", "f3-g1"];
  play(u, "e2-e4", ...black, ...black.slice(0, 3));
  assert.equal(u.winner, null);
  play(u, black[3]);
  assert.equal(u.reason, "repetition");
});

test("schemes name the players and draw pieces as data URLs", () => {
  const s = newGame(game, {});
  const pieces = game.piecesOf(s, undefined, COLOR_SCHEMES.amberIndigo);
  assert.equal(pieces.length, 32);
  assert.ok(pieces.every((p) => p.image.startsWith("data:image/svg+xml")));
  assert.match(game.turnHint(s, COLOR_SCHEMES.amberIndigo), /^Amber to move/);
  assert.equal(game.turnHint(s), "Vermilion to move.");
  // Concrete and abstract Knights and the pawns differ.
  const img = (at) => pieces.find((p) => p.id === sq(s.board, at)).image;
  play(s, "g1-f3");
  const after = game.piecesOf(s, undefined, COLOR_SCHEMES.amberIndigo);
  assert.notEqual(after.find((p) => p.id === sq(s.board, "f3")).image, img("b1"));
  assert.notEqual(img("a2"), img("b1"));
});
