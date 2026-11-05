import { test } from "node:test";
import assert from "node:assert/strict";
import { cellName, describeMove, logEntries, groupTurns } from "../common/log.js";
import { newGame, replay } from "../common/engine.js";
import tictactoe from "./fixtures/tictactoe.js";
import bagTictactoe from "./fixtures/bag-tictactoe.js";

test("cellName uses the name tag, else #id", () => {
  const named = newGame(bagTictactoe).board;
  assert.equal(cellName(named, 0), "a1");
  const plain = newGame(tictactoe).board;
  assert.equal(cellName(plain, 4), "#4");
});

test("describeMove defaults: cells, draws and labelled string moves", () => {
  const state = newGame(bagTictactoe);
  assert.equal(describeMove(bagTictactoe, state, "draw:D", null), "drew dark");
  const scheme = { marbles: { D: { name: "Umber", fill: "#000" } } };
  assert.equal(describeMove(bagTictactoe, state, "draw:D", null, scheme), "drew umber");
  assert.equal(describeMove(bagTictactoe, state, [0, 4], null), "a1–b2");
  assert.equal(describeMove(bagTictactoe, state, "roll:4", null), "rolled 4");
  assert.equal(describeMove(bagTictactoe, state, "pass", null), "Pass");
  const labelled = { ...bagTictactoe, moveLabels: { pass: "No move" } };
  assert.equal(describeMove(labelled, state, "pass", null), "No move");
  const computed = { ...labelled, moveLabel: () => "Computed" };
  assert.equal(describeMove(computed, state, "pass", null), "Computed");
  const custom = { ...computed, moveText: (before, move, info) => (Array.isArray(move) ? "custom" : null) };
  assert.equal(describeMove(custom, state, [3], null), "custom");
  assert.equal(describeMove(custom, state, "pass", null), "Computed");   // null falls back
});

test("moveText sees the position before the move and applyMove's info", () => {
  const seen = [];
  const game = {
    ...bagTictactoe,
    moveText(before, move, info) { seen.push({ phase: before.phase, info }); return "x"; },
  };
  logEntries(game, {}, ["draw:D", [0]]);
  assert.deepEqual(seen, [{ phase: "draw", info: { drew: "D" } }, { phase: "move", info: null }]);
});

test("logEntries and groupTurns put a draw in the turn of the move after it", () => {
  const moves = ["draw:D", [0], "draw:L", [1], "draw:D", [4]];
  replay(bagTictactoe, {}, moves);   // the line is legal
  const entries = logEntries(bagTictactoe, {}, moves);
  assert.deepEqual(entries.map((e) => e.player), [1, 1, 2, 2, 1, 1]);
  const turns = groupTurns(entries);
  assert.deepEqual(turns.map((t) => [t.number, t.player, t.plies.map((p) => `${p.index}:${p.text}`)]), [
    [1, 1, ["0:drew dark", "1:a1"]],
    [2, 2, ["2:drew light", "3:b1"]],
    [3, 1, ["4:drew dark", "5:b2"]],
  ]);
});

test("groupTurns: one ply per turn when players alternate", () => {
  const turns = groupTurns(logEntries(tictactoe, {}, [[4], [0], [8]]));
  assert.deepEqual(turns.map((t) => [t.player, t.plies.length]), [[1, 1], [2, 1], [1, 1]]);
  assert.deepEqual(groupTurns([]), []);
});

test("groupTurns: plies of no player get their own unnumbered turn", () => {
  const turns = groupTurns([
    { player: null, text: "a" }, { player: null, text: "b" },
    { player: 1, text: "c" }, { player: 2, text: "d" },
  ]);
  assert.deepEqual(turns.map((t) => [t.number, t.player, t.plies.length]), [[null, null, 2], [1, 1, 1], [2, 2, 1]]);
});
