// The game's line of moves with a cursor, for reviewing and branching (see
// ARCHITECTURE.md). Pure: no DOM.
//
// A timeline is { moves, cursor }: the board shows the position after
// moves[0 .. cursor). The game is *live* when the cursor is at the end. Plies
// after the cursor (the *tail*) stay available to step forward through until
// a different move is played from the cursor, which drops them (a branch).

import { sameMove } from "./engine.js";

export function timeline(moves = [], cursor = moves.length) {
  return { moves, cursor: clamp(cursor, moves.length) };
}

const clamp = (n, len) => Math.max(0, Math.min(len, Math.trunc(Number(n)) || 0));

export const isLive = (t) => t.cursor === t.moves.length;

// Move the cursor to `n` (clamped to the line).
export function jump(t, n) {
  return { moves: t.moves, cursor: clamp(n, t.moves.length) };
}

// Play `move` at the cursor. The next move of the tail is followed without
// branching; any other move replaces the tail. `branched` reports whether
// plies were dropped.
export function play(t, move) {
  const { moves, cursor } = t;
  if (cursor < moves.length && sameMove(moves[cursor], move)) {
    return { moves, cursor: cursor + 1, branched: false };
  }
  return { moves: [...moves.slice(0, cursor), move], cursor: cursor + 1, branched: cursor < moves.length };
}

// Where Undo goes: the latest ply count before the cursor whose position is
// a human decision (isHumanAt(n) for the position after n plies), or null
// if there is none (going back further would only reach positions where
// nobody can act). Chance plies before that decision are kept, so Undo
// never re-rolls them.
export function undoTarget(t, isHumanAt) {
  for (let n = t.cursor - 1; n >= 0; n--) if (isHumanAt(n)) return n;
  return null;
}
