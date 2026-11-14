import { test } from "node:test";
import assert from "node:assert/strict";
import { goldbergSphere, hemiGoldbergBoard } from "../common/board/goldberg.js";
import { validateBoard } from "../common/board/graph.js";

test("Goldberg spheres: 12 pentagons, the rest hexagons, 10T + 2 cells", () => {
  for (const [m, n] of [[1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [2, 2], [3, 3], [5, 0]]) {
    const { centres, rings } = goldbergSphere(m, n);
    const t = m * m + m * n + n * n;
    assert.equal(centres.length, 10 * t + 2, `GP(${m},${n})`);
    assert.equal(rings.filter((r) => r.length === 5).length, 12);
    assert.ok(rings.every((r) => r.length === 5 || r.length === 6));
    // Consecutive neighbours in a ring are themselves neighbours: the
    // corners between them are where three cells meet.
    rings.forEach((r) => r.forEach((k, i) => assert.ok(rings[k].includes(r[(i + 1) % r.length]))));
  }
});

test("hemi-Goldberg boards: half the cells, six pentagons, sound adjacency", () => {
  // GP(2, 0) has cells on the equator, one of each opposite pair kept.
  for (const [m, n, size, twisted] of [[2, 0, 21, 15], [1, 1, 16, 10], [3, 0, 46, 15], [5, 0, 126, 25], [3, 3, 136, 30]]) {
    const b = hemiGoldbergBoard(m, n);
    assert.equal(b.size, size);
    assert.deepEqual(validateBoard(b), []);
    assert.equal(b.cells.filter((c) => c.tags.pentagon).length, 6);
    b.neighbours.forEach((ns, a) => {
      assert.equal(new Set(ns).size, ns.length, "no cell touches another twice");
      assert.equal(ns.length, b.cells[a].tags.pentagon ? 5 : 6);
      // Twists agree from both sides.
      ns.forEach((k, t) => assert.equal(b.twists[k][b.neighbours[k].indexOf(a)], b.twists[a][t]));
    });
    assert.equal(b.twists.flat().filter(Boolean).length / 2, twisted, "adjacencies across the rim");
    assert.equal(new Set(b.cells.map((c) => c.tags.name)).size, size);
    const centre = b.cells.find((c) => c.tags.name === "1");
    assert.ok(centre.tags.pentagon && Math.hypot(centre.x, centre.y) < 1e-9);
  }
});

test("hemi-Goldberg boards: twisted adjacencies join cells across the rim", () => {
  const b = hemiGoldbergBoard(3, 0);
  b.neighbours.forEach((ns, a) => ns.forEach((k, t) => {
    const [p, q] = [b.cells[a], b.cells[k]];
    // A twisted neighbour is roughly opposite, out by the rim; a plain one
    // is close by.
    if (b.twists[a][t]) assert.ok(p.x * q.x + p.y * q.y < 0 && Math.hypot(p.x, p.y) > 0.7);
    else assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 2 * b.unit);
  }));
});

test("only centrally symmetric Goldberg polyhedra make hemi-boards", () => {
  assert.throws(() => hemiGoldbergBoard(2, 1), /not centrally symmetric/);
});

test("hemi-Goldberg boards: the rim and the copies of cells beyond it", () => {
  for (const [m, n, ring1] of [[1, 1, 10], [3, 0, 15], [5, 0, 25]]) {
    const b = hemiGoldbergBoard(m, n);
    // The rim runs along the circle |p| = 1, through the edges of the cells
    // with a twisted adjacency.
    assert.ok(b.rim.length > 0);
    for (const seg of b.rim) for (const [x, y] of seg) assert.ok(Math.abs(Math.hypot(x, y) - 1) < 0.15);
    const crossing = b.twists.flat().filter(Boolean).length;
    assert.equal(b.rim.length, crossing * 4, "four segments per edge across the rim");
    // Copies lie beyond the rim, ring by ring, each standing for a board cell
    // at the rim (for the first ring) and opposite where it is drawn.
    assert.equal(b.copies.filter((c) => c.ring === 1).length, ring1);
    assert.ok(b.copies.some((c) => c.ring === 2) && b.copies.every((c) => c.ring <= 2));
    for (const c of b.copies) {
      assert.ok(Math.hypot(c.x, c.y) > 1, "beyond the rim");
      const cell = b.cells[c.of];
      assert.ok(c.x * cell.x + c.y * cell.y < 0, "on the far side from its cell");
      if (c.ring === 1) assert.ok(b.twists[c.of].includes(1), "a cell at the rim");
      assert.equal(c.poly.length, cell.poly.length);
    }
  }
  assert.equal(hemiGoldbergBoard(3, 0, { copyRings: 1 }).copies.length, 15);
});
