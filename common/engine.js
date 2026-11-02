// Helpers built on the Game contract (see ARCHITECTURE.md). Pure: no DOM.

import { randInt } from "./rng.js";

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

// Resolve option values against the game's declared options: unknown keys are
// dropped and missing or invalid values fall back to the default.
export function resolveOptions(game, given = {}) {
  const out = {};
  for (const [key, spec] of Object.entries(game.options || {})) {
    const choices = spec.choices.map((c) => (typeof c === "object" ? c.value : c));
    const raw = given[key];
    const match = choices.find((c) => String(c) === String(raw));
    out[key] = match !== undefined ? match : spec.default;
  }
  return out;
}

// Build the starting position for a set of options.
export function newGame(game, options = {}) {
  const opts = resolveOptions(game, options);
  const board = game.createBoard(opts);
  return game.initialState(board, opts);
}

// Rebuild a position by replaying moves from the start. Throws if a move is
// illegal; `strict: false` stops at the first illegal move instead and
// returns the moves that were applied.
export function replay(game, options, moves, { strict = true } = {}) {
  const state = newGame(game, options);
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

// Play uniformly random legal moves until the game ends; mutates `state` and
// returns the winner (0 for a draw). Games may supply a faster `playout`.
export function randomPlayout(game, state, rng = Math.random, maxPlies = 100000) {
  for (let ply = 0; ply < maxPlies; ply++) {
    const result = game.outcome(state);
    if (result) return result.winner;
    const moves = game.legalMoves(state);
    if (!moves.length) throw new Error("no legal moves but the game is not over");
    game.applyMove(state, moves[randInt(rng, moves.length)]);
  }
  throw new Error(`playout exceeded ${maxPlies} plies`);
}

// Default piece listing: state.cells[id] holds the owning player (0 = empty).
export function piecesOf(game, state) {
  if (game.piecesOf) return game.piecesOf(state);
  const out = [];
  const cells = state.cells;
  for (let id = 0; id < cells.length; id++) if (cells[id]) out.push({ id, player: cells[id] });
  return out;
}
