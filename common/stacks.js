// Stacks of checkers drawn as piles of level bars (Broadcast,
// Buoyancy). Pure: no DOM.
//
// A stack is listed bottom to top as player numbers; the bottom checker is
// drawn lowest, the pile centred on the cell. Three styles, offered as the
// game's pieceStyles:
//   "shaded" (the default): every bar alike, on a cell shaded for the player
//     on top;
//   "capped": the top checker is a wider, taller bar;
//   "plain": every bar alike, thinning as the pile grows.
// Shaded and capped show a stack's height from `labelFrom` checkers up (on
// the right of a shaded pile, on a capped one's top bar). None casts a
// shadow.
//
// Sizes are in cells and fit a hexagon whose neighbours are a unit apart (a
// little over 1.15 tall); `scale` shrinks them for other cells.

export const stackStyles = { shaded: { name: "Shaded" }, capped: { name: "Capped" }, plain: { name: "Plain" } };

// The default cell shades under a shaded pile, by player (Black, White).
export const STACK_SHADES = { 1: "#8d8a84", 2: "#fffdf8" };

const PILE = 0.75, GAP = 0.018;
const TOP = { width: 0.76, height: 0.21 };

// -> { piecesOf(stacks, style), cappedPile(n) }: piecesOf turns the stacks
// (indexed by cell id) into pieces; cappedPile(n) is the height of a capped
// pile of n checkers, e.g. to place a marker clear of it.
export function stackDrawer({ scale = 1, labelFrom = Infinity, shades = STACK_SHADES } = {}) {
  const k = scale;
  const pile = PILE * k, gap = GAP * k;
  const top = { width: TOP.width * k, height: TOP.height * k };
  const restHeight = (rest) => (rest ? Math.min(0.087 * k, (pile - top.height - gap * rest) / rest) : 0);
  const cappedPile = (n) => top.height + (n - 1) * (restHeight(n - 1) + gap);

  function capped(id, stack) {
    const rest = stack.length - 1;
    const h = restHeight(rest);
    let y = cappedPile(stack.length) / 2;   // the bottom of the pile
    const out = [];
    for (let i = 0; i < rest; i++) {
      out.push({ id, player: stack[i], stroke: 0.018 * k, bar: { width: 0.58 * k, height: h, y: y - h / 2 } });
      y -= h + gap;
    }
    const cap = { id, player: stack[rest], stroke: 0.025 * k, bar: { ...top, y: y - top.height / 2, labelSize: 0.16 * k } };
    if (stack.length >= labelFrom) cap.label = String(stack.length);
    out.push(cap);
    return out;
  }

  function plain(id, stack, { x = 0, width = 0.66 * k } = {}) {
    const n = stack.length;
    const h = Math.min(0.115 * k, (pile - gap * (n - 1)) / n);
    const bottom = (n * h + (n - 1) * gap) / 2;
    return stack.map((player, i) => ({
      id, player, stroke: 0.018 * k, bar: { x, width, height: h, y: bottom - h / 2 - i * (h + gap) },
    }));
  }

  function shaded(id, stack) {
    const n = stack.length;
    const tile = { id, player: null, fill: shades[stack[n - 1]], tile: true };
    if (n < labelFrom) return [tile, ...plain(id, stack)];
    // Room for the height on the right: the pile moves left and narrows.
    const bars = plain(id, stack, { x: -0.1 * k, width: 0.5 * k });
    const cap = bars[n - 1];
    cap.label = String(n);
    cap.bar = { ...cap.bar, labelX: 0.33 * k, labelY: 0, labelSize: 0.24 * k };
    return [tile, ...bars];
  }

  const drawers = { shaded, capped, plain };
  return {
    cappedPile,
    piecesOf(stacks, style) {
      const draw = drawers[style] || shaded;
      const out = [];
      stacks.forEach((stack, id) => {
        if (stack.length) out.push(...draw(id, stack));
      });
      // Flat on the board: no drop shadows.
      return out.map((p) => ({ ...p, shadow: false }));
    },
  };
}
