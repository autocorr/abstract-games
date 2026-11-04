// Text for the move log (see ARCHITECTURE.md). Pure: no DOM.
//
// Each ply gets a short description, and plies are grouped into turns: a
// turn is a run of consecutive plies with the same currentPlayer, so a
// marble draw is listed with the move that follows it.

import { currentPlayer, newGame } from "./engine.js";

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
    if (text) return text;
  }
  if (Array.isArray(move)) return move.map((id) => cellName(before.board, id)).join("–");
  // "draw:R" and other "<action>:<marble>" chance moves name the marble.
  const colon = move.indexOf(":");
  const marbles = (scheme && scheme.marbles) || game.marbles;
  if (colon > 0 && marbles && marbles[move.slice(colon + 1)]) {
    const action = move.slice(0, colon);
    const name = marbles[move.slice(colon + 1)].name.toLowerCase();
    return `${action === "draw" ? "drew" : action} ${name}`;
  }
  return (game.moveLabel && game.moveLabel(before, move)) ||
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

// Group entries into turns: [{ number, player, plies: [{ index, text }] }],
// where index is the ply's position in the move list. Only players' turns
// are numbered: plies that belong to no player (e.g. setting up a bag) get
// number null.
export function groupTurns(entries) {
  const turns = [];
  let turn = null;
  let number = 0;
  entries.forEach(({ player, text }, index) => {
    if (!turn || turn.player !== player) {
      turn = { number: player == null ? null : ++number, player, plies: [] };
      turns.push(turn);
    }
    turn.plies.push({ index, text });
  });
  return turns;
}
