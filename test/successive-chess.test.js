import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/successive-chess/game.js";
import { newGame, CHANCE } from "../common/engine.js";
import { pieceCode, WHITE, BLACK } from "../common/chess/rules.js";
import { describeMove } from "../common/log.js";

const { AGAIN, STOP, FIFTY } = internals;
const sq = (board, name) => board.cells.find((c) => c.tags.name === name).id;
const type = (s, key) => s.board.chess.byKey[key];
const cellMove = (s, m) => m.split("-").map((n) => sq(s.board, n));
const text = (s, move) => describeMove(game, game.clone(s), move, null);
const at = (s, name) => s.cells[sq(s.board, name)];
const piece = (s, player, key) => pieceCode(type(s, key), player);

// A custom position with `turn` to roll.
function position(pieces, { turn = WHITE } = {}) {
  const s = newGame(game, {});
  s.cells.fill(0);
  s.royal = [-1, -1, -1];
  s.castling = 0;
  for (const [name, code] of Object.entries(pieces)) {
    const player = code[0] === "w" ? WHITE : BLACK, key = code.slice(1);
    s.cells[sq(s.board, name)] = pieceCode(type(s, key), player);
    if (key === "K") s.royal[player] = sq(s.board, name);
  }
  s.turn = turn;
  return game.refresh(s);
}

test("a turn opens with a roll and a move, then the choice to roll again", () => {
  const s = newGame(game, {});
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), WHITE);
  assert.equal(game.chances(s).length, 6);
  assert.equal(text(s, "roll:3"), "rolled 3");
  game.applyMove(s, "roll:3");
  assert.equal(game.toMove(s), WHITE);
  assert.equal(game.legalMoves(s).length, 20);
  game.applyMove(s, cellMove(s, "e2-e4"));
  assert.deepEqual(game.legalMoves(s), [AGAIN, STOP]);
  game.applyMove(s, STOP);
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), BLACK);
});

test("a higher roll earns another move; the same or lower busts", () => {
  const s = newGame(game, {});
  game.applyMove(s, "roll:3");
  game.applyMove(s, cellMove(s, "e2-e4"));
  game.applyMove(s, AGAIN);
  assert.equal(game.toMove(s), CHANCE);
  game.applyMove(s, "roll:5");
  game.applyMove(s, cellMove(s, "d2-d4"));
  game.applyMove(s, AGAIN);
  assert.equal(text(s, "roll:5"), "rolled 5: bust");
  game.applyMove(s, "roll:5");
  // Remove any one of White's pieces.
  const moves = game.legalMoves(s);
  assert.equal(moves.length, 16);
  assert.ok(moves.every((m) => m.length === 1));
  assert.equal(text(s, cellMove(s, "b1")), "removed Knight b1");
  game.applyMove(s, cellMove(s, "b1"));
  assert.equal(at(s, "b1"), 0);
  assert.equal(game.currentPlayer(s), BLACK);
  assert.equal(game.toMove(s), CHANCE);
  assert.deepEqual(s.rolls[WHITE], [3, 5, 5]);
  assert.equal(game.chanceView(s)[0].result, "Bust");
});

test("after a 6 the turn ends at once", () => {
  const s = newGame(game, {});
  game.applyMove(s, "roll:4");
  game.applyMove(s, cellMove(s, "e2-e4"));
  game.applyMove(s, AGAIN);
  game.applyMove(s, "roll:6");
  game.applyMove(s, cellMove(s, "d2-d4"));
  assert.equal(game.currentPlayer(s), BLACK);
  assert.equal(game.toMove(s), CHANCE);
});

test("there is no check: a King may move into attack", () => {
  const s = position({ e1: "wK", e8: "bK", d8: "bR" });
  game.applyMove(s, "roll:2");
  const moves = game.legalMoves(s).map((m) => m.map((id) => s.board.cells[id].tags.name).join("-"));
  assert.ok(moves.includes("e1-d1"));
  assert.ok(moves.includes("e1-d2"));
});

test("capturing the King waits on a saving throw: at least the roll saves it", () => {
  const s = position({ e1: "wK", a8: "bK", a1: "wR" });
  game.applyMove(s, "roll:4");
  game.applyMove(s, cellMove(s, "a1-a8"));
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), WHITE);
  assert.equal(at(s, "a1"), piece(s, WHITE, "R"));   // not made yet
  assert.equal(text(s, "roll:4"), "saving throw 4: saved");
  assert.equal(text(s, "roll:3"), "saving throw 3: failed");

  const saved = game.clone(s);
  game.applyMove(saved, "roll:4");
  assert.equal(game.outcome(saved), null);
  assert.equal(at(saved, "a1"), piece(s, WHITE, "R"));
  assert.equal(at(saved, "a8"), piece(s, BLACK, "K"));
  assert.equal(game.currentPlayer(saved), BLACK);
  assert.equal(game.chanceView(saved)[2].result, "Saved");

  game.applyMove(s, "roll:3");
  assert.deepEqual(game.outcome(s), { winner: WHITE });
  assert.equal(at(s, "a8"), piece(s, WHITE, "R"));
  assert.deepEqual(game.legalMoves(s), []);
});

test("removing your own King loses", () => {
  const s = position({ e1: "wK", e8: "bK", a2: "wP" });
  game.applyMove(s, "roll:3");
  game.applyMove(s, cellMove(s, "a2-a3"));
  game.applyMove(s, AGAIN);
  game.applyMove(s, "roll:1");
  game.applyMove(s, cellMove(s, "e1"));
  assert.deepEqual(game.outcome(s), { winner: BLACK });
});

test("en passant is open only against the last move of the opponent's turn", () => {
  const s = position({ e1: "wK", e8: "bK", e2: "wP", h2: "wP", d4: "bP" });
  game.applyMove(s, "roll:2");
  game.applyMove(s, cellMove(s, "e2-e4"));
  game.applyMove(s, STOP);
  game.applyMove(s, "roll:2");
  assert.ok(game.legalMoves(s).some((m) => m.join() === cellMove(s, "d4-e3").join()));

  const t = position({ e1: "wK", e8: "bK", e2: "wP", h2: "wP", d4: "bP" });
  game.applyMove(t, "roll:2");
  game.applyMove(t, cellMove(t, "e2-e4"));
  game.applyMove(t, AGAIN);
  game.applyMove(t, "roll:3");
  game.applyMove(t, cellMove(t, "h2-h3"));
  game.applyMove(t, STOP);
  game.applyMove(t, "roll:2");
  assert.ok(!game.legalMoves(t).some((m) => m.join() === cellMove(t, "d4-e3").join()));
});

test("a player's own double step gives them no en passant", () => {
  const s = position({ e1: "wK", e8: "bK", e2: "wP", d2: "wP" });
  game.applyMove(s, "roll:2");
  game.applyMove(s, cellMove(s, "e2-e4"));
  game.applyMove(s, AGAIN);
  game.applyMove(s, "roll:3");
  assert.ok(!game.legalMoves(s).some((m) => m.join() === cellMove(s, "d2-e3").join()));
});

test("promotion comes before the choice to roll again", () => {
  const s = position({ e1: "wK", e8: "bK", a7: "wP" });
  game.applyMove(s, "roll:2");
  game.applyMove(s, cellMove(s, "a7-a8"));
  assert.ok(game.legalMoves(s).includes("promote:Q"));
  game.applyMove(s, "promote:N");
  assert.equal(at(s, "a8"), piece(s, WHITE, "N"));
  assert.deepEqual(game.legalMoves(s), [AGAIN, STOP]);
});

test("100 moves without a capture or pawn move draw", () => {
  const s = position({ e1: "wK", e8: "bK" });
  s.clock = FIFTY - 1;
  game.applyMove(s, "roll:6");
  game.applyMove(s, cellMove(s, "e1-e2"));
  assert.deepEqual(game.outcome(s), { winner: 0 });
});

test("castling is as in chess: not out of, through or into attack", () => {
  const castles = (s) => game.legalMoves(s).some((m) => m.join() === cellMove(s, "e1-g1").join());
  const setup = (extra) => {
    const s = position({ e1: "wK", h1: "wR", a8: "bK", ...extra });
    s.castling = 1;   // White's O-O
    game.applyMove(s, "roll:3");
    return s;
  };
  assert.ok(castles(setup({})));
  assert.ok(!castles(setup({ e8: "bR" })));   // out of
  assert.ok(!castles(setup({ f8: "bR" })));   // through
  assert.ok(!castles(setup({ g8: "bR" })));   // into
  assert.ok(castles(setup({ h8: "bR" })));    // the Rook may be attacked
});

test("stalemate loses: no legal move after a roll", () => {
  const s = position({
    a8: "wK", b8: "wB", c8: "wN", a7: "wP", b7: "wP", c7: "wP", e7: "wP", b6: "wP", d6: "wP",
    d7: "bN", e8: "bR", h1: "bK",
  });
  game.applyMove(s, "roll:3");
  assert.deepEqual(game.outcome(s), { winner: BLACK });
  assert.deepEqual(game.legalMoves(s), []);
  assert.deepEqual(game.outcomeLines(s, game.outcome(s), null), ["White has no legal move (stalemate loses)."]);
});
