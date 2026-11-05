// Dice: the other chance mechanism next to bags (bag.js). Pure: no DOM.
//
// Rolling a die is a chance ply whose move is "roll:<value>" (see CHANCE in
// engine.js): a game's chances() returns rollOutcomes(sides) and its
// applyMove() reads the value with rolledValue(move). Each die is its own
// ply, so a player may decide between the dice of a multi-die roll.

export const ROLL_PREFIX = "roll:";

// Chance outcomes for rolling one fair die: [{ move: "roll:1", p }, ...].
export function rollOutcomes(sides = 6) {
  return Array.from({ length: sides }, (_, i) => ({ move: ROLL_PREFIX + (i + 1), p: 1 / sides }));
}

export function isRollMove(move) {
  return typeof move === "string" && move.startsWith(ROLL_PREFIX);
}

// "roll:4" -> 4.
export function rolledValue(move) {
  if (!isRollMove(move)) throw new Error(`not a roll move: ${move}`);
  return Number(move.slice(ROLL_PREFIX.length));
}

// The chanceView panel showing dice (see chance-view.js): `values` holds
// each die's face, or null for a die not rolled yet.
export function dicePanel(values, { title = "Die", owner = null, active = false } = {}) {
  return { title, owner, dice: values, active };
}
