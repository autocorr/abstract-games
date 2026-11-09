import { test } from "node:test";
import assert from "node:assert/strict";
import game, { PAIRS, internals } from "../games/shaolin-king/game.js";
import { newGame, replay, moveKey, parseMoveKey, optionActive, CHANCE } from "../common/engine.js";
import { pieceCode, typeOf, inCheck, WHITE, BLACK } from "../common/chess/rules.js";
import { describeMove } from "../common/log.js";
import { seededRng } from "../common/rng.js";

const { faceKey } = internals;
const Q = faceKey("shaolin", 0), C = faceKey("shaolin", 1);
const sq = (board, name) => board.cells.find((c) => c.tags.name === name).id;
const name = (board, id) => board.cells[id].tags.name;
const keys = (s, moves) => moves.map((m) => (Array.isArray(m) ? m.map((id) => name(s.board, id)).join("-") : m)).sort();
const keyAt = (s, at) => s.board.chess.types[typeOf(s.cells[sq(s.board, at)])].key;
const play = (s, ...ms) => { for (const m of ms) game.applyMove(s, m.includes("-") ? m.split("-").map((n) => sq(s.board, n)) : m); };
const movesFrom = (s, at) => keys(s, game.legalMoves(s).filter((m) => Array.isArray(m) && m[0] === sq(s.board, at)));

// A custom position: { e1: "w" + Q, e8: "bR", ... }, with `turn` to move.
function position(pieces, { turn = WHITE, castling = 0 } = {}) {
  const s = newGame(game, {});
  s.cells.fill(0);
  s.royal = [-1, -1, -1];
  for (const [at, code] of Object.entries(pieces)) {
    const player = code[0] === "w" ? WHITE : BLACK, key = code.slice(1);
    const id = sq(s.board, at);
    s.cells[id] = pieceCode(s.board.chess.byKey[key], player);
    if (key.startsWith("M:")) {
      s.royal[player] = id;
      s.pairs[player] = key.split(":")[1];
    }
  }
  s.turn = turn;
  s.castling = castling;
  return game.refresh(s);
}

test("the standard setup with Masters on e1 and e8", () => {
  const s = newGame(game, {});
  assert.equal(game.toMove(s), WHITE);
  assert.equal(keyAt(s, "e1"), Q);
  assert.equal(keyAt(s, "e8"), Q);
  assert.equal(keyAt(s, "d1"), "Q");
  assert.equal(name(s.board, s.royal[WHITE]), "e1");
  assert.equal(game.legalMoves(s).length, 20);
});

test("the Master turns over each time it moves, and back", () => {
  const s = newGame(game, {});
  play(s, "e2-e4", "d7-d5", "e1-e2");
  assert.equal(keyAt(s, "e2"), C);
  play(s, "a7-a6");
  // As a Cannon on e2 it hops the e4 pawn: e5 is open, e6 is guarded by the
  // f7 pawn, and e7 by Black's Master. Its other lines have no hurdle with
  // a free square beyond.
  assert.deepEqual(movesFrom(s, "e2"), ["e2-e5"]);
  play(s, "e2-e5");
  assert.equal(keyAt(s, "e5"), Q);
});

test("the Cannon face hops one piece, adjacent or not, as in the book's diagram", () => {
  const s = position({
    c3: "w" + C, c7: "wP", c5: "wP", b4: "wP", c2: "wP", a5: "bP", e5: "bP", f3: "bP", g3: "bP", h2: "b" + C,
  });
  assert.deepEqual(movesFrom(s, "c3"), ["c3-a5", "c3-c1", "c3-c6", "c3-f6", "c3-g3", "c3-g7", "c3-h8"]);
});

test("a Cannon-faced Master with nothing to hop cannot move", () => {
  const s = position({ a1: "w" + C, h8: "b" + Q, h1: "wP" });
  // h1 is a hurdle along the rank, but nothing lies beyond it.
  assert.deepEqual(movesFrom(s, "a1"), []);
});

test("one Master can check and mate the other", () => {
  // White's upright (Queen) Master on h7 with a Rook on g1 guarding g8 and
  // the g-file: Black's Cannon-faced Master on h8 is mated.
  const s = position({ h7: "w" + Q, g1: "wR", h8: "b" + C }, { turn: BLACK });
  assert.ok(inCheck(s, BLACK));
  assert.equal(s.reason, "checkmate");
  assert.equal(game.outcome(s).winner, WHITE);
});

test("Masters may stand side by side when neither attacks the other", () => {
  // Both Cannons, adjacent: no check. White's King face may not step next to
  // Black's King face.
  const s = position({ d4: "w" + C, d5: "b" + C, a1: "wP", h8: "bP" });
  assert.ok(!inCheck(s, WHITE));
  const k = position({ d4: "w" + faceKey("kq", 0), d6: "b" + faceKey("kq", 0) });
  assert.ok(!movesFrom(k, "d4").some((m) => m.endsWith("5")));
  // A Queen face beside a Cannon face checks it, but not the other way.
  const mixed = position({ d4: "w" + Q, d5: "b" + C }, { turn: BLACK });
  assert.ok(inCheck(mixed, BLACK));
});

test("castling onto the Rook; the Master keeps its face; not through check", () => {
  const pieces = { e1: "w" + Q, h1: "wR", a1: "wR", b8: "b" + Q };
  let s = position(pieces, { castling: 15 });
  assert.ok(movesFrom(s, "e1").includes("e1-h1"));
  assert.ok(movesFrom(s, "e1").includes("e1-a1"));
  assert.ok(movesFrom(s, "e1").includes("e1-g1"));   // an ordinary Queen move
  assert.equal(describeMove(game, s, [sq(s.board, "e1"), sq(s.board, "h1")], null), "O-O");
  assert.equal(describeMove(game, s, [sq(s.board, "e1"), sq(s.board, "g1")], null), "Kg1");
  play(s, "e1-h1");
  assert.equal(keyAt(s, "g1"), Q);
  assert.equal(keyAt(s, "f1"), "R");
  assert.equal(s.castling & 3, 0);
  // f1 attacked: no short castling.
  s = position({ ...pieces, f8: "bR" }, { castling: 15 });
  assert.ok(!movesFrom(s, "e1").includes("e1-h1"));
  assert.ok(movesFrom(s, "e1").includes("e1-a1"));
});

test("Master pairs per side, and random Masters dealt by chance plies", () => {
  const s = newGame(game, { white: "kn", black: "rb" });
  assert.equal(keyAt(s, "e1"), faceKey("kn", 0));
  assert.equal(keyAt(s, "e8"), faceKey("rb", 0));
  // Every pair leaves White the usual 20 opening moves or more.
  for (const pair of Object.keys(PAIRS)) assert.ok(newGame(game, { white: pair }).moves.length >= 20);

  const same = newGame(game, { random: "same", white: "kn" });
  assert.equal(game.toMove(same), CHANCE);
  assert.equal(game.currentPlayer(same), null);
  assert.deepEqual(game.chances(same).map((o) => o.p), Array(5).fill(0.2));
  assert.equal(describeMove(game, same, "master:knr", null), "Masters: King / Nightrider");
  game.applyMove(same, "master:knr");
  assert.equal(keyAt(same, "e1"), faceKey("knr", 0));
  assert.equal(keyAt(same, "e8"), faceKey("knr", 0));
  assert.equal(game.toMove(same), WHITE);

  const each = newGame(game, { random: "each" });
  assert.equal(describeMove(game, each, "master:rb", null), "White's Master: Rook / Bishop");
  game.applyMove(each, "master:rb");
  assert.equal(game.toMove(each), CHANCE);
  assert.equal(describeMove(game, each, "master:kq", null), "Black's Master: King / Queen");
  game.applyMove(each, "master:kq");
  assert.equal(keyAt(each, "e1"), faceKey("rb", 0));
  assert.equal(keyAt(each, "e8"), faceKey("kq", 0));
  assert.equal(game.toMove(each), WHITE);

  // The fixed choices are inactive while Masters are random.
  assert.ok(optionActive(game, "white", { random: "off" }));
  assert.ok(!optionActive(game, "black", { random: "each" }));
});

test("a Nightrider face rides knight lines", () => {
  const s = position({ a1: "w" + faceKey("knr", 1), c2: "bP", h8: "b" + Q });
  assert.deepEqual(movesFrom(s, "a1"), ["a1-b3", "a1-c2", "a1-c5", "a1-d7"]);
});

test("labels name each face's movement and start hidden", () => {
  assert.equal(game.pieceLabelsDefault, "off");
  const s = newGame(game, { white: "knr", black: "shaolin" });
  play(s, "e2-e4", "e7-e5", "e1-e2", "e8-e7");
  const label = (at) => game.piecesOf(s).find((p) => p.id === sq(s.board, at));
  assert.equal(label("e2").label, "NN");
  assert.equal(label("e2").rotate, 180);
  assert.equal(label("e7").label, "C");
  assert.equal(label("d1").label, undefined);
});

test("the status line says how each Master moves now", () => {
  const s = newGame(game, {});
  assert.equal(game.turnHint(s), "White to move. Both Masters move as a Queen.");
  play(s, "e2-e4", "e7-e5", "e1-e2");
  assert.equal(game.turnHint(s), "Black to move. White's Master moves as a Cannon, Black's as a Queen.");
  assert.equal(game.scoreSummary(s, WHITE).sub, "Cannon · next Queen");
});

test("random games replay, and playouts end", () => {
  for (const random of ["off", "same", "each"]) {
    const rng = seededRng(3);
    const opts = { random };
    const s = newGame(game, opts);
    const moves = [];
    while (!game.outcome(s) && moves.length < 300) {
      const legal = game.legalMoves(s);
      const m = legal[Math.floor(rng() * legal.length)];
      game.applyMove(s, m);
      moves.push(m);
    }
    const r = replay(game, opts, moves.map(moveKey).map(parseMoveKey));
    assert.deepEqual(Array.from(r.state.cells), Array.from(s.cells));
    const p = newGame(game, opts);
    assert.equal(game.playout(p, seededRng(5)), game.outcome(p).winner);
  }
});
