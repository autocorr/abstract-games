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

const MAX_DRAWN = 14;

function h(tag, cls, ...children) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function marble(marbles, colour, cls = "") {
  const spec = (marbles && marbles[colour]) || { name: colour, fill: "#888" };
  const node = h("span", "marble" + (cls ? " " + cls : ""));
  node.style.background = spec.fill;
  node.title = spec.name;
  return node;
}

export function renderChance(container, game, state, marbles = game.marbles) {
  const panels = game.chanceView ? game.chanceView(state) : [];
  container.replaceChildren();
  container.hidden = !panels.length;
  for (const panel of panels) {
    const owner = panel.owner && game.players[panel.owner];
    const head = h("div", "bag-title",
      owner ? h("span", "turn-stone") : null,
      panel.title || "Bag");
    if (owner) head.firstChild.style.background = owner.fill;

    const contents = h("div", "bag-contents");
    for (const [colour, n] of Object.entries(panel.counts || {})) {
      contents.append(h("span", "bag-count" + (n ? "" : " zero"), marble(marbles, colour), String(n)));
    }

    const drawn = panel.drawn || [];
    const shown = drawn.slice(-MAX_DRAWN);
    const drawnRow = h("div", "bag-drawn",
      drawn.length > shown.length ? h("span", "bag-more", `+${drawn.length - shown.length}`) : null,
      ...shown.map((c, i) => marble(marbles, c, i === shown.length - 1 ? "small newest" : "small")));

    container.append(h("div", "bag" + (panel.active ? " active" : ""), head, contents, drawn.length ? drawnRow : null));
  }
}
