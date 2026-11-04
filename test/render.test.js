import { test } from "node:test";
import assert from "node:assert/strict";
import { perimeterPath, rotatedViewBox } from "../common/render.js";
import { squareBoard } from "../common/board/square.js";
import { hexHexBoard } from "../common/board/hex.js";

const segments = (path) => path.split("M").filter(Boolean).map((s) => s.split("L").map((p) => p.split(" ").map(Number)));

test("perimeterPath traces only the outer edge", () => {
  const sq = segments(perimeterPath(squareBoard({ cols: 8, grid: false })));
  assert.equal(sq.length, 32);   // 8 unit edges per side
  for (const [[x1, y1], [x2, y2]] of sq) {
    const onEdge = (v) => v === -0.5 || v === 7.5;
    assert.ok((x1 === x2 && onEdge(x1)) || (y1 === y2 && onEdge(y1)), `inner edge ${x1},${y1}-${x2},${y2}`);
  }
  // A hexagon of hexagons with side 3: 6 sides x (2 * 3 - 1) edges.
  assert.equal(segments(perimeterPath(hexHexBoard(3))).length, 30);
});

test("grid: false marks the board; the default keeps the grid", () => {
  assert.equal(squareBoard({ cols: 6, grid: false }).grid, false);
  assert.equal(squareBoard({ cols: 6 }).grid, undefined);
});

test("rotatedViewBox: unchanged at 0, width and height swap at 90", () => {
  const b = squareBoard({ cols: 4, rows: 2 });
  assert.equal(rotatedViewBox(b, 0), b.viewBox);
  const [, , w, h] = b.viewBox.split(" ").map(Number);
  const [, , w90, h90] = rotatedViewBox(b, 90).split(" ").map(Number);
  assert.ok(Math.abs(w90 - h) < 1e-3 && Math.abs(h90 - w) < 1e-3);
});
