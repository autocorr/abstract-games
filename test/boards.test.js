import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBoard, ray, lineLength, groupAt, liberties, opposite, gridName, fillsRectangle, goalMasks, connectsSides } from "../common/board/graph.js";
import { squareBoard } from "../common/board/square.js";
import { rhombusBoard, hexHexBoard, triangleBoard } from "../common/board/hex.js";

test("square board: coordinates, names and colour tags", () => {
  const b = squareBoard({ cols: 8 });
  assert.deepEqual(validateBoard(b), []);
  assert.equal(b.size, 64);
  const a1 = b.at(0, 0), h8 = b.at(7, 7);
  assert.equal(b.cells[a1].tags.name, "a1");
  assert.equal(b.cells[h8].tags.name, "h8");
  assert.equal(gridName(3, 1), "d2");
  assert.ok(b.cells[a1].y > b.cells[h8].y, "rank 1 is drawn at the bottom");
  assert.equal(b.cells[a1].tags.dark, true);
  assert.equal(b.cells[b.at(1, 0)].tags.dark, false);
  assert.deepEqual(b.cells[a1].tags.edges, ["S", "W"]);
  assert.equal(b.at(8, 0), -1);
  assert.equal(b.at({ col: 2, row: 3 }), b.at(2, 3));
  // Dabbaba sub-grids: a (2,0) step keeps the quad; a single step changes it.
  for (const c of b.cells) {
    for (const d of [0, 2, 4, 6]) {
      const one = b.step(c.id, d);
      const two = one >= 0 ? b.step(one, d) : -1;
      if (one >= 0) assert.notEqual(b.cells[one].tags.quad, c.tags.quad);
      if (two >= 0) assert.equal(b.cells[two].tags.quad, c.tags.quad);
    }
  }
});

test("square board adjacency modes", () => {
  const centre = (b) => b.neighbours[b.at(1, 1)].length;
  assert.equal(centre(squareBoard({ cols: 3 })), 4);
  assert.equal(centre(squareBoard({ cols: 3, adjacency: "diag" })), 4);
  assert.equal(centre(squareBoard({ cols: 3, adjacency: "king" })), 8);
  const diag = squareBoard({ cols: 3, adjacency: "diag" });
  assert.deepEqual(validateBoard(diag), []);
  assert.ok(diag.neighbours[diag.at(1, 1)].every((n) => diag.cells[n].tags.dark));
  assert.throws(() => squareBoard({ cols: 3, adjacency: "hex" }));
});

test("square board steps, rays and lines", () => {
  const b = squareBoard({ cols: 5 });
  const c = b.at(2, 2);
  assert.equal(b.step(c, 0), b.at(3, 2));   // E
  assert.equal(b.step(c, 1), b.at(3, 3));   // NE
  assert.equal(b.step(c, 6), b.at(2, 1));   // S
  assert.equal(opposite(b, 1), 5);
  assert.deepEqual(ray(b, c, 2), [b.at(2, 3), b.at(2, 4)]);
  const marked = new Set([b.at(0, 0), b.at(1, 1), c, b.at(3, 3)]);
  assert.equal(lineLength(b, c, 1, 5, (id) => marked.has(id)), 4);
  assert.equal(lineLength(b, c, 0, 4, (id) => marked.has(id)), 1);
});

test("points boards carry grid lines and star points", () => {
  const b = squareBoard({ cols: 7, style: "points", stars: [[3, 3]] });
  assert.equal(b.style, "points");
  assert.equal(b.lines.length, 2 * 7 * 6);
  assert.deepEqual(b.dots, [b.at(3, 3)]);
  assert.equal(b.neighbours[b.at(3, 3)].length, 4);
});

test("groups and liberties", () => {
  const b = squareBoard({ cols: 3 });
  const stones = new Set([b.at(0, 0), b.at(1, 0), b.at(2, 2)]);
  const group = groupAt(b, b.at(0, 0), (id) => stones.has(id)).sort((x, y) => x - y);
  assert.deepEqual(group, [b.at(0, 0), b.at(1, 0)]);
  assert.deepEqual(groupAt(b, b.at(1, 1), (id) => stones.has(id)), []);
  assert.deepEqual(liberties(b, group, (id) => !stones.has(id)), [b.at(2, 0), b.at(0, 1), b.at(1, 1)].sort((x, y) => x - y));
});

test("hex rhombus: edges, names and a proper 3-colouring", () => {
  const b = rhombusBoard(11);
  assert.deepEqual(validateBoard(b), []);
  assert.equal(b.size, 121);
  const counts = [0, 0, 0];
  for (const c of b.cells) {
    counts[c.tags.tri]++;
    assert.ok(b.neighbours[c.id].length <= 6);
    for (const n of b.neighbours[c.id]) assert.notEqual(b.cells[n].tags.tri, c.tags.tri);
  }
  assert.equal(counts.reduce((x, y) => x + y), 121);
  assert.deepEqual(b.cells[b.at(0, 0)].tags.edges, ["N", "W"]);
  assert.equal(b.cells[b.at(0, 0)].tags.name, "a1");
  assert.equal(b.cells.filter((c) => c.tags.edges.includes("S")).length, 11);
  const mid = b.at(5, 5);
  assert.equal(b.neighbours[mid].length, 6);
  for (let d = 0; d < 6; d++) {
    assert.ok(b.neighbours[mid].includes(b.step(mid, d)));
    assert.equal(b.step(b.step(mid, d), opposite(b, d)), mid);
  }
  const even = rhombusBoard(12);
  const evenCounts = [0, 0, 0];
  for (const c of even.cells) evenCounts[c.tags.tri]++;
  assert.deepEqual(evenCounts, [48, 48, 48]);
});

test("hex-hex: size, sides and corners", () => {
  for (const side of [1, 2, 5]) {
    const b = hexHexBoard(side);
    assert.deepEqual(validateBoard(b), []);
    assert.equal(b.size, 3 * side * (side - 1) + 1);
  }
  const b = hexHexBoard(4);
  const corners = b.cells.filter((c) => c.tags.edges.length === 2);
  assert.equal(corners.length, 6);
  for (let d = 0; d < 6; d++) assert.equal(b.cells.filter((c) => c.tags.edges.includes(d)).length, 4);
  for (const c of b.cells) for (const n of b.neighbours[c.id]) assert.notEqual(b.cells[n].tags.tri, c.tags.tri);
  assert.equal(b.neighbours[b.at(0, 0)].length, 6);
});

test("hex-hex: a1-style names from the top-left", () => {
  const b = hexHexBoard(3);
  assert.equal(b.cells[b.at(0, -2)].tags.name, "c1");   // top row starts at column c
  assert.equal(b.cells[b.at(-2, 0)].tags.name, "a3");   // west corner
  assert.equal(b.cells[b.at(0, 0)].tags.name, "c3");    // centre
  assert.equal(new Set(b.cells.map((c) => c.tags.name)).size, b.size);
});

test("triangle: rows, sides, distances and names", () => {
  for (const n of [1, 2, 9]) {
    const b = triangleBoard(n);
    assert.deepEqual(validateBoard(b), []);
    assert.equal(b.size, (n * (n + 1)) / 2);
  }
  const b = triangleBoard(5);
  for (const side of ["W", "E", "S"]) assert.equal(b.cells.filter((c) => c.tags.edges.includes(side)).length, 5);
  assert.equal(b.cells.filter((c) => c.tags.edges.length === 2).length, 3);
  for (const c of b.cells) {
    assert.equal(c.coord.d.reduce((a, x) => a + x, 0), 4);
    assert.ok(b.neighbours[c.id].length <= 6);
    for (const n of b.neighbours[c.id]) assert.notEqual(b.cells[n].tags.tri, c.tags.tri);
  }
  const apex = b.at(0, 0);
  assert.deepEqual(b.cells[apex].tags.edges, ["W", "E"]);
  assert.equal(b.cells[apex].tags.name, "a1");
  assert.equal(b.neighbours[apex].length, 2);
  assert.equal(b.cells[b.at(-2, 4)].tags.name, "c5");   // middle of the bottom row
  assert.deepEqual(b.cells[b.at(-2, 4)].coord.d, [2, 2, 0]);
  assert.equal(new Set(b.cells.map((c) => c.tags.name)).size, b.size);
});

test("fillsRectangle: square grids fill their bounds, hex boards do not", () => {
  assert.equal(fillsRectangle(squareBoard({ cols: 5 })), true);
  assert.equal(fillsRectangle(squareBoard({ cols: 7, style: "points" })), true);
  assert.equal(fillsRectangle(rhombusBoard(5)), false);
  assert.equal(fillsRectangle(hexHexBoard(3)), false);
});

test("goalMasks and connectsSides: a chain between a player's two sides", () => {
  const b = squareBoard({ cols: 4 });
  const goal = goalMasks(b, { 1: { sides: ["N", "S"] }, 2: { sides: ["W", "E"] } });
  assert.equal(goal[1][b.at(0, 0)], 2);   // a1: on S, Black's second side
  assert.equal(goal[2][b.at(0, 0)], 1);   // and on W, White's first
  assert.equal(goal[1][b.at(1, 1)], 0);
  const cells = new Uint8Array(b.size);
  for (const row of [0, 1, 2]) cells[b.at(1, row)] = 1;
  assert.equal(connectsSides(b, cells, b.at(1, 0), goal[1]), false);
  cells[b.at(1, 3)] = 1;
  assert.equal(connectsSides(b, cells, b.at(1, 0), goal[1]), true);
  cells[b.at(1, 2)] = 2;   // cut by the other colour
  assert.equal(connectsSides(b, cells, b.at(1, 0), goal[1]), false);
});

test("goalMasks and connectsSides: three sides, as in Y", () => {
  const b = triangleBoard(5);
  const goal = goalMasks(b, { 1: { sides: ["W", "E", "S"] } })[1];
  assert.equal(goal[b.at(0, 0)], 3);    // the apex: W and E
  assert.equal(goal[b.at(-4, 4)], 5);   // bottom-left corner: W and S
  const cells = new Uint8Array(b.size);
  for (let r = 0; r < 5; r++) cells[b.at(0, r)] = 1;   // the right edge, from apex to corner
  assert.equal(connectsSides(b, cells, b.at(0, 0), goal), true, "two sides suffice by default");
  assert.equal(connectsSides(b, cells, b.at(0, 0), goal, 3), true, "the bottom-right corner touches S");
  cells[b.at(0, 4)] = 0;
  assert.equal(connectsSides(b, cells, b.at(0, 0), goal, 3), false);
});
