import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/buoyancy-draw/game.js";
import { newGame, moveKey, CHANCE } from "../common/engine.js";

const { actions } = internals;

const fresh = (opts = {}) => newGame(game, opts);
// Squares by chess name (file letter, rank).
const sq = (name) => (Number(name[1]) - 1) * 6 + name.charCodeAt(0) - 97;
const keys = (moves) => moves.map(moveKey).sort();

// Draw marbles: a string such as "WWB".
function draw(s, marbles) {
  let info;
  for (const m of marbles) info = game.applyMove(s, `draw:${m}`);
  return info;
}

// An empty board with the given stacks (bottom to top), White (1, the
// bottom player) to draw.
function position(stacks) {
  const s = fresh();
  for (let id = 0; id < s.board.size; id++) {
    s.stacks[id] = [];
    s.tops[id] = 0;
  }
  for (const [name, players] of Object.entries(stacks)) {
    s.stacks[sq(name)] = players.slice();
    s.tops[sq(name)] = players[players.length - 1];
  }
  return s;
}

test("White plays from the bottom and moves first", () => {
  const s = fresh();
  assert.equal(game.players[1].name, "White");
  assert.equal(game.currentPlayer(s), 1);
  assert.deepEqual(s.stacks[s.board.house[1][0]], [1]);
  assert.ok(s.board.house[1].includes(sq("f1")), "the bottom corner");
});

test("15 men start on five rows each; the house is the nearest four (10 cells)", () => {
  const s = fresh();
  for (const p of [1, 2]) {
    assert.equal(s.stacks.filter((st) => st[0] === p).length, 15);
    assert.equal(s.board.house[p].length, 10);
  }
  // The fifth row starts filled but lies outside the house.
  for (const name of ["d3", "b1", "f5"]) {
    assert.deepEqual(s.stacks[sq(name)], [1], name);
    assert.ok(!s.board.house[1].includes(sq(name)), name);
  }
  assert.ok(s.board.house[1].includes(sq("e2")) && s.board.house[2].includes(sq("a6")));
});

test("the bag starts with the chosen marbles, and a turn draws until a black one", () => {
  const s = fresh();
  assert.deepEqual(s.bag.counts, { W: 15, B: 5 });
  assert.deepEqual(fresh({ whites: 10, blacks: 3 }).bag.counts, { W: 10, B: 3 });
  assert.equal(game.toMove(s), CHANCE);
  assert.deepEqual(game.chances(s), [{ move: "draw:W", p: 0.75 }, { move: "draw:B", p: 0.25 }]);
  draw(s, "WW");
  assert.equal(game.toMove(s), CHANCE);
  assert.equal(game.moveText(s, "draw:B", {}), "drew black: 2 actions");
  draw(s, "B");
  assert.equal(game.toMove(s), 1);
  assert.equal(s.actions, 2);
  assert.deepEqual(s.bag.counts, { W: 13, B: 4 });
  // From the start only the front row can step, into the middle row; there
  // is no passing.
  assert.ok(!game.legalMoves(s).includes("end"));
  game.applyMove(s, [sq("d3"), sq("d4")]);
  game.applyMove(s, [sq("d4"), sq("d5")]);   // capping Black's d5
  assert.deepEqual(s.stacks[sq("d5")], [2, 1]);
  // Two actions used: Black draws, from the same bag.
  assert.equal(s.turn, 2);
  assert.equal(game.toMove(s), CHANCE);
  assert.deepEqual(s.bag.drawn, ["W", "W", "B"]);
});

test("a black marble first means no action; every action must be taken while one is possible", () => {
  const s = fresh();
  draw(s, "B");
  assert.equal(s.turn, 2);
  draw(s, "WWWB");
  assert.equal(s.actions, 3);
  game.applyMove(s, [sq("c4"), sq("c3")]);
  game.applyMove(s, [sq("c3"), sq("c2")]);   // capping White's c2
  assert.equal(s.turn, 2);
  assert.equal(s.actions, 1);
  game.applyMove(s, [sq("d4"), sq("d3")]);
  assert.equal(s.turn, 1);
  assert.equal(s.turns, 2);

  // With actions left but none possible, the turn passes: White's men wait
  // in reserve while Black holds every cell of White's house.
  const t = position({});
  for (const id of t.board.house[1]) {
    t.stacks[id] = [2];
    t.tops[id] = 2;
  }
  t.reserve[1] = 2;
  draw(t, "WWB");
  assert.equal(game.outcome(t), null);
  assert.equal(t.turn, 2);
  assert.equal(game.toMove(t), CHANCE);
});

test("an empty bag is refilled with every marble", () => {
  const s = fresh({ whites: 5, blacks: 1 });
  const info = draw(s, "WWWWWB");
  assert.ok(info.refilled);
  assert.deepEqual(s.bag.counts, { W: 5, B: 1 });
  assert.deepEqual(s.bag.drawn, []);
  assert.equal(s.actions, 5);
});

test("bearing off sends your men to reserve; placing one is an action", () => {
  const s = position({ b1: [1, 2, 1], f2: [1], e1: [2], a6: [2] });
  draw(s, "WWB");
  assert.deepEqual(keys(actions(s, 1).filter((m) => m[0] === sq("b1"))), keys([[sq("b1")], [sq("b1"), sq("c1")]]));
  const before = game.clone(s);
  const info = game.applyMove(s, [sq("b1")]);
  assert.deepEqual(info, { player: 1, scored: 1, saved: 2 });
  assert.equal(game.moveText(before, [sq("b1")], info), "b1 off: 1 captured, 2 men to reserve");
  assert.equal(s.score[1], 1);
  assert.equal(s.reserve[1], 2);
  // Placements: the vacant cells of the house, not White's own f2 nor
  // Black's e1.
  const places = actions(s, 1).filter((m) => m.length === 1 && s.tops[m[0]] !== 1);
  assert.equal(places.length, 8);
  assert.ok(!places.some(([id]) => id === sq("e1") || id === sq("f2")));
  game.applyMove(s, [sq("f1")]);
  assert.equal(s.reserve[1], 1);
  assert.deepEqual(s.stacks[sq("f1")], [1]);
  assert.equal(game.moveText(s, [sq("d1")], {}), "placed d1");
  // That was the last action: Black's turn.
  assert.equal(s.turn, 2);
  assert.match(game.scoreSummary(s, 1).sub, /1 in reserve/);
});

test("a single may surrender only when blocked", () => {
  const blocked = position({ a5: [1], a6: [1], d6: [2] });
  assert.deepEqual(keys(internals.stackMoves(blocked, sq("a5"))), keys([[sq("a5")]]));
  const open = position({ a5: [1], d6: [2] });
  assert.deepEqual(keys(internals.stackMoves(open, sq("a5"))), keys([[sq("a5"), sq("a6")]]));
  const s = position({ a6: [1], b1: [1], d6: [2] });
  draw(s, "WB");
  const info = game.applyMove(s, [sq("a6")]);
  assert.deepEqual(info, { player: 1, lost: 1 });
  assert.equal(s.score[2], 1);
});

test("a player who controls no stack and has no reserve loses at once", () => {
  const s = position({ e4: [1], e5: [2], d4: [2, 1] });
  draw(s, "WB");
  game.applyMove(s, [sq("e4"), sq("e5")]);
  assert.deepEqual(game.outcome(s), { winner: 1 });
  assert.match(game.outcomeLines(s, game.outcome(s))[0], /Black controls no stack/);

  // A man in reserve keeps you in the game.
  const t = position({ e4: [1], e5: [2], d4: [2, 1] });
  t.reserve[2] = 1;
  draw(t, "WB");
  game.applyMove(t, [sq("e4"), sq("e5")]);
  assert.equal(game.outcome(t), null);
  draw(t, "WB");
  assert.ok(actions(t, 2).every((m) => m.length === 1 && t.board.house[2].includes(m[0])));
});

test("capturing all 15 wins", () => {
  const s = position({ b1: [2, 1], f6: [1] });
  s.score[1] = 14;
  draw(s, "WB");
  game.applyMove(s, [sq("b1")]);
  assert.deepEqual(game.outcome(s), { winner: 1 });
});
