// Module Web Worker that runs MCTS off the main thread.
//
// Request:  { id, gameUrl, options, moves: [moveKey], timeMs }
// Response: { id, move: moveKey | null } or { id, error }
//
// The position is rebuilt by replaying the move list, so no game state has
// to be serialised across the worker boundary.

import { searchMove } from "./mcts.js";

const games = new Map();

async function loadGame(url) {
  if (!games.has(url)) games.set(url, import(url).then((m) => m.default));
  return games.get(url);
}

self.onmessage = async (e) => {
  const { id, gameUrl, ...request } = e.data;
  try {
    const game = await loadGame(gameUrl);
    self.postMessage({ id, move: searchMove(game, request) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
