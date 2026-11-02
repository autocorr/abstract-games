// AI move selection for the browser. Runs MCTS in a module Web Worker so the
// page stays responsive; if a worker cannot be created or fails to load, the
// search falls back to the main thread.

import { mcts } from "./mcts.js";
import { replay, moveKey, parseMoveKey } from "../engine.js";

const WORKER_URL = new URL("./worker.js", import.meta.url);

export class AIPlayer {
  constructor(game) {
    this.game = game;
    this.worker = null;
    this.workerBroken = typeof Worker === "undefined" || !game.url;
    this.pending = null;   // { id, resolve, reject, request }
    this.nextId = 1;
  }

  // Choose a move for the position reached by `moves` (an array of moves).
  // Resolves to a move, or null if the game is over. Superseded or cancelled
  // requests never resolve.
  choose({ options, moves, timeMs }) {
    this.cancel();
    const request = { options, moves: moves.map(moveKey), timeMs };
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending = { id, resolve, reject, request };
      if (this.workerBroken || !this.ensureWorker()) this.runLocally(id);
      else this.worker.postMessage({ id, gameUrl: this.game.url, ...request });
    });
  }

  // Abandon any search in progress. A busy worker is terminated so that a
  // long think does not keep burning CPU after a reset or undo.
  cancel() {
    if (!this.pending) return;
    this.pending = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  ensureWorker() {
    if (this.worker) return true;
    try {
      this.worker = new Worker(WORKER_URL, { type: "module" });
    } catch {
      this.workerBroken = true;
      return false;
    }
    this.worker.onmessage = (e) => this.settle(e.data);
    this.worker.onerror = (e) => {
      // Module workers report load failures here (e.g. unsupported browser).
      e.preventDefault();
      console.warn("AI worker failed; searching on the main thread instead.", e.message);
      this.workerBroken = true;
      this.worker = null;
      if (this.pending) this.runLocally(this.pending.id);
    };
    return true;
  }

  settle({ id, move, error }) {
    const p = this.pending;
    if (!p || p.id !== id) return;
    this.pending = null;
    if (error) p.reject(new Error(error));
    else p.resolve(move === null ? null : parseMoveKey(move));
  }

  runLocally(id) {
    // Yield first so the page can paint the "thinking" indicator.
    setTimeout(() => {
      const p = this.pending;
      if (!p || p.id !== id) return;
      try {
        const { options, moves, timeMs } = p.request;
        const { state } = replay(this.game, options, moves.map(parseMoveKey));
        const move = mcts(this.game, state, { timeMs });
        this.settle({ id, move: move === null ? null : moveKey(move) });
      } catch (err) {
        this.settle({ id, error: String(err) });
      }
    }, 20);
  }
}
