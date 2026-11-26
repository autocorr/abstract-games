import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/projection/game.js";
import { newGame, replay } from "../common/engine.js";
import { seededRng } from "../common/rng.js";

const { targets, scores, hashCells, keyOf } = internals;
const BLACK = 1, WHITE = 2;

// A position in play on a board of the given side, with stones placed.
function position({ side = 3, black = [], white = [], turn = WHITE } = {}) {
  const s = newGame(game, { side });
  for (const id of black) s.cells[id] = BLACK;
  for (const id of white) s.cells[id] = WHITE;
  s.phase = "play";
  s.turn = turn;
  s.swapClosed = true;
  [s.h1, s.h2] = hashCells(s.board, s.cells);
  s.history.add(keyOf(s.h1, s.h2));
  return s;
}

const dist = (b, a, c) => Math.hypot(b.cells[a].x - b.cells[c].x, b.cells[a].y - b.cells[c].y);
const placements = (s) => game.legalMoves(s).filter(Array.isArray).map((m) => m[0]);
const centre = (b) => b.cells.reduce((best, c) => (Math.hypot(c.x - b.cells.cx, c.y - b.cells.cy) < best.d ? { id: c.id, d: Math.hypot(c.x - b.cells.cx, c.y - b.cells.cy) } : best), { d: Infinity }).id;
function middle(b) {
  b.cells.cx = (b.bounds.minX + b.bounds.maxX) / 2;
  b.cells.cy = (b.bounds.minY + b.bounds.maxY) / 2;
  return centre(b);
}

test("boards: points per size, two or three neighbours each, unique names", () => {
  const sizes = { 2: 37, 3: 73, 4: 121, 5: 181 };
  for (const [side, n] of Object.entries(sizes)) {
    const b = game.createBoard({ side: Number(side) });
    assert.equal(b.size, n);
    b.neighbours.forEach((ns, id) => {
      assert.ok(ns.length === 2 || ns.length === 3);
      for (const m of ns) assert.ok(Math.abs(dist(b, id, m) - 1) < 1e-9);
    });
    assert.equal(new Set(b.cells.map((c) => c.tags.name)).size, n);
  }
});

test("rays run straight through each neighbour at distances 1, 3, 4, 6, ...", () => {
  const b = game.createBoard({ side: 5 });
  for (let id = 0; id < b.size; id++) {
    assert.deepEqual(b.rays[id].map((r) => r[0]).sort((x, y) => x - y), b.neighbours[id]);
    for (const ray of b.rays[id]) {
      ray.forEach((n, k) => assert.ok(Math.abs(dist(b, id, n) - (1 + 3 * Math.floor(k / 2) + 2 * (k % 2))) < 1e-9));
    }
  }
});

test("the opening: Black places a black then a white stone, then White projects or swaps", () => {
  const s = newGame(game, { side: 3 });
  assert.equal(game.toMove(s), BLACK);
  assert.equal(game.legalMoves(s).length, 73);
  game.applyMove(s, [10]);
  assert.equal(game.toMove(s), BLACK);
  game.applyMove(s, [50]);
  assert.equal(s.cells[10], BLACK);
  assert.equal(s.cells[50], WHITE);
  assert.equal(game.toMove(s), WHITE);
  const moves = game.legalMoves(s);
  assert.ok(moves.includes("pass") && moves.includes("swap"));
  assert.deepEqual(placements(s), targets(s, WHITE));
  assert.ok(placements(s).every((id) => s.board.rays[50].some((r) => r.includes(id))));
});

test("swap: the opening stones change colour and Black moves first", () => {
  const { state: s } = replay(game, { side: 3 }, [[10], [50], "swap"]);
  assert.equal(s.cells[10], WHITE);
  assert.equal(s.cells[50], BLACK);
  assert.equal(game.toMove(s), BLACK);
  assert.ok(!game.legalMoves(s).includes("swap"));
  assert.deepEqual(placements(s), targets(s, BLACK));
});

test("a ray stops at the first stone of either colour", () => {
  const b = game.createBoard({ side: 4 });
  const a = middle(b);
  const ray = b.rays[a].reduce((x, y) => (y.length > x.length ? y : x));
  const s = position({ side: 4, white: [a], black: [ray[2]] });
  const t = new Set(placements(s));
  assert.ok(t.has(ray[0]) && t.has(ray[1]));
  assert.ok(!t.has(ray[2]) && !t.has(ray[3]));
  // A friendly stone blocks too: past it, only its own rays reach.
  const own = position({ side: 4, white: [a, ray[2]] });
  const seenFrom2 = b.rays[ray[2]].some((r) => r.includes(ray[3]));
  assert.equal(targets(own, WHITE).includes(ray[3]), seenFrom2);
});

// A stone surrounded on all sides but one, which the opponent fills: the
// point `x` (three neighbours) with `y` its last liberty.
function surround(side) {
  const b = game.createBoard({ side });
  const x = middle(b);
  const [y, ...rest] = b.neighbours[x];
  return { b, x, y, rest };
}

test("captures: enemy groups first, then the placed stone's own group (suicide)", () => {
  const { b, x, y, rest } = surround(4);
  const s = position({ side: 4, black: [x], white: rest, turn: WHITE });
  // A white stone along a ray to y (any point whose ray hits y first).
  const from = b.cells.find((c) => !s.cells[c.id] && c.id !== y && b.rays[c.id].some((r) => r[0] !== y && r.indexOf(y) > 0 && r.slice(0, r.indexOf(y)).every((n) => !s.cells[n]))).id;
  s.cells[from] = WHITE;
  [s.h1, s.h2] = hashCells(b, s.cells);
  assert.ok(placements(s).includes(y));
  const info = game.applyMove(s, [y]);
  assert.deepEqual(info.removed, [x]);
  assert.equal(s.cells[x], 0);
  assert.equal(s.cells[y], WHITE);

  // Suicide: a black stone placed into a point whose neighbours are all
  // white, none of them capturable, removes itself.
  const t = position({ side: 4, black: [], white: rest.concat([y]), turn: BLACK });
  const src = b.cells.find((c) => !t.cells[c.id] && c.id !== x && b.rays[c.id].some((r) => r.indexOf(x) >= 0 && r.slice(0, r.indexOf(x)).every((n) => !t.cells[n]))).id;
  t.cells[src] = BLACK;
  [t.h1, t.h2] = hashCells(b, t.cells);
  t.history = new Set([keyOf(t.h1, t.h2)]);
  // Its removal recreates the position, so the superko rule forbids it.
  assert.ok(!placements(t).includes(x));
});

test("ko: recapturing at once would recreate the position", () => {
  const b = game.createBoard({ side: 5 });
  const x = middle(b);
  // x's neighbours: y (the ko point) and a, b2 (white). y's other
  // neighbours: c, d (black).
  const y = b.neighbours[x].find((n) => b.neighbours[n].length === 3);
  const [a, b2] = b.neighbours[x].filter((n) => n !== y);
  const [c, d] = b.neighbours[y].filter((n) => n !== x);
  const near = new Set([x, y, a, b2, c, d, ...[x, y, a, b2, c, d].flatMap((id) => b.neighbours[id])]);
  const clear = (s, to) => b.cells.find((cell) => !near.has(cell.id) && !s.cells[cell.id] &&
    b.rays[cell.id].some((r) => r.indexOf(to) >= 0 && r.slice(0, r.indexOf(to)).every((n) => !s.cells[n]))).id;
  const s = position({ side: 5, black: [x, c, d], white: [a, b2], turn: WHITE });
  const w = clear(s, y);
  s.cells[w] = WHITE;
  const bl = clear(s, x);
  s.cells[bl] = BLACK;
  [s.h1, s.h2] = hashCells(b, s.cells);
  s.history = new Set([keyOf(s.h1, s.h2)]);
  assert.ok(placements(s).includes(y));
  assert.deepEqual(game.applyMove(s, [y]).removed, [x]);
  // Black's stone at bl still sees x, but retaking recreates the position.
  assert.ok(targets(s, BLACK).includes(x));
  assert.ok(!placements(s).includes(x));
});

test("scoring: stones plus vacant regions bordering one colour; a tie goes to the first to pass", () => {
  const s = position({ side: 2 });
  const b = s.board;
  const x = middle(b);
  s.cells[x] = BLACK;
  // A lone stone: every vacant point borders only black.
  assert.deepEqual(scores(s), { [BLACK]: b.size, [WHITE]: 0 });
  // One black and one white stone: one region bordering both.
  const far = b.cells.findIndex((c, id) => id !== x && !b.neighbours[x].includes(id));
  s.cells[far] = WHITE;
  assert.deepEqual(scores(s), { [BLACK]: 1, [WHITE]: 1 });
  [s.h1, s.h2] = hashCells(b, s.cells);
  s.turn = BLACK;
  game.applyMove(s, "pass");
  assert.equal(game.outcome(s), null);
  game.applyMove(s, "pass");
  assert.deepEqual(game.outcome(s), { winner: BLACK });
});

test("a pass between projections does not end the game", () => {
  const s = position({ side: 3, black: [5], white: [60], turn: WHITE });
  game.applyMove(s, "pass");
  game.applyMove(s, [placements(s)[0]]);
  game.applyMove(s, "pass");
  assert.equal(game.outcome(s), null);
});

test("random games end, and the playout finishes the game", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const rng = seededRng(seed);
    const s = newGame(game, { side: 3 });
    let plies = 0;
    while (!game.outcome(s)) {
      const moves = game.legalMoves(s).filter((m) => m !== "pass" || rng() < 0.05 || game.legalMoves(s).length === 1);
      game.applyMove(s, moves[Math.floor(rng() * moves.length)]);
      assert.ok(++plies < 5000);
    }
    const p = newGame(game, { side: 3 });
    const winner = game.playout(p, rng);
    assert.ok(winner === BLACK || winner === WHITE);
  }
});
