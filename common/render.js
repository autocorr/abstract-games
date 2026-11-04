// SVG board renderer. Draws any Board (see common/board/graph.js) as four
// layers: cells, selection highlights, pieces and markers. All sizes scale
// with board.unit so tilings of any geometry look alike.
//
// Boards with style "points" (Go-style, see square.js) are drawn as a
// continuous surface with grid lines (board.lines) and star points
// (board.dots); the cells stay as invisible-edged click targets.
//
// setBoard() can turn the whole drawing by a display rotation (e.g. 90
// degrees to fit a wide board on a portrait screen). Rules never see it; piece
// shadows and labels stay upright.

const NS = "http://www.w3.org/2000/svg";

export function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const pointsAttr = (poly) => poly.map(([x, y]) => `${+x.toFixed(4)},${+y.toFixed(4)}`).join(" ");

const DEFAULT_CELL_FILL = "#ffd890";
const CELL_STROKE = "#3a3f4a";
const HIGHLIGHT = "#ffd54f";
const MARKER_DOT = "#969ca6";

let filterSeq = 0;

// Bounding box "x y w h" of a viewBox string rotated by `deg` about the origin.
export function rotateViewBox(viewBox, deg) {
  if (!deg) return viewBox;
  const [x, y, w, h] = viewBox.split(" ").map(Number);
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => [px * c - py * s, px * s + py * c]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const f = (v) => +v.toFixed(4);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return [minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY].map(f).join(" ");
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
    svg.setAttribute("viewBox", rotateViewBox(board.viewBox, rotate));
    svg.replaceChildren();

    // The shadow offset is in the rotated frame: turn it back so shadows
    // always fall down the screen.
    const a = (-rotate * Math.PI) / 180;
    const [sx, sy] = [0.03 * u, 0.09 * u];
    const defs = svgEl("defs");
    const filter = svgEl("filter", { id: shadowId, x: "-60%", y: "-60%", width: "220%", height: "220%" });
    filter.appendChild(svgEl("feDropShadow", {
      dx: +(sx * Math.cos(a) - sy * Math.sin(a)).toFixed(5), dy: +(sx * Math.sin(a) + sy * Math.cos(a)).toFixed(5),
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
    const cellsG = svgEl("g", { class: "cells" + (points ? " points" : "") });
    cellNodes = board.cells.map((c) => {
      const fill = cellFill(c);
      const poly = svgEl("polygon", {
        class: "cell",
        "data-id": c.id,
        points: pointsAttr(c.poly),
        fill,
        // Points boards: stroke in the fill colour hides seams between cells.
        stroke: points ? fill : CELL_STROKE,
        "stroke-width": (points ? 0.01 : 0.025) * u,
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

    if (decor.length) {
      const g = svgEl("g", { "pointer-events": "none", "stroke-linecap": "round", fill: "none" });
      for (const { segments, stroke, halo, width = 0.1 } of decor) {
        const d = segments.map(([[x1, y1], [x2, y2]]) =>
          `M${+x1.toFixed(4)} ${+y1.toFixed(4)}L${+x2.toFixed(4)} ${+y2.toFixed(4)}`).join("");
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
    board.cells.forEach((c, i) => {
      const fill = cellFill(c);
      cellNodes[i].setAttribute("fill", fill);
      if (board.style === "points") cellNodes[i].setAttribute("stroke", fill);
    });
  }

  // pieces:   [{ id, player, label?, image? }]; image is a URL drawn in
  //           place of the disc (e.g. a chess piece), without a drop shadow
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
    const owner = new Map(pieces.map((p) => [p.id, p.player]));

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

    layers.pieces.replaceChildren();
    layers.images.replaceChildren();
    for (const p of pieces) {
      const c = board.cells[p.id];
      const spec = players[p.player] || {};
      if (p.image) {
        const s = 0.92 * u;
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
        const text = svgEl("text", {
          x: c.x, y: c.y, "font-size": 0.4 * u, "text-anchor": "middle",
          "dominant-baseline": "central", fill: spec.mark || "#fff",
          ...(rotation ? { transform: `rotate(${-rotation} ${c.x} ${c.y})` } : {}),
        });
        text.textContent = p.label;
        layers.pieces.appendChild(text);
      }
    }

    layers.markers.replaceChildren();
    for (const m of markers) {
      const c = board.cells[m.id];
      if (!c) continue;
      if (m.kind === "dot") {
        layers.markers.appendChild(svgEl("circle", { cx: c.x, cy: c.y, r: 0.14 * u, fill: MARKER_DOT }));
      } else if (m.kind === "ring" && owner.has(m.id)) {
        const spec = players[owner.get(m.id)] || {};
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
