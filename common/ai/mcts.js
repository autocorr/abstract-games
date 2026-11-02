// Generic UCT Monte Carlo tree search over the Game contract. Pure: no DOM.

import { randomPlayout } from "../engine.js";
import { shuffle } from "../rng.js";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function makeNode(game, state, parent, move, mover) {
  const over = game.outcome(state);
  return {
    state,
    parent,
    move,
    mover,              // player who made `move` (credited with wins here)
    toMove: over ? 0 : game.toMove(state),
    terminal: over ? over.winner : null,
    visits: 0,
    wins: 0,
    children: [],
    untried: null,      // legal moves not yet expanded; filled lazily
  };
}

function untriedMoves(game, node, rng) {
  if (!node.untried) node.untried = node.terminal === null ? shuffle(game.legalMoves(node.state).slice(), rng) : [];
  return node.untried;
}

function bestUCT(node, c) {
  const logN = Math.log(node.visits);
  let best = null, bestValue = -Infinity;
  for (const child of node.children) {
    const value = child.wins / child.visits + c * Math.sqrt(logN / child.visits);
    if (value > bestValue) { bestValue = value; best = child; }
  }
  return best;
}

function selectAndExpand(game, root, c, rng) {
  let node = root;
  for (;;) {
    const untried = untriedMoves(game, node, rng);
    if (untried.length) {
      const move = untried.pop();
      const state = game.clone(node.state);
      game.applyMove(state, move);
      const child = makeNode(game, state, node, move, node.toMove);
      node.children.push(child);
      return child;
    }
    if (!node.children.length) return node;   // terminal
    node = bestUCT(node, c);
  }
}

function rollout(game, node, rng) {
  if (node.terminal !== null) return node.terminal;
  const state = game.clone(node.state);
  return game.playout ? game.playout(state, rng) : randomPlayout(game, state, rng);
}

function backpropagate(node, winner) {
  for (; node; node = node.parent) {
    node.visits++;
    if (winner === 0) node.wins += 0.5;
    else if (node.mover === winner) node.wins += 1;
  }
}

// Search from `state` (not mutated) and return the most-visited root move,
// or null if the game is already over. Stops after `timeMs` milliseconds or
// `iterations` iterations, whichever comes first; always runs at least one
// iteration so a legal move is returned even with zero time.
export function mcts(game, state, { timeMs = 1000, iterations = Infinity, c = Math.SQRT2, rng = Math.random } = {}) {
  const root = makeNode(game, game.clone(state), null, null, 0);
  if (root.terminal !== null) return null;
  const deadline = now() + Math.max(0, timeMs);
  let n = 0;
  do {
    const leaf = selectAndExpand(game, root, c, rng);
    backpropagate(leaf, rollout(game, leaf, rng));
    n++;
  } while (n < iterations && now() < deadline);

  let best = null;
  for (const child of root.children) if (!best || child.visits > best.visits) best = child;
  return best ? best.move : null;
}
