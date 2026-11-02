// Contract checks run against every registered game (and the tic-tac-toe
// fixture, which keeps the suite itself honest). A new game that passes these
// will work with the shell, the AI and URL replay.

import { test } from "node:test";
import assert from "node:assert/strict";
import { games } from "../games.js";
import { validateBoard } from "../common/board/graph.js";
import { newGame, replay, moveKey, parseMoveKey, piecesOf, resolveOptions } from "../common/engine.js";
import { mcts } from "../common/ai/mcts.js";
import { seededRng } from "../common/rng.js";
import tictactoe from "./fixtures/tictactoe.js";

const entries = [
  ...await Promise.all(games.map(async (g) => ({
    entry: g,
    game: (await import(new URL(`../${g.module}`, import.meta.url))).default,
  }))),
  { entry: { id: "tictactoe (fixture)" }, game: tictactoe },
];

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
      assert.ok(game.toMove(state) in game.players);
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
          assert.ok(game.toMove(state) in game.players);

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

          // clone() must be independent of the original.
          const copy = game.clone(state);
          const before = snapshot(copy);
          const move = legal[Math.floor(rng() * legal.length)];
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

    test(`${label}: mcts returns a legal move`, () => {
      const state = newGame(game, options);
      const move = mcts(game, state, { timeMs: 0, iterations: 20, rng: seededRng(1) });
      assert.ok(game.legalMoves(state).some((m) => moveKey(m) === moveKey(move)));
    });
  }
}
