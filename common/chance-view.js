// DOM rendering of a game's chance devices (bags of marbles; dice later).
//
// game.chanceView(state) returns panels:
//
//   [{ title: "Bag",            // optional heading
//      owner: 1 | 2 | null,     // player whose bag it is, for the swatch
//      counts: { W: 3, B: 2 },  // marbles in the bag
//      drawn: ["B", "G"],       // drawn marbles in order (last = newest)
//      active: true }]          // optional: the bag being drawn from now
//
// game.marbles names and colours each marble: { W: { name, fill } }. A colour
// scheme may override them with its own `marbles` (same shape), so marbles
// can match recoloured cells.

import { h } from "./ui/dom.js";

const MAX_DRAWN = 14;

function marble(marbles, colour, cls = "") {
  const spec = (marbles && marbles[colour]) || { name: colour, fill: "#888" };
  return h("span", { class: "marble" + (cls ? " " + cls : ""), title: spec.name, style: `background:${spec.fill}` });
}

export function renderChance(container, game, state, marbles = game.marbles) {
  const panels = game.chanceView ? game.chanceView(state) : [];
  container.replaceChildren();
  container.hidden = !panels.length;
  for (const panel of panels) {
    const owner = panel.owner && game.players[panel.owner];
    const head = h("div", { class: "bag-title" },
      owner ? h("span", { class: "turn-stone", style: `background:${owner.fill}` }) : null,
      panel.title || "Bag");

    const contents = h("div", { class: "bag-contents" },
      Object.entries(panel.counts || {}).map(([colour, n]) =>
        h("span", { class: "bag-count" + (n ? "" : " zero") }, marble(marbles, colour), String(n))));

    const drawn = panel.drawn || [];
    const shown = drawn.slice(-MAX_DRAWN);
    const drawnRow = h("div", { class: "bag-drawn" },
      drawn.length > shown.length ? h("span", { class: "bag-more" }, `+${drawn.length - shown.length}`) : null,
      shown.map((c, i) => marble(marbles, c, i === shown.length - 1 ? "small newest" : "small")));

    container.append(h("div", { class: "bag" + (panel.active ? " active" : "") }, head, contents, drawn.length ? drawnRow : null));
  }
}
