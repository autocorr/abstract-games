import { test } from "node:test";
import assert from "node:assert/strict";
import game from "../games/cliques/game.js";
import { newGame, replay, moveKey, optionAllowed, resolveOptions } from "../common/engine.js";
import { components, groupAt } from "../common/board/graph.js";
import { seededRng } from "../common/rng.js";

const B = 1, W = 2;

// A side-5 position from scratch: stones as [q, r, player].
function position(stones, { min = 3, turn = B } = {}) {
  const s = newGame(game, { size: 5, min, start: "empty" });
  for (const [q, r, p] of stones) s.cells[s.board.at(q, r)] = p;
  s.turn = turn;
  return s;
}

const at = (s, q, r) => s.board.at(q, r);

// Four isolated corner stones keep the count at or above a minimum of 3.
const SPARE = [[4, -4, B], [-4, 4, W], [0, -4, W], [0, 4, B]];
const keys = (s) => new Set(game.legalMoves(s).map(moveKey));
const clusterCount = (s) => components(s.board, (id) => s.cells[id] !== 0).length;

test("corner start: six corners alternate black and white; Black moves first", () => {
  for (const size of [3, 4, 5, 6, 7]) {
    const s = newGame(game, { size, start: "corners" });
    const stones = [...s.cells].filter(Boolean);
    assert.equal(stones.length, 6);
    assert.equal(stones.filter((p) => p === B).length, 3);
    for (const [d, id] of s.board.corners.entries()) {
      assert.equal(s.cells[id], d % 2 ? W : B);
      assert.equal(s.board.cells[id].tags.edges.length, 2, "corner cell");
    }
    assert.equal(game.toMove(s), B);
  }
  const empty = newGame(game, { size: 5, start: "empty" });
  assert.equal([...empty.cells].filter(Boolean).length, 0);
});

test("options exclude minimums the board cannot guarantee", () => {
  const allowed = (size, start) => [3, 5, 7, 9].filter((min) => optionAllowed(game, "min", min, { size, start }));
  assert.deepEqual(allowed(3, "empty"), [3]);
  assert.deepEqual(allowed(3, "corners"), [3, 5]);
  assert.deepEqual(allowed(4, "empty"), [3, 5, 7]);
  assert.deepEqual(allowed(4, "corners"), [3, 5, 7, 9]);
  for (const size of [5, 6, 7]) for (const start of ["empty", "corners"]) assert.deepEqual(allowed(size, start), [3, 5, 7, 9]);
  assert.deepEqual(resolveOptions(game, { size: 3, min: 9, start: "empty" }), { size: 3, min: 3, start: "empty" });
});

test("White may swap after Black's first move", () => {
  const s = replay(game, { size: 5, start: "corners" }, [[30]]).state;
  assert.ok(game.legalMoves(s).includes("swap"));
});

test("in the opening, every turn places a stone touching no other stone", () => {
  const s = position([[0, 0, B], [2, 0, W]], { min: 5 });
  const isolated = [];
  for (let id = 0; id < s.board.size; id++) {
    if (!s.cells[id] && s.board.neighbours[id].every((n) => !s.cells[n])) isolated.push(moveKey([id]));
  }
  assert.deepEqual([...keys(s)].sort(), isolated.sort());
  assert.ok(!keys(s).has(moveKey([at(s, -1, 0)])), "growing a cluster keeps the count");
});

test("no claims in the opening", () => {
  // A tied cluster (one black, one white stone) with 2 clusters of 5.
  const s = position([[0, 0, B], [1, 0, W], [4, -4, B]], { min: 5 });
  assert.ok(game.legalMoves(s).every((m) => !s.cells[m[0]]));
});

test("at or above the minimum, the count may fall to the minimum but not below", () => {
  const stones = [[0, 0, B], [2, 0, W], [-3, 0, B], [0, 3, W]];
  const join = (min) => { const s = position(stones, { min }); return keys(s).has(moveKey([at(s, 1, 0)])); };
  assert.ok(join(3), "4 -> 3 with minimum 3");
  assert.ok(!join(5), "4 -> 3 with minimum 5: below the count before the turn");
});

test("a pull that splits a cluster can make a joining placement legal", () => {
  // Clusters: {(0,0)}, {(2,0)} and the line (-3,0)-(-3,1)-(-3,2). Black at
  // (1,0) joins the first two (3 -> 2); pulling (-3,1) east to (-1,1)
  // splits the line, back to 3.
  const s = position([[0, 0, B], [2, 0, B], [-3, 0, B], [-3, 1, B], [-3, 2, B]], { min: 3 });
  const p = at(s, 1, 0);
  const k = keys(s);
  assert.ok(!k.has(moveKey([p])));
  assert.ok(k.has(moveKey([p, at(s, -3, 1), at(s, -1, 1)])));
  assert.ok(!k.has(moveKey([p, at(s, -3, 0), at(s, -1, 0)])), "pulling the end stone splits nothing");
  for (const m of game.legalMoves(s)) if (m[0] === p) assert.equal(m[1], at(s, -3, 1));

  game.applyMove(s, [p, at(s, -3, 1), at(s, -1, 1)]);
  assert.equal(clusterCount(s), 3);
  assert.equal(s.cells[at(s, -3, 1)], 0);
  assert.equal(s.cells[at(s, -1, 1)], B);
});

test("only friendly stones are pulled, along clear lines", () => {
  // White (-3,0) sees (-1,0) next to a Black placement at (0,0); a black
  // stone behind it is blocked.
  const s = position([[-3, 0, W], [-4, 0, B], [0, -3, B], ...SPARE]);
  const p = at(s, 0, 0);
  const k = keys(s);
  assert.ok(!k.has(moveKey([p, at(s, -3, 0), at(s, -1, 0)])), "white stone");
  assert.ok(![...k].some((key) => key.startsWith(`${p}-${at(s, -4, 0)}-`)), "blocked by the white stone");
  // (0,-3) slides south-east to (0,-1), next to the placed stone; stopping
  // at (0,-2) would leave it apart from the group.
  assert.ok(k.has(moveKey([p, at(s, 0, -3), at(s, 0, -1)])));
  assert.ok(!k.has(moveKey([p, at(s, 0, -3), at(s, 0, -2)])));
});

test("a pull may split the placed group if the stone stays connected", () => {
  // Black line (0,0)-(1,0)-(2,0); Black places at (3,0). Pulling (1,0) cuts
  // (0,0) off, which is allowed while the pulled stone itself lands in the
  // group of (2,0)-(3,0).
  const s = position([[0, 0, B], [1, 0, B], [2, 0, B], ...SPARE]);
  const p = at(s, 3, 0);
  const k = keys(s);
  assert.ok(k.has(moveKey([p, at(s, 1, 0), at(s, 2, -1)])), "north-east onto (2,-1), next to (2,0)");
  assert.ok(!k.has(moveKey([p, at(s, 1, 0), at(s, 1, -1)])), "north-west onto (1,-1) touches only the cut-off (0,0)");
  let splits = 0;
  for (const key of k) {
    const m = key.split("-").map(Number);
    if (m.length !== 3 || m[0] !== p) continue;
    const t = game.clone(s);
    game.applyMove(t, m);
    assert.ok(groupAt(t.board, p, (id) => t.cells[id] === B).includes(m[2]), "pulled stone joins the placed group");
    if (m[1] === at(s, 1, 0)) splits++;
  }
  assert.ok(splits > 0, "the middle stone can be pulled out of the line");
});

// Reference generator: every (placement, own stone, cell along a clear line
// from it) checked directly against the rules.
function bruteForce(s) {
  const { board } = s;
  const me = s.turn;
  const before = clusterCount(s);
  const need = before < s.min ? before + 1 : s.min;
  const out = new Set();
  for (let p = 0; p < board.size; p++) {
    if (s.cells[p]) continue;
    const t = game.clone(s);
    t.cells[p] = me;
    if (clusterCount(t) >= need) out.add(moveKey([p]));
    for (let src = 0; src < board.size; src++) {
      if (src === p || t.cells[src] !== me) continue;
      for (let d = 0; d < 6; d++) {
        for (let to = board.step(src, d); to >= 0 && !t.cells[to]; to = board.step(to, d)) {
          const u = game.clone(t);
          u.cells[src] = 0;
          u.cells[to] = me;
          if (groupAt(board, p, (id) => u.cells[id] === me).includes(to) && clusterCount(u) >= need) {
            out.add(moveKey([p, src, to]));
          }
        }
      }
    }
  }
  return out;
}

test("placement moves match a brute-force reading of the rules", () => {
  for (const [size, min, start] of [[4, 5, "corners"], [4, 7, "empty"], [5, 9, "corners"]]) {
    for (let seed = 1; seed <= 3; seed++) {
      const rng = seededRng(seed);
      const s = newGame(game, { size, min, start });
      for (let ply = 0; !game.outcome(s) && ply < 40; ply++) {
        const legal = game.legalMoves(s).filter((m) => Array.isArray(m) && !s.cells[m[0]]);
        assert.deepEqual(new Set(legal.map(moveKey)), bruteForce(s), `size ${size} seed ${seed} ply ${ply}`);
        const all = game.legalMoves(s);
        game.applyMove(s, all[Math.floor(rng() * all.length)]);
      }
    }
  }
});

test("a tied cluster can be claimed; the claim lapses when the tie is broken", () => {
  const s = position([[0, 0, B], [1, 0, W], ...SPARE]);
  const claim = [at(s, 0, 0)];
  assert.ok(keys(s).has(moveKey(claim)));
  game.applyMove(s, claim);
  assert.equal(s.claims.length, 1);
  assert.deepEqual(game.markers(s).filter((m) => m.kind === "dot").map((m) => m.id), [at(s, 0, 0)]);
  assert.equal(game.scoreSummary(s, B).main, 3, "two spare corners and the claim");
  assert.ok(!keys(s).has(moveKey([at(s, 1, 0)])), "White cannot claim it again");

  // A White placement elsewhere keeps the claim.
  const kept = game.clone(s);
  game.applyMove(kept, [at(s, -2, 2)]);
  assert.equal(kept.claims.length, 1);

  // White grows their group: the tie is broken and the claim lapses.
  game.applyMove(s, [at(s, 2, 0)]);
  assert.equal(s.claims.length, 0);
  assert.equal(game.scoreSummary(s, W).main, 3);
});

test("two claimed clusters that merge lose both claims", () => {
  const s = position([[0, 0, B], [1, 0, W], [3, 0, W], [3, 1, B], ...SPARE]);
  game.applyMove(s, [at(s, 0, 0)]);          // Black claims the first
  game.applyMove(s, [at(s, 3, 0)]);          // White claims the second
  assert.deepEqual(s.claims.map((c) => c.player), [B, W]);
  game.applyMove(s, [at(s, 2, 0)]);          // Black joins them, still tied 1-1
  assert.equal(s.claims.length, 0);
  assert.ok(keys(s).has(moveKey([at(s, 1, 0)])), "the merged cluster is claimable again");
});

test("the game ends with no move left for the player to move, all clusters decided", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = newGame(game, { size: 4, min: 5, start: seed % 2 ? "corners" : "empty" });
    game.playout(s, seededRng(seed));
    assert.ok(s.over);
    assert.deepEqual(game.legalMoves(s), []);
    const b = game.scoreSummary(s, B).main, w = game.scoreSummary(s, W).main;
    assert.equal(b + w, components(s.board, (id) => s.cells[id] !== 0).length, "every cluster decided");
    assert.equal(game.outcome(s).winner, b > w ? B : W);
    assert.notEqual(b, w);
  }
});

test("every allowed setup ends with exactly the minimum, an odd count: no draws", () => {
  for (const size of [3, 4, 5, 6]) for (const start of ["corners", "empty"]) for (const min of [3, 5, 7, 9]) {
    if (!optionAllowed(game, "min", min, { size, start })) continue;
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame(game, { size, min, start });
      game.playout(s, seededRng(seed));
      assert.equal(clusterCount(s), min, `size ${size} ${start} min ${min} seed ${seed}`);
      assert.notEqual(game.outcome(s).winner, 0);
    }
  }
});
