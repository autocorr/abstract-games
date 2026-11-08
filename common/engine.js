// Helpers built on the Game contract (see ARCHITECTURE.md). Pure: no DOM.

import { randInt } from "./rng.js";

// toMove() returns CHANCE when the next ply is a random event (a marble draw,
// a die roll). Chance plies are ordinary string moves recorded in the move
// list, so replay stays deterministic; game.chances(state) gives their
// probabilities. CHANCE is never a key of game.players or a winner.
export const CHANCE = 0;

export function isChance(game, state) {
  return !game.outcome(state) && game.toMove(state) === CHANCE;
}

// Pick a chance outcome by probability: [{ move, p }] -> move.
export function pickWeighted(outcomes, rng = Math.random) {
  let x = rng();
  for (const o of outcomes) {
    x -= o.p;
    if (x < 0) return o.move;
  }
  return outcomes[outcomes.length - 1].move;   // float round-off
}

// Sample the outcome of the chance ply at `state`.
export function sampleChance(game, state, rng = Math.random) {
  return pickWeighted(game.chances(state), rng);
}

// The player whose turn it is, for display: at a chance ply this is the
// player the draw belongs to (game.currentPlayer), not CHANCE.
export function currentPlayer(game, state) {
  if (game.outcome(state)) return null;
  const p = game.toMove(state);
  if (p !== CHANCE) return p;
  return game.currentPlayer ? game.currentPlayer(state) : null;
}

// Canonical string for a move: cell-id arrays join with "-", strings pass
// through. Used for equality, the URL hash and worker messages.
export function moveKey(move) {
  return Array.isArray(move) ? move.join("-") : String(move);
}

// Inverse of moveKey(): "17-23" -> [17, 23], "pass" -> "pass".
export function parseMoveKey(key) {
  return /^\d+(-\d+)*$/.test(key) ? key.split("-").map(Number) : key;
}

export function sameMove(a, b) {
  return moveKey(a) === moveKey(b);
}

// The legal move equal to `move`, or null. Callers play the returned object
// so that games always receive moves in their own canonical form.
export function findLegalMove(game, state, move) {
  const key = moveKey(move);
  for (const m of game.legalMoves(state)) if (moveKey(m) === key) return m;
  return null;
}

// An option's choices are plain values or { value, label } objects.
export const choiceValue = (c) => (typeof c === "object" ? c.value : c);
export const choiceValues = (spec) => spec.choices.map(choiceValue);

// The choice value of option `spec` written as `raw` (compared as strings,
// as read from a URL or a control), or undefined if there is none.
export function parseChoice(spec, raw) {
  return choiceValues(spec).find((v) => String(v) === String(raw));
}

// Is `value` of option `key` allowed alongside the other values in `opts`?
// Options may declare allowed(value, opts) to rule out combinations.
export function optionAllowed(game, key, value, opts) {
  const spec = game.options[key];
  return !spec.allowed || spec.allowed(value, opts);
}

// Is option `key` in play alongside the other values in `opts`? Options
// may declare inactive(opts) when they mean nothing with the others (e.g.
// a choice of pieces when the pieces are drawn at random); Setup greys them
// out, and their value is kept but ignored.
export function optionActive(game, key, opts) {
  const spec = game.options[key];
  return !spec.inactive || !spec.inactive(opts);
}

// Resolve option values against the game's declared options: unknown keys are
// dropped and missing or invalid values fall back to the default. Then, in
// declaration order, a value not allowed alongside the others falls back to
// the nearest allowed choice before it in the list (or the first allowed).
export function resolveOptions(game, given = {}) {
  const out = {};
  for (const [key, spec] of Object.entries(game.options || {})) {
    out[key] = parseChoice(spec, given[key]) ?? spec.default;
  }
  for (const [key, spec] of Object.entries(game.options || {})) {
    if (optionAllowed(game, key, out[key], out)) continue;
    const values = choiceValues(spec);
    const ok = values.filter((v) => optionAllowed(game, key, v, out));
    const before = values.slice(0, values.indexOf(out[key])).filter((v) => ok.includes(v));
    out[key] = before.length ? before[before.length - 1] : ok[0];
  }
  return out;
}

// A createBoard(opts) that builds each board once: boards depend only on
// the options (those that `keyOf(opts)` names) and games never mutate them,
// so positions and replays can share them.
export function cachedBoards(keyOf, build) {
  const boards = new Map();
  return (opts) => {
    const key = keyOf(opts);
    if (!boards.has(key)) boards.set(key, build(opts));
    return boards.get(key);
  };
}

// Build the starting position for a set of options. Pass `board` to reuse a
// board already built for the same options.
export function newGame(game, options = {}, board = null) {
  const opts = resolveOptions(game, options);
  return game.initialState(board || game.createBoard(opts), opts);
}

// Rebuild a position by replaying moves from the start. Throws if a move is
// illegal; `strict: false` stops at the first illegal move instead and
// returns the moves that were applied. `board` reuses an existing board.
export function replay(game, options, moves, { strict = true, board = null } = {}) {
  const state = newGame(game, options, board);
  const applied = [];
  let lastInfo = null;
  for (const move of moves) {
    const legal = game.outcome(state) ? null : findLegalMove(game, state, move);
    if (!legal) {
      if (strict) throw new Error(`illegal move ${moveKey(move)} at ply ${applied.length}`);
      break;
    }
    lastInfo = game.applyMove(state, legal);
    applied.push(legal);
  }
  return { state, moves: applied, lastInfo };
}

// Play uniformly random legal moves until the game ends, sampling chance
// plies by probability; mutates `state` and returns the winner (0 for a
// draw). Games may supply a faster `playout`.
export function randomPlayout(game, state, rng = Math.random, maxPlies = 100000) {
  for (let ply = 0; ply < maxPlies; ply++) {
    const result = game.outcome(state);
    if (result) return result.winner;
    if (game.toMove(state) === CHANCE) {
      game.applyMove(state, sampleChance(game, state, rng));
      continue;
    }
    const moves = game.legalMoves(state);
    if (!moves.length) throw new Error("no legal moves but the game is not over");
    game.applyMove(state, moves[randInt(rng, moves.length)]);
  }
  throw new Error(`playout exceeded ${maxPlies} plies`);
}

// Default piece listing: state.cells[id] holds the owning player (0 = empty).
// `style` picks one of game.pieceStyles (default: the first).
export function piecesOf(game, state, style = Object.keys(game.pieceStyles || {})[0]) {
  if (game.piecesOf) return game.piecesOf(state, style);
  const out = [];
  const cells = state.cells;
  for (let id = 0; id < cells.length; id++) if (cells[id]) out.push({ id, player: cells[id] });
  return out;
}
