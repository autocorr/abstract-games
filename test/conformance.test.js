// Contract checks run against every registered game (and the tic-tac-toe
// fixture, which keeps the suite itself honest). A new game that passes these
// will work with the shell, the AI and URL replay.

import { test } from "node:test";
import assert from "node:assert/strict";
import { games } from "../games.js";
import { validateBoard } from "../common/board/graph.js";
import {
  newGame, replay, moveKey, parseMoveKey, piecesOf, resolveOptions, sampleChance, currentPlayer, CHANCE,
} from "../common/engine.js";
import { mcts } from "../common/ai/mcts.js";
import { seededRng } from "../common/rng.js";
import tictactoe from "./fixtures/tictactoe.js";
import bagTictactoe from "./fixtures/bag-tictactoe.js";

const entries = [
  ...await Promise.all(games.map(async (g) => ({
    entry: g,
    game: (await import(new URL(`../${g.module}`, import.meta.url))).default,
  }))),
  { entry: { id: "tictactoe (fixture)" }, game: tictactoe },
  { entry: { id: "bag-tictactoe (fixture)" }, game: bagTictactoe },
];

// A ply belongs to a player or to chance.
const validMover = (game, p) => p === CHANCE || p in game.players;

// Chance plies: chances() lists exactly the legal moves, all strings, with
// positive probabilities summing to 1.
function checkChances(game, state, legal) {
  assert.equal(typeof game.chances, "function", "chance plies need game.chances()");
  const outcomes = game.chances(state);
  assert.ok(outcomes.length > 0, "chance ply without outcomes");
  let total = 0;
  for (const { move, p } of outcomes) {
    assert.equal(typeof move, "string", `chance move ${JSON.stringify(move)} must be a string`);
    assert.ok(p > 0, `chance outcome ${move} has p = ${p}`);
    total += p;
  }
  assert.ok(Math.abs(total - 1) < 1e-9, `chance probabilities sum to ${total}`);
  assert.deepEqual(outcomes.map((o) => moveKey(o.move)).sort(), legal.map(moveKey).sort(),
    "chances() and legalMoves() differ at a chance ply");
}

// Every combination of declared option values.
function optionSets(game) {
  let sets = [{}];
  for (const [key, spec] of Object.entries(game.options || {})) {
    const values = spec.choices.map((c) => (typeof c === "object" ? c.value : c));
    sets = sets.flatMap((s) => values.map((v) => ({ ...s, [key]: v })));
  }
  return sets;
}

// Comparable snapshot of a state, excluding the shared board.
function snapshot(state) {
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (k === "board") continue;
    out[k] = ArrayBuffer.isView(v) ? Array.from(v) : v;
  }
  return JSON.stringify(out);
}

// chanceView panels are well formed and use only declared marble colours.
function checkChanceView(game, state) {
  const panels = game.chanceView(state);
  assert.ok(Array.isArray(panels));
  for (const panel of panels) {
    for (const [colour, n] of Object.entries(panel.counts || {})) {
      assert.ok(game.marbles && colour in game.marbles, `undeclared marble colour ${colour}`);
      assert.ok(Number.isInteger(n) && n >= 0, `bad count ${colour}: ${n}`);
    }
    for (const colour of panel.drawn || []) assert.ok(colour in game.marbles, `undeclared drawn colour ${colour}`);
    if (panel.owner != null) assert.ok(panel.owner in game.players);
  }
}

const PLAYOUTS = 3;
const MAX_PLIES = 10000;

for (const { entry, game } of entries) {
  test(`${entry.id}: registry entry and metadata`, () => {
    assert.equal(typeof game.id, "string");
    assert.equal(typeof game.title, "string");
    if (entry.module) {
      assert.equal(game.id, entry.id, "registry id differs from game id");
      assert.ok(entry.path && entry.blurb && entry.board, "registry entry is incomplete");
      assert.ok(game.url && game.url.endsWith(entry.module), "game.url must be import.meta.url");
    }
    const players = Object.keys(game.players);
    assert.ok(players.length >= 1);
    for (const p of players) {
      assert.ok(Number.isInteger(Number(p)) && Number(p) > 0, `player key ${p}`);
      assert.ok(game.players[p].name && game.players[p].fill, `player ${p} needs name and fill`);
    }
    for (const [key, spec] of Object.entries(game.options || {})) {
      const values = spec.choices.map((c) => (typeof c === "object" ? c.value : c));
      assert.ok(spec.label, `option ${key} needs a label`);
      assert.ok(values.includes(spec.default), `option ${key} default is not a choice`);
    }
    assert.deepEqual(resolveOptions(game, {}), Object.fromEntries(
      Object.entries(game.options || {}).map(([k, s]) => [k, s.default])));
    for (const [key, scheme] of Object.entries(game.colorSchemes || {})) {
      assert.ok(scheme.name && typeof scheme.cellFill === "function", `colour scheme ${key}`);
    }
  });

  for (const options of optionSets(game)) {
    const label = `${entry.id} ${JSON.stringify(options)}`;

    test(`${label}: board is well formed`, () => {
      const board = game.createBoard(resolveOptions(game, options));
      assert.deepEqual(validateBoard(board), []);
      assert.ok(board.size > 0 && board.unit > 0 && board.viewBox);
      for (const scheme of Object.values(game.colorSchemes || {})) {
        for (const cell of board.cells) assert.equal(typeof scheme.cellFill(cell), "string");
      }
    });

    test(`${label}: initial position`, () => {
      const state = newGame(game, options);
      assert.equal(game.outcome(state), null);
      assert.ok(game.legalMoves(state).length > 0);
      assert.ok(validMover(game, game.toMove(state)));
    });

    test(`${label}: seeded random playouts obey the contract`, () => {
      for (let seed = 1; seed <= PLAYOUTS; seed++) {
        const rng = seededRng(seed);
        const state = newGame(game, options);
        const moves = [];
        let lastInfo;
        for (let ply = 0; ; ply++) {
          assert.ok(ply < MAX_PLIES, "game did not end");
          const result = game.outcome(state);
          const legal = game.legalMoves(state);
          if (result) {
            assert.equal(legal.length, 0, "legal moves after the game ended");
            assert.ok(result.winner === 0 || result.winner in game.players, `winner ${result.winner}`);
            if (game.outcomeLines) assert.ok(Array.isArray(game.outcomeLines(state, result)));
            break;
          }
          assert.ok(legal.length > 0, "no legal moves but the game is not over");
          const mover = game.toMove(state);
          assert.ok(validMover(game, mover), `toMove ${mover}`);
          if (mover === CHANCE) checkChances(game, state, legal);
          const shown = currentPlayer(game, state);
          assert.ok(shown === null || shown in game.players, `currentPlayer ${shown}`);

          const keys = legal.map(moveKey);
          assert.equal(new Set(keys).size, keys.length, "duplicate legal moves");
          for (const m of legal) {
            assert.ok(Array.isArray(m) ? m.every((id) => Number.isInteger(id) && id >= 0 && id < state.board.size)
              : typeof m === "string", `malformed move ${JSON.stringify(m)}`);
            assert.deepEqual(parseMoveKey(moveKey(m)), m);
          }

          for (const p of piecesOf(game, state)) {
            assert.ok(p.id >= 0 && p.id < state.board.size && p.player in game.players);
          }
          if (game.scoreSummary) for (const p of Object.keys(game.players)) game.scoreSummary(state, Number(p));
          if (game.turnHint) assert.equal(typeof game.turnHint(state), "string");
          if (game.chanceView) checkChanceView(game, state);
          if (game.moveLabel) for (const m of legal) if (typeof m === "string") game.moveLabel(state, m);

          // clone() must be independent of the original.
          const copy = game.clone(state);
          const before = snapshot(copy);
          const move = mover === CHANCE ? sampleChance(game, state, rng) : legal[Math.floor(rng() * legal.length)];
          lastInfo = game.applyMove(state, move);
          assert.equal(snapshot(copy), before, "applyMove on the original changed a clone");
          moves.push(move);
          if (game.markers) {
            for (const m of game.markers(state, move, lastInfo)) assert.ok(m.id >= 0 && m.id < state.board.size);
          }
        }

        // Replaying the move list reproduces the final position.
        const replayed = replay(game, options, moves);
        assert.equal(snapshot(replayed.state), snapshot(state));
        assert.deepEqual(replayed.lastInfo, lastInfo);
      }
    });

    if (game.playout) {
      test(`${label}: custom playout ends the game`, () => {
        const state = newGame(game, options);
        const winner = game.playout(state, seededRng(1));
        const result = game.outcome(state);
        assert.ok(result, "playout left the game unfinished");
        assert.equal(winner, result.winner);
      });
    }

    test(`${label}: mcts returns a legal decision`, () => {
      // Advance past any opening chance plies to the first decision.
      const rng = seededRng(1);
      const state = newGame(game, options);
      while (!game.outcome(state) && game.toMove(state) === CHANCE) {
        assert.equal(mcts(game, state, { timeMs: 0, iterations: 5, rng }), null, "mcts chose for chance");
        game.applyMove(state, sampleChance(game, state, rng));
      }
      const move = mcts(game, state, { timeMs: 0, iterations: 20, rng });
      assert.ok(game.legalMoves(state).some((m) => moveKey(m) === moveKey(move)));
    });
  }
}
