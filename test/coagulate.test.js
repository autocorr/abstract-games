import { test } from "node:test";
import assert from "node:assert/strict";
import game from "../games/coagulate/game.js";
import { newGame, replay, CHANCE } from "../common/engine.js";
import { describeMove, logEntries } from "../common/log.js";
import { seededRng } from "../common/rng.js";

const OFF = { size: 4, swap: "off" };
const ON = { size: 4, swap: "on" };
const play = (opts, moves) => replay(game, opts, moves).state;
const cellsOf = (s) => game.legalMoves(s).filter(Array.isArray).map(([id]) => id);

test("a turn opens with a d4 roll that always counts", () => {
  const s = newGame(game, OFF);
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), 1);
  assert.deepEqual(game.chances(s).map((o) => o.move), ["roll:1", "roll:2", "roll:3", "roll:4"]);
  game.applyMove(s, "roll:3");
  assert.equal(game.toMove(s), 1);
  assert.equal(cellsOf(s).length, 37);
  assert.ok(game.legalMoves(s).includes("reroll"));
  assert.match(game.turnHint(s), /Black rolled 3: place 1 stone, or roll again \(beat 3: 1 in 4\)\./);
});

test("each re-roll that beats the last adds a stone", () => {
  const s = play(OFF, ["roll:1", "reroll", "roll:2", "reroll", "roll:4"]);
  assert.deepEqual(s.rolls, [1, 2, 4]);
  assert.ok(!game.legalMoves(s).includes("reroll"), "nothing beats a 4");
  assert.match(game.turnHint(s), /Black rolled 4: place 3 stones\./);
  game.applyMove(s, [0]);
  assert.ok(!game.legalMoves(s).includes("reroll"));
  assert.match(game.turnHint(s), /Black: place 2 more stones\./);
  game.applyMove(s, [1]);
  assert.equal(game.toMove(s), 1);
  game.applyMove(s, [2]);
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), 2);
  assert.deepEqual(game.markers(s).map((m) => m.id), [0, 1, 2]);
});

test("placing the first stone stops the rolling", () => {
  const s = play(OFF, ["roll:1", "reroll", "roll:2", [5]]);
  assert.equal(game.toMove(s), 1);
  assert.deepEqual(game.legalMoves(s).filter((m) => !Array.isArray(m)), []);
});

test("an equal or lower re-roll busts: no stones, the turn passes", () => {
  for (const r of ["roll:2", "roll:1"]) {
    const s = play(OFF, ["roll:1", [0], "roll:2", "reroll", r]);
    assert.equal(game.currentPlayer(s), 1);
    assert.equal(game.toMove(s), CHANCE);
    assert.equal(s.cells.filter(Boolean).length, 1);
    assert.match(game.turnHint(s), new RegExp(`^White busted \\(2, ${r.slice(5)}\\)\\. Black rolls the die…`));
    assert.deepEqual(game.markers(s).map((m) => m.id), [0], "the last placement stays marked");
  }
  const before = play(OFF, ["roll:1", [0], "roll:2", "reroll"]);
  const after = game.clone(before);
  const info = game.applyMove(after, "roll:2");
  assert.equal(describeMove(game, before, "roll:2", info), "rolled 2: bust");
  // The bust note goes once someone places.
  const later = play(OFF, ["roll:1", [0], "roll:2", "reroll", "roll:1", "roll:3", [1]]);
  assert.equal(later.bust, null);
});

test("log text for a turn", () => {
  const entries = logEntries(game, OFF, ["roll:1", "reroll", "roll:3", [0], [1]]);
  const names = newGame(game, OFF).board.cells;
  assert.deepEqual(entries.map((e) => e.text), ["rolled 1", "roll again", "rolled 3", names[0].tags.name, names[1].tags.name]);
});

test("the die panel shows the turn's counting rolls", () => {
  const s = newGame(game, OFF);
  assert.deepEqual(game.chanceView(s), [{ title: "d4", owner: 1, dice: [null], active: true }]);
  game.applyMove(s, "roll:2");
  assert.deepEqual(game.chanceView(s)[0].dice, [2]);
  assert.equal(game.chanceView(s)[0].active, false);
  game.applyMove(s, "reroll");
  assert.deepEqual(game.chanceView(s)[0].dice, [2, null]);
  assert.match(game.turnHint(s), /Black rolls again, needing more than 2…/);
});

test("a full board ends the game mid-turn; larger groups win", () => {
  const s = newGame(game, OFF);
  // Black holds the top half (15 stones) and White the rest but two cells.
  for (const c of s.board.cells) s.cells[c.id] = c.coord.r < 0 ? 1 : 2;
  const a = s.board.at(0, 0), b = s.board.at(-1, 1);
  s.cells[a] = s.cells[b] = 0;
  s.stones = 35;
  game.applyMove(s, "roll:1");
  game.applyMove(s, "reroll");
  game.applyMove(s, "roll:2");
  game.applyMove(s, "reroll");
  game.applyMove(s, "roll:3");
  assert.equal(s.left, 2, "only two cells are left for three stones");
  game.applyMove(s, [a]);
  assert.equal(game.outcome(s), null);
  game.applyMove(s, [b]);
  assert.deepEqual(game.outcome(s), { winner: 2 });
  assert.deepEqual(game.legalMoves(s), []);
  assert.equal(game.outcomeLines(s)[0], "Largest group: Black 17, White 20.");
});

test("the swap is decided before White's first roll", () => {
  const s = play(ON, ["roll:1", "reroll", "roll:2", [18], [19]]);
  assert.equal(game.toMove(s), 2);
  assert.deepEqual(game.legalMoves(s), ["keep", "swap"]);
  assert.deepEqual(game.chanceView(s), []);
  assert.match(game.turnHint(s), /White: roll to play on\. Or swap: Black's opening becomes White's, and Black moves next\./);

  const swapped = play(ON, ["roll:1", "reroll", "roll:2", [18], [19], "swap"]);
  assert.equal(swapped.cells[18], 2);
  assert.equal(swapped.cells[19], 2);
  assert.equal(game.toMove(swapped), CHANCE);
  assert.equal(game.currentPlayer(swapped), 1);

  const kept = play(ON, ["roll:1", [18], "keep", "roll:2", [0], "roll:1"]);
  assert.equal(kept.cells[18], 1);
  assert.ok(!game.legalMoves(kept).includes("swap"));
  assert.equal(describeMove(game, play(ON, ["roll:1", [18]]), "keep", null), "no swap");

  assert.equal(game.toMove(play(OFF, ["roll:1", [18]])), CHANCE, "no swap decision without the rule");
});

test("the custom playout fills the board", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const s = newGame(game, { size: 5, swap: "on" });
    const winner = game.playout(s, seededRng(seed));
    assert.ok(winner === 1 || winner === 2);
    assert.ok(s.cells.every((c) => c));
  }
});
