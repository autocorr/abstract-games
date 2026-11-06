// DOM rendering of a game's chance devices: bags of marbles and dice.
//
// game.chanceView(state) returns panels:
//
//   [{ title: "Bag",            // optional heading
//      owner: 1 | 2 | null,     // player whose bag it is, for the swatch
//      counts: { W: 3, B: 2 },  // marbles in the bag
//      drawn: ["B", "G"],       // drawn marbles in order (last = newest)
//      active: true }]          // optional: the bag being drawn from now
//
// A dice panel (dicePanel() in dice.js) has `dice: [4, null]` instead of
// counts and drawn: each die's face, or null for one not rolled yet, and
// optionally `result`, text shown after the faces (e.g. "difference 4").
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
      panel.title || (panel.dice ? "Die" : "Bag"));

    if (panel.dice) {
      const faces = panel.dice.map((v) => h("span", { class: "die" + (v == null ? " blank" : "") }, v == null ? "–" : String(v)));
      const result = panel.result ? h("span", { class: "dice-result" }, panel.result) : null;
      container.append(h("div", { class: "bag" + (panel.active ? " active" : "") }, head, faces, result));
      continue;
    }

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
