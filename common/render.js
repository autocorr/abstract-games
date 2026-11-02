// SVG board renderer. Draws any Board (see common/board/graph.js) as four
// layers: cells, selection highlights, pieces and markers. All sizes scale
// with board.unit so tilings of any geometry look alike.

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

export function createRenderer(svg) {
  let board = null;
  let cellFill = () => DEFAULT_CELL_FILL;
  let cellNodes = [];
  let layers = null;
  let clickHandler = null;
  const shadowId = `pieceShadow${++filterSeq}`;

  svg.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest(".cell") : null;
    if (!target || !clickHandler) return;
    clickHandler(Number(target.dataset.id));
  });

  function setBoard(newBoard, fill) {
    board = newBoard;
    if (fill) cellFill = fill;
    const u = board.unit;
    svg.setAttribute("viewBox", board.viewBox);
    svg.replaceChildren();

    const defs = svgEl("defs");
    const filter = svgEl("filter", { id: shadowId, x: "-60%", y: "-60%", width: "220%", height: "220%" });
    filter.appendChild(svgEl("feDropShadow", {
      dx: 0.03 * u, dy: 0.09 * u, stdDeviation: 0.1 * u, "flood-color": "#000", "flood-opacity": 0.5,
    }));
    defs.appendChild(filter);
    svg.appendChild(defs);

    const cellsG = svgEl("g", { class: "cells" });
    cellNodes = board.cells.map((c) => {
      const poly = svgEl("polygon", {
        class: "cell",
        "data-id": c.id,
        points: pointsAttr(c.poly),
        fill: cellFill(c),
        stroke: CELL_STROKE,
        "stroke-width": 0.025 * u,
        "stroke-linejoin": "round",
      });
      cellsG.appendChild(poly);
      return poly;
    });
    svg.appendChild(cellsG);

    // Overlays never intercept clicks: they always reach the cell below.
    layers = {
      highlights: svgEl("g", { "pointer-events": "none" }),
      pieces: svgEl("g", { filter: `url(#${shadowId})`, "pointer-events": "none" }),
      markers: svgEl("g", { "pointer-events": "none" }),
    };
    svg.append(layers.highlights, layers.pieces, layers.markers);
  }

  function setCellFill(fill) {
    cellFill = fill;
    if (board) board.cells.forEach((c, i) => cellNodes[i].setAttribute("fill", cellFill(c)));
  }

  // pieces:   [{ id, player, label? }]
  // players:  game.players ({ [player]: { fill, mark } })
  // markers:  [{ id, kind: "ring" | "dot" }] (ring colour follows the piece)
  // selected: cell ids in the current partial move
  // targets:  cell ids that would extend the partial move
  function draw({ pieces = [], players = {}, markers = [], selected = [], targets = [] }) {
    const u = board.unit;
    const owner = new Map(pieces.map((p) => [p.id, p.player]));

    layers.highlights.replaceChildren();
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
    for (const p of pieces) {
      const c = board.cells[p.id];
      const spec = players[p.player] || {};
      layers.pieces.appendChild(svgEl("circle", {
        cx: c.x, cy: c.y, r: 0.42 * u,
        fill: spec.fill || "#888", stroke: "#0e0f13", "stroke-width": 0.03 * u,
      }));
      if (p.label) {
        const text = svgEl("text", {
          x: c.x, y: c.y, "font-size": 0.4 * u, "text-anchor": "middle",
          "dominant-baseline": "central", fill: spec.mark || "#fff",
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
    for (const id of targets) {
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
  };
}
