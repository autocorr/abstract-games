import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/nucleation/game.js";
import { newGame, replay, CHANCE } from "../common/engine.js";
import { describeMove } from "../common/log.js";
import { seededRng } from "../common/rng.js";

const { placements, decider } = internals;

// A position on a side-4 board with stones at axial coords, Black to place
// with roll `roll`.
function position({ black = [], white = [], roll, turn = 1, swap = "off" }) {
  const s = newGame(game, { size: 4, swap });
  const at = ([q, r]) => s.board.at(q, r);
  for (const c of black) s.cells[at(c)] = 1;
  for (const c of white) s.cells[at(c)] = 2;
  s.stones = black.length + white.length;
  s.turn = turn;
  s.phase = "place";
  s.roll = roll;
  return { s, at };
}

const legalSet = (s) => new Set(game.legalMoves(s).map(([id]) => id));

test("a turn is a roll, then a placement", () => {
  const s = newGame(game, { size: 4, swap: "off" });
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), 1);
  assert.deepEqual(game.chances(s).map((o) => o.move), ["roll:1", "roll:2", "roll:3", "roll:4", "roll:5", "roll:6"]);
  game.applyMove(s, "roll:1");
  assert.equal(game.toMove(s), 1);
  assert.equal(game.legalMoves(s).length, 37, "a 1 may go anywhere on an empty board");
  game.applyMove(s, [0]);
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.currentPlayer(s), 2);
});

test("the result must equal the roll, merging groups", () => {
  // Black singles at (-2,0) and (0,0); the cell between them, (-1,0), joins both.
  const { s, at } = position({ black: [[-2, 0], [0, 0]], roll: 3 });
  assert.equal(placements(s).mode, "exact");
  assert.deepEqual(legalSet(s), new Set([at([-1, 0])]));
  s.roll = 2;
  const two = legalSet(s);
  assert.ok(two.has(at([1, 0])) && !two.has(at([-1, 0])));
  for (const id of two) assert.ok(s.board.neighbours[id].some((n) => s.cells[n] === 1));
});

test("white stones do not count towards Black's result", () => {
  const { s, at } = position({ black: [[0, 0]], white: [[1, 0], [2, 0]], roll: 2 });
  const legal = legalSet(s);
  assert.ok(legal.has(at([0, 1])));
  assert.ok(!legal.has(at([3, 0])) && !legal.has(at([2, -1])), "next to White only is a 1");
});

test("a 6 may make a group of 6 or more", () => {
  // A black line of 6 from (-3,0) to (2,0): any cell touching it makes 7+.
  const line = [-3, -2, -1, 0, 1, 2].map((q) => [q, 0]);
  const { s, at } = position({ black: line, roll: 6 });
  const { target, mode } = placements(s);
  assert.equal(target, 6);
  assert.equal(mode, "exact");
  assert.ok(legalSet(s).has(at([3, 0])));
  game.applyMove(s, [at([3, 0])]);
  assert.equal(game.piecesOf(s).find((p) => p.id === at([3, 0])).label, "7");
  // A 5 can never grow it.
  const five = position({ black: line, roll: 5 }).s;
  assert.ok(!legalSet(five).has(at([3, 0])));
});

test("with no cell giving the roll, step down to the largest smaller result", () => {
  // Groups of 1 and 2 far apart: a 5 is impossible, a 4 too; a 3 is possible.
  const { s } = position({ black: [[-3, 0], [2, 0], [3, 0]], roll: 5 });
  const { target, mode } = placements(s);
  assert.equal(target, 3);
  assert.equal(mode, "down");
  assert.match(game.turnHint(s), /rolled 5, but no group of 5 is possible: make a group of 3/);
});

test("with every cell giving more than the roll, take the smallest result", () => {
  // Black on every cell but two, so both join Black's one big group.
  const s = newGame(game, { size: 4, swap: "off" });
  s.cells.fill(1);
  const centre = s.board.at(0, 0), corner = s.board.at(3, 0);
  s.cells[centre] = 0;
  s.cells[corner] = 0;
  s.stones = 35;
  s.phase = "place";
  s.roll = 1;
  const { target, mode, cells } = placements(s);
  assert.equal(mode, "up");
  assert.equal(target, 6);
  assert.deepEqual(new Set(cells), new Set([centre, corner]));
  assert.match(game.turnHint(s), /every cell makes a larger group/);
});

test("a full board compares group sizes largest first", () => {
  assert.equal(decider([9, 3], [7, 5]), "Largest group: Black 9, White 7.");
  assert.equal(decider([6, 4, 1], [6, 3, 2]), "Tied on the largest 1 group; group 2 decides: Black 4, White 3.");
  assert.equal(decider([5, 5, 2], [5, 5]), "Tied on the largest 2 groups; group 3 decides: Black 2, White 0.");

  // Fill all but one cell: Black holds the top half, White the rest.
  const s = newGame(game, { size: 4, swap: "off" });
  for (const c of s.board.cells) s.cells[c.id] = c.coord.r < 0 ? 1 : 2;
  const last = s.board.at(0, 0);
  s.cells[last] = 0;
  s.stones = 36;
  s.turn = 1;
  s.phase = "place";
  s.roll = 6;
  // Black (15 stones) adds the centre to their 15-group; White has 21.
  game.applyMove(s, [last]);
  assert.deepEqual(game.outcome(s), { winner: 2 });
  assert.deepEqual(game.legalMoves(s), []);
  assert.equal(game.outcomeLines(s)[0], "Largest group: Black 16, White 21.");
});

test("the swap is decided before White's first roll", () => {
  const opts = { size: 4, swap: "on" };
  const { state: s } = replay(game, opts, ["roll:1", [18]]);
  assert.equal(game.toMove(s), 2);
  assert.deepEqual(game.legalMoves(s), ["keep", "swap"]);
  assert.equal(game.chanceView(s).length, 0);
  assert.match(game.turnHint(s), /roll to play on\. Or swap: Black's opening becomes White's, and Black moves next\./);

  const swapped = replay(game, opts, ["roll:1", [18], "swap"]).state;
  assert.equal(swapped.cells[18], 2, "Black's stone is now White's");
  assert.equal(game.toMove(swapped), CHANCE, "a roll follows the swap");
  assert.equal(game.currentPlayer(swapped), 1, "and it is Black's");
  assert.ok(!game.legalMoves(swapped).includes("swap"));

  const kept = replay(game, opts, ["roll:1", [18], "keep", "roll:2"]).state;
  assert.equal(game.toMove(kept), 2);
  assert.ok(!game.legalMoves(kept).includes("swap"));
  assert.equal(kept.cells[18], 1);

  const off = replay(game, { size: 4, swap: "off" }, ["roll:1", [18]]).state;
  assert.equal(game.toMove(off), CHANCE, "no swap decision without the rule");
});

test("log text, die panel and markers", () => {
  const before = newGame(game, { size: 4, swap: "on" });
  assert.equal(describeMove(game, before, "roll:3", null), "rolled 3");
  assert.deepEqual(game.chanceView(before), [{ title: "Die", owner: 1, dice: [null], active: true }]);
  game.applyMove(before, "roll:3");
  assert.deepEqual(game.chanceView(before)[0].dice, [3]);
  const after = game.clone(before);
  const info = game.applyMove(after, [18]);
  assert.deepEqual(info, { size: 1, target: 1, mode: "down" });
  assert.equal(describeMove(game, before, [18], info), `${before.board.cells[18].tags.name} (1)`);
  assert.equal(describeMove(game, after, "keep", null), "no swap");
  assert.deepEqual(game.markers(after), [{ id: 18, kind: "square" }]);
  const placing = replay(game, { size: 4, swap: "off" }, ["roll:1", [18], "roll:1"]).state;
  const targets = game.markers(placing).filter((m) => m.kind === "target");
  assert.equal(targets.length, game.legalMoves(placing).length);
});

test("the score lists the leading group sizes, largest first", () => {
  const { s } = position({ black: [[-3, 0], [2, 0], [3, 0]], roll: 1 });
  assert.deepEqual(game.scoreSummary(s, 1), { main: "2 1", sub: "Black", title: "Black's groups, largest first: 2 1" });
  assert.equal(game.scoreSummary(s, 2).main, "–");
  const many = position({ black: [[-3, 0], [-1, 0], [1, 0], [3, 0], [0, 2], [0, -2]], roll: 1 }).s;
  assert.equal(game.scoreSummary(many, 1).main, "1 1 1 1 1 …");
});

test("the custom playout fills the board with legal placements", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const s = newGame(game, { size: 5, swap: "on" });
    const winner = game.playout(s, seededRng(seed));
    assert.ok(winner === 1 || winner === 2);
    assert.ok(s.cells.every((c) => c));
  }
});
