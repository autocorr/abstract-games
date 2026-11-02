// Module Web Worker that runs MCTS off the main thread.
//
// Request:  { id, gameUrl, options, moves: [moveKey], timeMs }
// Response: { id, move: moveKey | null } or { id, error }
//
// The position is rebuilt by replaying the move list, so no game state has
// to be serialised across the worker boundary.

import { mcts } from "./mcts.js";
import { replay, parseMoveKey, moveKey } from "../engine.js";

const games = new Map();

async function loadGame(url) {
  if (!games.has(url)) games.set(url, import(url).then((m) => m.default));
  return games.get(url);
}

self.onmessage = async (e) => {
  const { id, gameUrl, options, moves, timeMs } = e.data;
  try {
    const game = await loadGame(gameUrl);
    const { state } = replay(game, options, moves.map(parseMoveKey));
    const move = mcts(game, state, { timeMs });
    self.postMessage({ id, move: move === null ? null : moveKey(move) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
