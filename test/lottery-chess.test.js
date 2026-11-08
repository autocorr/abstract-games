import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/lottery-chess/game.js";
import { newGame, CHANCE } from "../common/engine.js";
import { pieceCode, dropSlot, handCount, WHITE, BLACK } from "../common/chess/rules.js";
import { describeMove } from "../common/log.js";

const { PRIZES } = internals;
const sq = (board, name) => board.cells.find((c) => c.tags.name === name).id;
const type = (s, key) => s.board.chess.byKey[key];
const cellMove = (s, m) => m.split("-").map((n) => sq(s.board, n));
const drop = (s, key, at, player = s.turn) => [dropSlot(s, player, type(s, key)), sq(s.board, at)];
const text = (s, move) => describeMove(game, game.clone(s), move, null);

// A custom position with `turn` to draw.
function position(pieces, { turn = WHITE } = {}) {
  const s = newGame(game, {});
  s.cells.fill(0);
  s.royal = [-1, -1, -1];
  s.castling = 0;
  for (const [at, code] of Object.entries(pieces)) {
    const player = code[0] === "w" ? WHITE : BLACK, key = code.slice(1);
    s.cells[sq(s.board, at)] = pieceCode(type(s, key), player);
    if (key === "K") s.royal[player] = sq(s.board, at);
  }
  s.turn = turn;
  return game.refresh(s);
}

test("each turn opens with a draw from the mover's own bag of 2 white and 5 black", () => {
  const s = newGame(game, {});
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), WHITE);
  const odds = Object.fromEntries(game.chances(s).map((o) => [o.move, o.p]));
  assert.deepEqual(odds, { "draw:W": 2 / 7, "draw:B": 5 / 7 });
  game.applyMove(s, "draw:B");
  assert.equal(game.toMove(s), WHITE);
  assert.equal(game.legalMoves(s).length, 20);   // no hand, no drops
  game.applyMove(s, cellMove(s, "e2-e4"));
  assert.equal(game.toMove(s), CHANCE);
  assert.deepEqual(s.bags[BLACK].counts, { W: 2, B: 5 });   // Black's bag is untouched so far
  assert.deepEqual(s.bags[WHITE].counts, { W: 2, B: 4 });
});

test("white rolls a d10 for the prize, which goes into the hand", () => {
  const s = newGame(game, {});
  game.applyMove(s, "draw:W");
  assert.equal(game.toMove(s), CHANCE);
  const outcomes = game.chances(s);
  assert.equal(outcomes.length, 10);
  assert.ok(outcomes.every((o) => o.p === 0.1));
  assert.equal(text(s, "roll:9"), "rolled 9: Rook");
  game.applyMove(s, "roll:9");
  assert.equal(game.toMove(s), WHITE);
  assert.equal(handCount(s, WHITE, type(s, "R")), 1);
  assert.match(game.turnHint(s), /^White won a Rook\./);
  const panels = game.chanceView(s);
  assert.deepEqual(panels.at(-1).dice, [9]);
  // The Rook may be dropped this turn on any empty square.
  assert.equal(game.legalMoves(s).filter((m) => m[0] >= s.board.size).length, 32);
});

test("the die favours pawns: 4 pawns, 2 knights, 2 bishops, 1 rook, 1 queen in 10", () => {
  const counts = {};
  for (const p of PRIZES) counts[p] = (counts[p] || 0) + 1;
  assert.deepEqual(counts, { P: 4, N: 2, B: 2, R: 1, Q: 1 });
});

test("a bag is refilled only when all 7 marbles are drawn", () => {
  const s = newGame(game, {});
  const draws = [];
  // Draw black while there is one (then white), win a pawn on white, and
  // shuffle the knights.
  const turn = (shuffle) => {
    const draw = game.chances(s).some((o) => o.move === "draw:B") ? "draw:B" : "draw:W";
    if (s.turn === WHITE) draws.push(draw);
    game.applyMove(s, draw);
    if (s.rolling) game.applyMove(s, "roll:1");
    game.applyMove(s, cellMove(s, shuffle));
  };
  for (let i = 0; i < 8; i++) {
    turn(i % 2 ? "f3-g1" : "g1-f3");
    turn(i % 2 ? "f6-g8" : "g8-f6");
  }
  // Five blacks, then the two whites are all that is left, then a fresh bag.
  assert.deepEqual(draws, ["draw:B", "draw:B", "draw:B", "draw:B", "draw:B", "draw:W", "draw:W", "draw:B"]);
  assert.equal(handCount(s, WHITE, type(s, "P")), 2);
  assert.deepEqual(s.bags[WHITE].counts, { W: 2, B: 4 });
});

test("captures do not go to the hand", () => {
  const s = position({ e1: "wK", e8: "bK", d4: "wN", e6: "bR" });
  game.applyMove(s, "draw:B");
  game.applyMove(s, cellMove(s, "d4-e6"));
  assert.ok(Array.from(s.hand).every((n) => n === 0));
});

// White's King e1; Black's King g8 behind its pawns. R@a8 checks along the
// back rank, where only a piece Black wins this turn could block.
const backRank = () => {
  const s = position({ e1: "wK", g8: "bK", f7: "bP", g7: "bP", h7: "bP" });
  game.applyMove(s, "draw:W");
  game.applyMove(s, "roll:9");
  const check = drop(s, "R", "a8");
  assert.equal(text(s, check), "R@a8+");   // not "#": Black draws first
  game.applyMove(s, check);
  return s;
};

test("a drop may checkmate; mate is decided after the defender's draw", () => {
  const s = backRank();
  assert.equal(game.toMove(s), CHANCE);
  game.applyMove(s, "draw:B");
  assert.equal(s.winner, WHITE);
  assert.equal(s.reason, "checkmate");
});

test("a piece won while in check may be dropped to block it, but not a pawn on the last rank", () => {
  const s = backRank();
  game.applyMove(s, "draw:W");
  game.applyMove(s, "roll:5");   // a Knight
  assert.equal(s.winner, null);
  const blocks = game.legalMoves(s).map((m) => s.board.cells[m[1]].tags.name).sort();
  assert.deepEqual(blocks, ["b8", "c8", "d8", "e8", "f8"]);
  const t = backRank();
  game.applyMove(t, "draw:W");
  game.applyMove(t, "roll:1");   // a Pawn: it cannot go on the 8th rank
  assert.equal(t.winner, WHITE);
});

test("pawns are not dropped on the first or last rank", () => {
  const s = position({ e1: "wK", e8: "bK" });
  game.applyMove(s, "draw:W");
  game.applyMove(s, "roll:1");
  const targets = game.legalMoves(s).filter((m) => m[0] >= s.board.size).map((m) => s.board.cells[m[1]].tags.name);
  assert.equal(targets.length, 48);
  assert.ok(!targets.some((n) => /[18]$/.test(n)));
});

test("hands: Black's above the board, White's below, pawn to queen", () => {
  const s = newGame(game, {});
  const [top, bottom] = game.hands(s);
  assert.equal(top.side, "top");
  assert.equal(top.player, BLACK);
  assert.equal(bottom.player, WHITE);
  assert.deepEqual(bottom.slots.map((slot) => slot.name), ["Pawn", "Knight", "Bishop", "Rook", "Queen"]);
  assert.ok(bottom.slots.every((slot) => slot.count === 0));
});
