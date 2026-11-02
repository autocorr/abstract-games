import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBoard, components, validateBoard, rotatePoint } from "../common/board/graph.js";

// A w x h block of unit squares centred on integer points.
function squares(w, h) {
  const cells = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      cells.push({
        x: c, y: r, coord: { c, r },
        poly: [[c - 0.5, r - 0.5], [c + 0.5, r - 0.5], [c + 0.5, r + 0.5], [c - 0.5, r + 0.5]],
      });
    }
  }
  return cells;
}

test("edge adjacency links squares sharing a side but not a corner", () => {
  const b = makeBoard(squares(3, 3));
  assert.deepEqual(validateBoard(b), []);
  assert.equal(b.size, 9);
  assert.deepEqual(b.neighbours[4], [1, 3, 5, 7]);   // centre
  assert.deepEqual(b.neighbours[0], [1, 3]);         // corner: no diagonal
  assert.equal(b.unit, 1);
});

test("viewBox covers the polygons plus padding", () => {
  const b = makeBoard(squares(2, 1), { pad: 0.5 });
  assert.equal(b.viewBox, "-1 -1 3 2");
  assert.deepEqual(b.bounds, { minX: -0.5, minY: -0.5, maxX: 1.5, maxY: 0.5 });
});

test("explicit neighbours override edge adjacency", () => {
  const spec = squares(2, 2);
  const diag = [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]];
  const b = makeBoard(spec, { neighbours: diag });
  assert.deepEqual(b.neighbours, diag);
  assert.deepEqual(validateBoard(b), []);
});

test("adjacency survives floating-point noise in shared vertices", () => {
  const spec = squares(2, 1);
  spec[1].poly = spec[1].poly.map(([x, y]) => [x + 1e-9, y - 1e-9]);
  assert.deepEqual(makeBoard(spec).neighbours, [[1], [0]]);
});

test("components finds connected groups", () => {
  const b = makeBoard(squares(3, 3));
  const owner = [1, 1, 0,
                 0, 0, 1,
                 1, 0, 1];
  const groups = components(b, (id) => owner[id] === 1).map((g) => g.sort((x, y) => x - y));
  assert.deepEqual(groups, [[0, 1], [5, 8], [6]]);
});

test("validateBoard reports asymmetric adjacency", () => {
  const b = makeBoard(squares(2, 1), { neighbours: [[1], []] });
  assert.equal(validateBoard(b).length, 1);
});

test("rotatePoint rotates counter-clockwise in standard axes", () => {
  const [x, y] = rotatePoint([1, 0], 90);
  assert.ok(Math.abs(x) < 1e-12 && Math.abs(y - 1) < 1e-12);
});
