// SVG board renderer. Draws any Board (see common/board/graph.js) as four
// layers: cells, selection highlights, pieces and markers. All sizes scale
// with board.unit so tilings of any geometry look alike.
//
// Boards with style "points" (Go-style, see square.js) are drawn as a
// continuous surface with grid lines (board.lines) and star points
// (board.dots); the cells stay as invisible-edged click targets.
//
// setBoard() can turn the whole drawing by a display rotation (e.g. 90
// degrees to fit a wide board on a portrait screen, or any angle a game
// asks for). Rules never see it; piece shadows and labels stay upright.

import { svgEl } from "./ui/dom.js";
import { round4, edgeKey, rotatePoint } from "./board/graph.js";

const pointsAttr = (poly) => poly.map(([x, y]) => `${round4(x)},${round4(y)}`).join(" ");

// Path data for line segments [[[x1, y1], [x2, y2]], ...].
const segmentsPath = (segments) =>
  segments.map(([[x1, y1], [x2, y2]]) => `M${round4(x1)} ${round4(y1)}L${round4(x2)} ${round4(y2)}`).join("");

const DEFAULT_CELL_FILL = "#ffd890";
const CELL_STROKE = "#3a3f4a";
const HIGHLIGHT = "#ffd54f";
const MARKER_DOT = "#969ca6";
const LABEL_PX = 40;   // font size piece labels are set at before scaling (see drawPieces)

let filterSeq = 0;

// The viewBox "x y w h" of `board` drawn turned by `deg` (clockwise on
// screen) about the origin: the bounds of the rotated cells, with the same
// margin as the board's own viewBox. Exact at any angle, not just 90 degrees.
export function rotatedViewBox(board, deg) {
  if (!deg) return board.viewBox;
  const [vx] = board.viewBox.split(" ").map(Number);
  const pad = board.bounds.minX - vx;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const cell of board.cells) {
    for (const p of cell.poly) {
      const [rx, ry] = rotatePoint(p, deg);
      if (rx < minX) minX = rx;
      if (ry < minY) minY = ry;
      if (rx > maxX) maxX = rx;
      if (ry > maxY) maxY = ry;
    }
  }
  return [minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad].map(round4).join(" ");
}

// The board's outer edge as an SVG path: every cell edge that no other cell
// shares.
export function perimeterPath(board) {
  const count = new Map();
  const edges = [];
  for (const { poly } of board.cells) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const k = edgeKey(a, b);
      count.set(k, (count.get(k) || 0) + 1);
      edges.push([k, a, b]);
    }
  }
  return segmentsPath(edges.filter(([k]) => count.get(k) === 1).map(([, a, b]) => [a, b]));
}

// Width / height of a viewBox string.
export function viewBoxAspect(viewBox) {
  const [, , w, h] = viewBox.split(" ").map(Number);
  return w / h;
}

export function createRenderer(svg) {
  let board = null;
  let cellFill = () => DEFAULT_CELL_FILL;
  let cellNodes = [];
  let surface = null;
  let layers = null;
  let clickHandler = null;
  let rotation = 0;
  const seq = ++filterSeq;
  const shadowId = `pieceShadow${seq}`;
  const hatchId = `cellHatch${seq}`;
  const glowId = `checkGlow${seq}`;

  svg.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest(".cell") : null;
    if (!target || !clickHandler) return;
    clickHandler(Number(target.dataset.id));
  });

  // decor: [{ segments: [[[x1, y1], [x2, y2]], ...], stroke, halo?, width? }]
  // lines drawn over the cells (e.g. players' goal edges); width is in
  // multiples of board.unit, and a halo is a thin outline around the line.
  // rotate: display rotation in degrees (clockwise on screen).
  function setBoard(newBoard, fill, decor = [], rotate = 0) {
    board = newBoard;
    rotation = rotate;
    if (fill) cellFill = fill;
    const u = board.unit;
    svg.setAttribute("viewBox", rotatedViewBox(board, rotate));
    svg.replaceChildren();

    // The shadow offset is in the rotated frame: turn it back so shadows
    // always fall down the screen.
    const [dx, dy] = rotatePoint([0.03 * u, 0.09 * u], -rotate);
    const defs = svgEl("defs");
    const filter = svgEl("filter", { id: shadowId, x: "-60%", y: "-60%", width: "220%", height: "220%" });
    filter.appendChild(svgEl("feDropShadow", {
      dx: +dx.toFixed(5), dy: +dy.toFixed(5),
      stdDeviation: 0.1 * u, "flood-color": "#000", "flood-opacity": 0.5,
    }));
    defs.appendChild(filter);
    // Diagonal hatching for "shade" markers, and a red glow for "check".
    const hatch = svgEl("pattern", {
      id: hatchId, patternUnits: "userSpaceOnUse", width: 0.2 * u, height: 0.2 * u,
      patternTransform: "rotate(45)",
    });
    hatch.appendChild(svgEl("rect", { x: 0, y: 0, width: 0.07 * u, height: 0.2 * u, fill: "rgba(14, 15, 19, 0.3)" }));
    defs.appendChild(hatch);
    const glow = svgEl("radialGradient", { id: glowId });
    glow.append(
      svgEl("stop", { offset: "0%", "stop-color": "#ff1a1a", "stop-opacity": 0.95 }),
      svgEl("stop", { offset: "45%", "stop-color": "#e41a1a", "stop-opacity": 0.75 }),
      svgEl("stop", { offset: "100%", "stop-color": "#a90000", "stop-opacity": 0 }));
    defs.appendChild(glow);
    svg.appendChild(defs);
    const root = svgEl("g", rotate ? { transform: `rotate(${rotate})` } : {});
    svg.appendChild(root);

    const points = board.style === "points";
    // Boards with grid: false (e.g. a chessboard) draw their cells without
    // outlines and get a single border around the board instead.
    const plain = board.grid === false;
    // Points boards: one continuous surface under the cells, so the hairline
    // seams that anti-aliasing leaves between neighbouring cells show the
    // board colour rather than the page behind it.
    surface = null;
    if (points) {
      const { minX, minY, maxX, maxY } = board.bounds;
      surface = svgEl("rect", {
        x: minX, y: minY, width: maxX - minX, height: maxY - minY,
        fill: cellFill(board.cells[0]), "pointer-events": "none",
      });
      root.appendChild(surface);
    }
    const cellsG = svgEl("g", { class: "cells" + (points ? " points" : "") });
    cellNodes = board.cells.map((c) => {
      const fill = cellFill(c);
      const poly = svgEl("polygon", {
        class: "cell",
        "data-id": c.id,
        points: pointsAttr(c.poly),
        fill,
        // Points and plain boards: a hairline stroke in the fill colour hides
        // the anti-aliasing seams between cells.
        stroke: points || plain ? fill : CELL_STROKE,
        "stroke-width": (points ? 0.01 : plain ? 0.02 : 0.025) * u,
        "stroke-linejoin": "round",
      });
      cellsG.appendChild(poly);
      return poly;
    });
    root.appendChild(cellsG);

    if (points) {
      const grid = svgEl("g", { "pointer-events": "none", stroke: CELL_STROKE, "stroke-width": 0.03 * u, "stroke-linecap": "square" });
      for (const [x1, y1, x2, y2] of board.lines || []) grid.appendChild(svgEl("line", { x1, y1, x2, y2 }));
      for (const id of board.dots || []) {
        const c = board.cells[id];
        grid.appendChild(svgEl("circle", { cx: c.x, cy: c.y, r: 0.08 * u, fill: CELL_STROKE, stroke: "none" }));
      }
      root.appendChild(grid);
    }

    if (plain) {
      root.appendChild(svgEl("path", {
        d: perimeterPath(board), fill: "none", stroke: CELL_STROKE, "stroke-width": 0.05 * u,
        "stroke-linecap": "square", "pointer-events": "none",
      }));
    }

    if (decor.length) {
      const g = svgEl("g", { "pointer-events": "none", "stroke-linecap": "round", fill: "none" });
      for (const { segments, stroke, halo, width = 0.1 } of decor) {
        const d = segmentsPath(segments);
        if (halo) g.appendChild(svgEl("path", { d, stroke: halo, "stroke-width": (width + 0.08) * u }));
        g.appendChild(svgEl("path", { d, stroke, "stroke-width": width * u }));
      }
      root.appendChild(g);
    }

    // Overlays never intercept clicks: they always reach the cell below.
    layers = {
      highlights: svgEl("g", { "pointer-events": "none" }),
      pieces: svgEl("g", { filter: `url(#${shadowId})`, "pointer-events": "none" }),
      images: svgEl("g", { "pointer-events": "none" }),   // image pieces: no shadow
      markers: svgEl("g", { "pointer-events": "none" }),
    };
    root.append(layers.highlights, layers.pieces, layers.images, layers.markers);
  }

  function setCellFill(fill) {
    cellFill = fill;
    if (!board) return;
    if (surface) surface.setAttribute("fill", cellFill(board.cells[0]));
    board.cells.forEach((c, i) => {
      const fill = cellFill(c);
      cellNodes[i].setAttribute("fill", fill);
      if (board.style === "points" || board.grid === false) cellNodes[i].setAttribute("stroke", fill);
    });
  }

  // A piece's colours: its own fill and mark (neutral pieces, which belong
  // to no player), else its player's.
  const pieceSpec = (p, players) => (p.fill ? p : players[p.player] || {});

  // Rebuild the piece layers.
  function drawPieces(pieces, players) {
    const u = board.unit;
    layers.pieces.replaceChildren();
    layers.images.replaceChildren();
    for (const p of pieces) {
      const c = board.cells[p.id];
      const spec = pieceSpec(p, players);
      if (p.image) {
        // A full cell, as Lichess's chessground draws its pieces (12.5% of an
        // 8x8 board, background-size: cover); the margin is in the image.
        const s = u;
        layers.images.appendChild(svgEl("image", {
          href: p.image, x: c.x - s / 2, y: c.y - s / 2, width: s, height: s,
          ...(rotation ? { transform: `rotate(${-rotation} ${c.x} ${c.y})` } : {}),
        }));
        continue;
      }
      layers.pieces.appendChild(svgEl("circle", {
        cx: c.x, cy: c.y, r: 0.42 * u,
        fill: spec.fill || "#888", stroke: "#0e0f13", "stroke-width": 0.03 * u,
      }));
      if (p.label) {
        // Board units are about 1, and browsers lay out sub-pixel font sizes
        // imprecisely (Chromium misplaces the baseline), so the text is set
        // at LABEL_PX and scaled down to 0.4 of a cell.
        const text = svgEl("text", {
          "font-size": LABEL_PX, "font-weight": 700, "text-anchor": "middle",
          "dominant-baseline": "central", fill: spec.mark || "#fff",
          transform: `translate(${c.x} ${c.y})${rotation ? ` rotate(${-rotation})` : ""} scale(${(0.4 * u) / LABEL_PX})`,
        });
        text.textContent = p.label;
        layers.pieces.appendChild(text);
      }
    }
  }

  // pieces:   [{ id, player, label?, image?, fill?, mark? }]; image is a URL
  //           drawn in place of the disc (e.g. a chess piece), without a drop
  //           shadow; fill and mark colour a neutral piece (player null)
  // players:  game.players ({ [player]: { fill, mark } })
  // markers:  [{ id, kind, color? }]. Over the pieces: "ring" (colour follows
  //           the piece), "dot", and "target" (the highlight dot of a
  //           selectable cell). Under the pieces: "shade" (hatched cell),
  //           "square" (cell outline, default highlight colour) and "check"
  //           (red glow, e.g. under a King in check).
  // selected: cell ids in the current partial move
  // targets:  cell ids that would extend the partial move
  function draw({ pieces = [], players = {}, markers = [], selected = [], targets = [] }) {
    const u = board.unit;
    const owner = new Map(pieces.map((p) => [p.id, pieceSpec(p, players)]));

    layers.highlights.replaceChildren();
    for (const m of markers) {
      const c = board.cells[m.id];
      if (!c) continue;
      if (m.kind === "shade") {
        layers.highlights.appendChild(svgEl("polygon", { points: pointsAttr(c.poly), fill: `url(#${hatchId})` }));
      } else if (m.kind === "square") {
        const inset = c.poly.map(([x, y]) => [c.x + (x - c.x) * 0.94, c.y + (y - c.y) * 0.94]);
        layers.highlights.appendChild(svgEl("polygon", {
          points: pointsAttr(inset), fill: "none", stroke: m.color || HIGHLIGHT,
          "stroke-width": 0.06 * u, "stroke-linejoin": "round",
        }));
      } else if (m.kind === "check") {
        layers.highlights.appendChild(svgEl("circle", { cx: c.x, cy: c.y, r: 0.5 * u, fill: `url(#${glowId})` }));
      }
    }
    for (const id of selected) {
      layers.highlights.appendChild(svgEl("polygon", {
        points: pointsAttr(board.cells[id].poly),
        fill: "rgba(255, 213, 79, 0.25)",
        stroke: HIGHLIGHT,
        "stroke-width": 0.07 * u,
        "stroke-linejoin": "round",
      }));
    }

    drawPieces(pieces, players);

    layers.markers.replaceChildren();
    for (const m of markers) {
      const c = board.cells[m.id];
      if (!c) continue;
      if (m.kind === "dot") {
        layers.markers.appendChild(svgEl("circle", { cx: c.x, cy: c.y, r: 0.14 * u, fill: MARKER_DOT }));
      } else if (m.kind === "ring" && owner.has(m.id)) {
        const spec = owner.get(m.id);
        layers.markers.appendChild(svgEl("circle", {
          cx: c.x, cy: c.y, r: 0.26 * u, fill: "none",
          stroke: spec.mark || "#fff", "stroke-width": 0.06 * u,
        }));
      }
    }
    const targetIds = [...targets, ...markers.filter((m) => m.kind === "target").map((m) => m.id)];
    for (const id of targetIds) {
      const c = board.cells[id];
      layers.markers.appendChild(svgEl("circle", {
        cx: c.x, cy: c.y, r: 0.12 * u, fill: HIGHLIGHT, stroke: "#0e0f13", "stroke-width": 0.02 * u,
      }));
    }
  }

  return {
    setBoard,
    setCellFill,
    draw,
    onCellClick(handler) { clickHandler = handler; },
    get board() { return board; },
    get rotation() { return rotation; },
  };
}
