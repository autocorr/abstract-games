// Rectangular square grids: chess and draughts boards, and Go-style boards
// played on the intersections ("points"). Pure: no DOM.
//
// Cells have coord { col, row } with col 0 = file a and row 0 = rank 1 at
// the bottom, so a1 is the bottom-left corner from the first player's side.
// Tags:
//   name:  "a1" ... (files a-z, ranks from 1)
//   dark:  checkerboard colour; a1 is dark, as on a chess board
//   quad:  0-3, the four sub-grids a Dabbaba (2,0 leaper) moves within:
//          (col % 2) + 2 * (row % 2)
//   edges: sides the cell lies on, from "S" (rank 1), "N", "W" (file a), "E"
//
// The board also gets dirs/at/step (see graph.js). dirs are the 8 king
// steps counter-clockwise from east, so opposite(board, d) = (d + 4) % 8:
//   0 E, 1 NE, 2 N, 3 NW, 4 W, 5 SW, 6 S, 7 SE
// Orthogonal directions are the even indices, diagonal the odd ones.

import { makeBoard, attachGrid, gridName } from "./graph.js";

export const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const ORTHOGONAL = [0, 2, 4, 6];
export const DIAGONAL = [1, 3, 5, 7];

// Go-style star points for an n x n points board, as [col, row]: the 3rd
// line (4th from 13), the centre on odd boards, and the side midpoints on
// large odd boards.
export function starPoints(n) {
  const k = n >= 13 ? 3 : 2, m = (n - 1) / 2, far = n - 1 - k;
  const out = [[k, k], [k, far], [far, k], [far, far]];
  if (n % 2) {
    out.push([m, m]);
    if (n >= 15) out.push([k, m], [far, m], [m, k], [m, far]);
  }
  return out;
}

// Build a cols x rows board.
//
//   adjacency: "orth" (shared edges; default), "diag" (diagonal only, as for
//              draughts) or "king" (both)
//   style:     "cells" (default) or "points" (pieces sit on grid
//              intersections; the renderer draws lines between orthogonal
//              neighbours instead of cell outlines)
//   stars:     for points boards, [[col, row], ...] star points to mark
//   grid:      false: draw the squares without outlines between them, only
//              a border around the board (as on a chessboard)
//   look:      "lichess": a chessboard drawn as Lichess draws it (implies
//              grid: false): no border or margin, slightly rounded corners,
//              coordinates inset in the edge squares, and green move hints
//              (see render.js)
export function squareBoard({ cols, rows = cols, adjacency = "orth", style = "cells", stars = [], grid = true, look = null } = {}) {
  const lichess = look === "lichess";
  const specs = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col, y = rows - 1 - row;
      const edges = [];
      if (row === 0) edges.push("S");
      if (row === rows - 1) edges.push("N");
      if (col === 0) edges.push("W");
      if (col === cols - 1) edges.push("E");
      specs.push({
        x, y,
        poly: [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]],
        coord: { col, row },
        tags: { name: gridName(col, row), dark: (col + row) % 2 === 0, quad: (col % 2) + 2 * (row % 2), edges },
      });
    }
  }

  const steps = { orth: ORTHOGONAL, diag: DIAGONAL, king: [...ORTHOGONAL, ...DIAGONAL] }[adjacency];
  if (!steps) throw new Error(`unknown adjacency ${adjacency}`);
  const id = (col, row) => (col >= 0 && col < cols && row >= 0 && row < rows ? row * cols + col : -1);
  const neighbours = specs.map(({ coord: { col, row } }) =>
    steps.map((d) => id(col + DIRS8[d][0], row + DIRS8[d][1])).filter((n) => n >= 0).sort((a, b) => a - b));

  const board = makeBoard(specs, { neighbours, pad: style === "points" || lichess ? 0 : 0.15 });
  board.cols = cols;
  board.rows = rows;
  board.style = style;
  if (!grid || lichess) board.grid = false;
  if (lichess) board.look = "lichess";
  attachGrid(board, DIRS8,
    (c) => (Array.isArray(c) ? c.join(",") : `${c.col},${c.row}`),
    (c, [dc, dr]) => [c.col + dc, c.row + dr]);

  if (style === "points") {
    board.lines = [];
    for (const c of board.cells) {
      for (const d of [0, 2]) {   // east and north, so each segment once
        const n = board.step(c.id, d);
        if (n >= 0) board.lines.push([c.x, c.y, board.cells[n].x, board.cells[n].y]);
      }
    }
    board.dots = stars.map(([col, row]) => board.at(col, row)).filter((n) => n >= 0);
  }
  return board;
}
