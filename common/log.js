// Text for the move log (see ARCHITECTURE.md). Pure: no DOM.
//
// Each ply gets a short description, and plies are grouped into turns: a
// turn is a run of consecutive plies with the same currentPlayer, so a
// marble draw is listed with the move that follows it.

import { currentPlayer, newGame } from "./engine.js";
import { isRollMove, rolledValue } from "./dice.js";

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Display name of a cell: its `name` tag ("a1"), or "#id" without one.
export function cellName(board, id) {
  const cell = board.cells[id];
  return (cell && cell.tags && cell.tags.name) || `#${id}`;
}

// Text for `move` played at `before` (the position before it). `info` is
// what applyMove returned; `scheme` is the active colour scheme (or null),
// whose marbles, if any, name the marble colours.
export function describeMove(game, before, move, info, scheme = null) {
  if (game.moveText) {
    const text = game.moveText(before, move, info, scheme);
    if (text != null) return text;   // "" leaves the ply out of the log
  }
  if (Array.isArray(move)) return move.map((id) => cellName(before.board, id)).join("–");
  if (isRollMove(move)) return `rolled ${rolledValue(move)}`;
  // "draw:R" and other "<action>:<marble>" chance moves name the marble.
  const colon = move.indexOf(":");
  const marbles = (scheme && scheme.marbles) || game.marbles;
  if (colon > 0 && marbles && marbles[move.slice(colon + 1)]) {
    const action = move.slice(0, colon);
    const name = marbles[move.slice(colon + 1)].name.toLowerCase();
    return `${action === "draw" ? "drew" : action} ${name}`;
  }
  return moveLabel(game, before, move);
}

// Label of a string move such as "pass", for its button and the log:
// game.moveLabel(state, move), then game.moveLabels[move], then the move
// itself capitalised.
export function moveLabel(game, state, move) {
  return (game.moveLabel && game.moveLabel(state, move)) ||
    (game.moveLabels && game.moveLabels[move]) || capitalise(move);
}

// Log entry for one ply: { player, text }, where player is the player whose
// turn the ply belongs to (null if none). Mutates `state` by playing `move`.
export function playAndDescribe(game, state, move, scheme = null) {
  const player = currentPlayer(game, state);
  const before = game.clone(state);
  const info = game.applyMove(state, move);
  return { entry: { player, text: describeMove(game, before, move, info, scheme) }, info };
}

// Log entries for a whole (legal) move list.
export function logEntries(game, options, moves, { board = null, scheme = null } = {}) {
  const state = newGame(game, options, board);
  return moves.map((move) => playAndDescribe(game, state, move, scheme).entry);
}

// The cursor one ply back (dir -1) or forward (dir 1) from `cursor` (the
// number of plies played), passing over plies left out of the log: the
// position after one is the position before it, as far as the log shows.
export function stepCursor(entries, cursor, dir) {
  let n = cursor + dir;
  while (n > 0 && n < entries.length && !entries[n - 1].text) n += dir;
  return Math.max(0, Math.min(entries.length, n));
}

// Group entries into turns: [{ number, player, plies: [{ index, text }] }],
// where index is the ply's position in the move list. Only players' turns
// are numbered: plies that belong to no player (e.g. setting up a bag) get
// number null. Plies with empty text are left out, though they still end
// the turn before them if they are another player's.
export function groupTurns(entries) {
  const turns = [];
  let turn = null;
  let player = undefined;   // whose turn the last ply was in
  let number = 0;
  entries.forEach((entry, index) => {
    const changed = entry.player !== player;
    player = entry.player;
    if (changed) turn = null;
    if (!entry.text) return;
    if (!turn) {
      turn = { number: player == null ? null : ++number, player, plies: [] };
      turns.push(turn);
    }
    turn.plies.push({ index, text: entry.text });
  });
  return turns;
}
