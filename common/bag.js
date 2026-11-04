// Bags of coloured marbles: the chance mechanism of the Bag of Tricks games.
// Pure: no DOM.
//
// A bag is a plain object, cheap to copy with cloneBag():
//
//   { counts: { W: 3, B: 3, G: 1 },   // marbles still in the bag
//     drawn: ["B", "G"] }             // marbles drawn and set aside, in order
//
// Colours are short strings (no ".", "&", "=" or ":"); their order in
// `counts` is kept even at zero, so outcomes are listed in a stable order.
// Drawing is a chance ply whose move is "draw:<colour>" (see CHANCE in
// engine.js); a game's chances() returns drawOutcomes(bag) and its
// applyMove() calls drawMarble(bag, move).

export const DRAW_PREFIX = "draw:";

export function makeBag(counts) {
  return { counts: { ...counts }, drawn: [] };
}

export function cloneBag(bag) {
  return { counts: { ...bag.counts }, drawn: bag.drawn.slice() };
}

// Number of marbles in the bag (excluding those drawn).
export function bagSize(bag) {
  let n = 0;
  for (const c of Object.values(bag.counts)) n += c;
  return n;
}

export function isEmpty(bag) {
  return bagSize(bag) === 0;
}

// Total of each colour, in the bag and drawn: the bag as refilled.
export function totalCounts(bag) {
  const out = { ...bag.counts };
  for (const c of bag.drawn) out[c] = (out[c] || 0) + 1;
  return out;
}

// Chance outcomes for drawing one marble: [{ move: "draw:W", p }].
export function drawOutcomes(bag) {
  const n = bagSize(bag);
  if (!n) throw new Error("cannot draw from an empty bag");
  const out = [];
  for (const [colour, count] of Object.entries(bag.counts)) {
    if (count > 0) out.push({ move: DRAW_PREFIX + colour, p: count / n });
  }
  return out;
}

export function isDrawMove(move) {
  return typeof move === "string" && move.startsWith(DRAW_PREFIX);
}

// "draw:W" -> "W".
export function drawnColour(move) {
  if (!isDrawMove(move)) throw new Error(`not a draw move: ${move}`);
  return move.slice(DRAW_PREFIX.length);
}

// Move one marble of `colour` from the bag to the drawn pile. Accepts a
// colour or a "draw:<colour>" move; returns the colour.
export function drawMarble(bag, colourOrMove) {
  const colour = isDrawMove(colourOrMove) ? drawnColour(colourOrMove) : colourOrMove;
  if (!(bag.counts[colour] > 0)) throw new Error(`no ${colour} marble in the bag`);
  bag.counts[colour]--;
  bag.drawn.push(colour);
  return colour;
}

// The most recently drawn marble, or null.
export function lastDrawn(bag) {
  return bag.drawn.length ? bag.drawn[bag.drawn.length - 1] : null;
}

// Put `n` marbles of `colour` into the bag (from the supply).
export function addMarbles(bag, colour, n = 1) {
  bag.counts[colour] = (bag.counts[colour] || 0) + n;
}

// Take up to `n` marbles of `colour` out of the bag (to the supply); returns
// how many were removed.
export function removeMarbles(bag, colour, n = 1) {
  const k = Math.min(n, bag.counts[colour] || 0);
  if (colour in bag.counts) bag.counts[colour] -= k;
  return k;
}

// Return drawn marbles to the bag: all of them, or the last `n`.
export function returnDrawn(bag, n = bag.drawn.length) {
  for (const colour of bag.drawn.splice(bag.drawn.length - n, n)) addMarbles(bag, colour);
}

// Remove one drawn marble of `colour` from the drawn pile for good (it leaves
// play rather than going back on refill); returns whether one was found.
export function discardDrawn(bag, colour) {
  const i = bag.drawn.lastIndexOf(colour);
  if (i < 0) return false;
  bag.drawn.splice(i, 1);
  return true;
}

// Replace the most recent drawn marble of colour `from` with one of colour
// `to` (e.g. after a capture); the bag itself is unchanged.
export function replaceDrawn(bag, from, to) {
  const i = bag.drawn.lastIndexOf(from);
  if (i < 0) return false;
  bag.drawn[i] = to;
  if (!(to in bag.counts)) bag.counts[to] = 0;
  return true;
}

// Compact notation used by the booklet: "3W 3B 1G" (zero counts omitted).
export function formatCounts(counts) {
  return Object.entries(counts).filter(([, n]) => n > 0).map(([c, n]) => `${n}${c}`).join(" ");
}
