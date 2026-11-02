# Architecture

The site is static files served by GitHub Pages with no build step. Code is
shared between games through native ES modules. Each game supplies its rules
and a board; everything else (rendering, input, dialogs, AI, history, tests)
comes from `common/`.

## Layout

```
index.html                  landing page: one card per game from the registry
games.js                    registry of games: { id, title, blurb, path, module }
common/
  base.css                  theme variables, buttons, dialogs, board layout, landing page
  engine.js                 helpers over the Game contract: move keys, replay, playouts
  rng.js                    seedable RNG for reproducible playouts and tests
  board/
    graph.js                makeBoard(): polygons -> adjacency, bounds, viewBox; components()
    cairo.js                Cairo pentagonal tiling patches
  render.js                 SVG renderer: cell, highlight, piece and marker layers
  shell.js                  mount(game): builds the page UI around a Game
  ai/
    mcts.js                 generic UCT Monte Carlo tree search over the Game contract
    worker.js               module Web Worker that runs mcts() off the main thread
    player.js               AIPlayer: talks to the worker, falls back to the main thread
games/
  <id>/
    index.html              page shell: title, rules text, mount(game)
    game.js                 pure rules module (no DOM)
test/
  conformance.test.js       contract checks run against every registered game
  <topic>.test.js           unit tests for shared modules and individual games
```

## Boards

Every board is a graph of polygonal cells, regardless of tiling. A board is
built from a list of cells by `makeBoard()` in `common/board/graph.js`:

```js
{
  cells: [{ id, x, y, poly: [[x, y], ...], coord, tags }],
  neighbours: [[id, ...], ...],  // derived from shared polygon edges by default
  unit,                          // shortest centre-to-centre neighbour distance
  bounds: { minX, minY, maxX, maxY },
  viewBox: "x y w h",
}
```

- `x, y` is the cell centre, where pieces are drawn.
- `coord` is optional tiling-specific data (e.g. `{ q, r }` on a hex grid).
- `tags` holds per-cell metadata a game or colour scheme may use (edge
  membership, colour classes, ...).
- Two cells are neighbours when their polygons share an edge; cells touching
  only at a corner are not. A generator may pass an explicit `neighbours`
  array instead (e.g. a square board with diagonal adjacency).

Tiling generators live in `common/board/`. Cairo exists today; square and hex
generators (with edge tags and direction stepping for line-based rules) are
planned next.

## The Game contract

A game is an ES module whose default export is a plain object:

```js
export default {
  id: "filament",
  title: "Filament",
  url: import.meta.url,             // lets the AI worker import this module
  players: {
    1: { name: "Black", fill: "#202329", mark: "#ffffff" },
    2: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
  },
  options: {                        // the shell builds the Options dialog from this
    size: { label: "Board size", choices: [48, 160], default: 48 },
  },
  colorSchemes: {                   // optional; first entry is the default
    sand: { name: "Sand", cellFill: (cell) => "#ffd890" },
  },

  createBoard(opts),                // -> Board
  initialState(board, opts),        // -> state; state.board is the shared Board
  clone(state),                     // deep enough that applyMove on the copy is safe
  toMove(state),                    // player number to move
  legalMoves(state),                // -> Move[]; empty iff the game is over
  applyMove(state, move),           // mutates state; returns info for display
  outcome(state),                   // null while ongoing, else { winner: 0 | player }

  // optional hooks
  piecesOf(state),                  // -> [{ id, player }]; default reads state.cells
  markers(state, move, info),       // -> [{ id, kind: "ring" | "dot" }] for the last move
  scoreSummary(state, player),      // -> { main, sub, title } for the turn panel
  outcomeLines(state, outcome),     // -> HTML lines shown under the game-over verdict
  playout(state, rng),              // faster rollout for MCTS; returns a winner
};
```

`applyMove` mutates in place and `clone` copies: search code clones once per
tree node and then mutates freely, which keeps playouts fast.

### Moves

A move is either an **array of cell ids** or a **string**:

| Kind            | Example          |
| --------------- | ---------------- |
| Placement       | `[17]`           |
| Movement        | `[17, 23]`       |
| Multi-step jump | `[17, 23, 31]`   |
| Special         | `"pass"`, `"swap"` |

The shell turns clicks into moves without game-specific code. It keeps the
cells clicked so far, filters `legalMoves()` by that prefix, highlights the
valid next cells and plays the move once the selection matches a complete
move. Legal string moves are shown as buttons. `moveKey()` in
`common/engine.js` gives each move a canonical string (`"17-23"`, `"pass"`)
for comparison and for the URL hash.

## The shell

`mount(game)` in `common/shell.js` builds the whole page around a game:

- controls (Games, Rules, Options, Undo, Reset), the board, turn panel and
  status line;
- the Rules dialog from the page's `<template id="rules">`;
- the Options dialog: player types (human/AI), AI think time, the game's own
  options and colour schemes, saved to `localStorage`;
- move input and highlighting as described above, plus last-move markers;
- the move history, which drives Undo and the URL hash
  (`#size=48&moves=17.23.4`), so any position can be shared as a link;
- responsive board sizing that keeps the board within the viewport.

Because rules are deterministic, a position is fully described by the
options plus the move list. The shell, the AI worker and the tests all rebuild
positions by replaying moves (`replay()` in `common/engine.js`) rather than by
serialising game state.

## AI

`common/ai/mcts.js` is a generic UCT search over the Game contract. It runs in
a module Web Worker (`common/ai/worker.js`) that imports the game from
`game.url`, replays the move list and searches for the requested time. If a
worker cannot be created the search runs on the main thread instead. A game
can speed up rollouts by providing `playout(state, rng)`.

## Testing

`npm test` runs `node --test`. Because games are plain modules, tests import
them directly. `test/conformance.test.js` runs every game in `games.js`
through contract checks (seeded random playouts terminate, `legalMoves` is
empty exactly when the game is over, `clone` is independent, MCTS returns a
legal move, adjacency is symmetric). Each game adds its own rule tests.

## Adding a game

1. Create `games/<id>/game.js` implementing the contract, building its board
   with a generator from `common/board/`.
2. Create `games/<id>/index.html` with the rules in `<template id="rules">`
   and a module script that calls `mount(game)` (copy Filament's).
3. Register it in `games.js`.
4. Add `test/<id>.test.js` with rule tests and run `npm test`.
