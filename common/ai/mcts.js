// Generic UCT Monte Carlo tree search over the Game contract. Pure: no DOM.
//
// Chance plies (toMove === CHANCE) become chance nodes: selection samples an
// outcome by its probability instead of applying UCT, and each outcome seen
// gets its own child. Averaging over sampled outcomes makes each decision
// node's value an expectation over the randomness ("expectimax" MCTS). The
// search never peeks at a real future draw: the shell samples those only once
// they are reached.
//
// Wins are credited to seats rather than colours (seatOf in engine.js), so
// that a swap move, after which the mover plays the other colour, is valued
// for the person who made it.

import { randomPlayout, pickWeighted, moveKey, parseMoveKey, replay, seatOf, CHANCE } from "../engine.js";
import { shuffle } from "../rng.js";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function makeNode(game, state, parent, move, mover) {
  const over = game.outcome(state);
  return {
    state,
    parent,
    move,
    mover,              // seat that made `move` (credited with wins here)
    toMove: over ? 0 : game.toMove(state),
    terminal: over ? winnerSeat(game, state, over.winner) : null,
    visits: 0,
    wins: 0,
    children: [],
    untried: null,      // legal moves not yet expanded; filled lazily
    outcomes: null,     // chance nodes: [{ move, p }] and children by move key
  };
}

// Draws stay 0; a winning colour becomes the seat playing it.
const winnerSeat = (game, state, winner) => (winner ? seatOf(game, state, winner) : 0);

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

// Chance node: sample an outcome; returns [child, isNew].
function sampleOutcome(game, node, rng) {
  if (!node.outcomes) node.outcomes = { list: game.chances(node.state), byKey: new Map() };
  const move = pickWeighted(node.outcomes.list, rng);
  const key = moveKey(move);
  let child = node.outcomes.byKey.get(key);
  if (child) return [child, false];
  const state = game.clone(node.state);
  game.applyMove(state, move);
  child = makeNode(game, state, node, move, CHANCE);
  node.outcomes.byKey.set(key, child);
  node.children.push(child);
  return [child, true];
}

function selectAndExpand(game, root, c, rng) {
  let node = root;
  for (;;) {
    if (node.terminal !== null) return node;
    if (node.toMove === CHANCE) {
      const [child, isNew] = sampleOutcome(game, node, rng);
      if (isNew) return child;
      node = child;
      continue;
    }
    const untried = untriedMoves(game, node, rng);
    if (untried.length) {
      const move = untried.pop();
      const state = game.clone(node.state);
      game.applyMove(state, move);
      const child = makeNode(game, state, node, move, seatOf(game, node.state, node.toMove));
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
  const winner = game.playout ? game.playout(state, rng) : randomPlayout(game, state, rng);
  return winnerSeat(game, state, winner);
}

function backpropagate(node, winner) {
  for (; node; node = node.parent) {
    node.visits++;
    if (winner === 0) node.wins += 0.5;
    else if (node.mover === winner) node.wins += 1;
  }
}

// Search from `state` (not mutated) and return the most-visited root move,
// or null if the game is already over or `state` is a chance ply. Stops after `timeMs` milliseconds or
// `iterations` iterations, whichever comes first; always runs at least one
// iteration so a legal move is returned even with zero time.
export function mcts(game, state, { timeMs = 1000, iterations = Infinity, c = Math.SQRT2, rng = Math.random } = {}) {
  const root = makeNode(game, game.clone(state), null, null, 0);
  if (root.terminal !== null || root.toMove === CHANCE) return null;
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

// A search request as the AI player sends it: the position is rebuilt by
// replaying `moves` (move keys) under `options`, so no game state has to
// cross the worker boundary. Returns the chosen move's key, or null.
export function searchMove(game, { options, moves, timeMs }) {
  const { state } = replay(game, options, moves.map(parseMoveKey));
  const move = mcts(game, state, { timeMs });
  return move === null ? null : moveKey(move);
}
