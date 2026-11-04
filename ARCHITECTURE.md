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
  engine.js                 helpers over the Game contract: move keys, replay, playouts, CHANCE
  rng.js                    seedable RNG for reproducible playouts and tests
  bag.js                    bags of coloured marbles: draws as chance plies, refills
  swap.js                   withSwap(game): the swap (pie) rule for any two-player game
  board/
    graph.js                makeBoard(): polygons -> adjacency, bounds, viewBox; groups,
                            liberties, directions (ray, lineLength)
    square.js               square grids: chess/draughts boards and Go-style points boards
    hex.js                  hex rhombus (Hex) and hex-hex boards
    cairo.js                Cairo pentagonal tiling patches
  render.js                 SVG renderer: cell, highlight, piece and marker layers
  chance-view.js            bag panels shown under the board
  pieces/cburnett/          chess piece images (Cburnett, BSD; see its README)
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

Tiling generators live in `common/board/`:

| Generator | Coord | Tags |
| --------- | ----- | ---- |
| `squareBoard({ cols, rows, adjacency, style, stars })` | `{ col, row }`, row 0 = rank 1 at the bottom | `name` ("a1"), `dark` (a1 dark), `quad` (Dabbaba sub-grid 0-3), `edges` ("N"/"S"/"E"/"W") |
| `rhombusBoard(n)`, `hexHexBoard(side)` | axial `{ q, r }`, pointy-top | `tri` (3-colouring), `edges` (rhombus "N"/"S"/"E"/"W"; hex-hex side 0-5), `name` (rhombus) |
| `cairoBoard(centres, { rotate })` | (none) | `tone` (pentagon orientation) |

`squareBoard` adjacency is `"orth"` (default), `"diag"` or `"king"`. With
`style: "points"` pieces sit on intersections as in Go: the renderer draws
`board.lines` and star points (`board.dots`) over a continuous surface, and
the cells stay as click targets.

Grid boards also carry directions for line-based rules: `board.dirs` (8 king
steps for squares, 6 for hexes, listed so that the opposite of `d` is
`opposite(board, d)`), `board.at(...coord)` and `board.step(id, d)` (both -1
off the board). `graph.js` builds on these with `ray()` and `lineLength()`,
and on adjacency alone with `components()`, `groupAt()` and `liberties()`.

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
    // optional marbles: { W: { name, fill } } recolours the bag panels
  },

  createBoard(opts),                // -> Board
  initialState(board, opts),        // -> state; state.board is the shared Board
  clone(state),                     // deep enough that applyMove on the copy is safe
  toMove(state),                    // player number to move, or CHANCE (0)
  legalMoves(state),                // -> Move[]; empty iff the game is over
  applyMove(state, move),           // mutates state; returns info for display
  outcome(state),                   // null while ongoing, else { winner: 0 | player }

  // chance (required if toMove can return CHANCE)
  chances(state),                   // -> [{ move, p }] at a chance ply
  currentPlayer(state),             // whose turn a chance ply belongs to, for display
  marbles,                          // { W: { name, fill } } colours used by chanceView
  chanceView(state),                // -> bag panels: [{ title, owner, counts, drawn, active }]

  // added by withSwap() (common/swap.js)
  swap,                             // true
  seat(state, player),              // seat (person) playing a colour; see "Swap"

  // optional hooks
  defaultPlayers,                   // e.g. { 1: "human", 2: "ai" } (the default)
  moveLabels,                       // button labels for string moves, e.g. { pass: "Pass" }
  moveLabel(state, move),           // the same, computed (takes precedence)
  turnHint(state, scheme),          // status line text while the game is on (scheme: the
                                    //   active colour scheme object, or null)
  boardDecor(board),                // -> lines over the cells, e.g. goal edges
  rotatable,                        // true: the shell may turn the board 90 degrees
  piecesOf(state),                  // -> [{ id, player, label?, image? }]; default reads state.cells;
                                    //   image: URL drawn instead of a disc (e.g. a chess piece)
  markers(state, move, info),       // -> [{ id, kind, color? }] for the last move. Over pieces:
                                    //   "ring" | "dot" | "target"; under pieces: "shade" (hatched
                                    //   cell), "square" (cell outline), "check" (red glow)
  scoreSummary(state, player),      // -> { main, sub, title } for the turn panel
  outcomeLines(state, outcome),     // -> HTML lines shown under the game-over verdict
  playout(state, rng),              // faster rollout for MCTS; returns a winner
};
```

An option may also declare `allowed(value, opts)` to rule out combinations
(e.g. a minimum too high for a small board): `resolveOptions()` replaces a
disallowed value with the nearest allowed choice before it, the Options
dialog disables it, and the conformance tests skip those combinations.

`applyMove` mutates in place and `clone` copies: search code clones once per
tree node and then mutates freely, which keeps playouts fast. A turn may span
several plies: `toMove` can return the same player (or `CHANCE`) more than
once in a row. Option values
in `choices` may be plain values or `{ value, label }` objects. Rules must be
deterministic: the same options and moves always give the same position.

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
move. Clicking the last selected cell again steps the selection back (or
commits it, if it is a complete move that is also a prefix of longer moves).
Legal string moves are shown as buttons. `moveKey()` in
`common/engine.js` gives each move a canonical string (`"17-23"`, `"pass"`)
for comparison and for the URL hash.

### Chance

Random events (drawing a marble, later rolling dice) are **chance plies**:
`toMove(state)` returns `CHANCE` (0, exported from `engine.js`),
`chances(state)` lists the outcomes as `[{ move, p }]`, and `legalMoves`
returns the same moves. Outcomes are string moves such as `"draw:W"`. They
are applied and recorded like any other move, so a game with chance is still
fully described by its options and move list, and replay, the URL hash, the
AI worker and the tests work unchanged. Drawing several marbles is several
chance plies, which lets a player decide between draws (push-your-luck).

`common/bag.js` implements bags as plain objects
(`{ counts: { W: 3, B: 3 }, drawn: [] }`): `drawOutcomes(bag)` gives a chance
ply's outcomes, `drawMarble(bag, move)` applies one, and helpers add, remove,
replace and return marbles. Bags are always public: `chanceView` shows their
contents and the drawn marbles in order.

### Swap

The swap (pie) rule is generic: `export default withSwap({ ... })` adds it
to a two-player game without touching its rules. Player numbers stay
colours (they own pieces, move and win). Swapping leaves the position as it
is and trades the two *seats* (the people, human or AI) between colours.
By default the string move `"swap"` is offered once, at player 2's first
decision in their own turn (`currentPlayer`, so not when player 2 acts
inside player 1's turn); `withSwap(game, { offer })` narrows that. The
state gains `swapped` and `swapClosed`. `seatOf(game, state, player)` in
`engine.js` maps a colour to its seat (the identity for games without swap):
the shell keeps human/AI settings per seat, and MCTS credits wins to seats,
so it values a swap for the person who makes it.

## The shell

`mount(game)` in `common/shell.js` builds the whole page around a game:

- controls (Games, Rules, Options, Undo, Reset), the board, turn panel and
  status line;
- the Rules dialog from the page's `<template id="rules">`;
- the Options dialog: player types (human/AI), AI think time, the game's own
  options and colour schemes, saved to `localStorage`;
- move input and highlighting as described above, plus last-move markers
  (by default a ring on the destination of the last cell move);
- chance plies: after a short pause the shell samples an outcome and plays
  it; `chanceView` panels appear under the board and `turnHint` in the
  status line;
- the move history, which drives Undo (back to the last human decision,
  keeping the draws before it, so Undo cannot re-roll chance) and the
  URL hash (`#size=48&moves=17.23.4`), so any position can be shared as a
  link; an illegal move in a hand-edited hash truncates the history there;
- responsive board sizing that keeps the board within the viewport, using
  the board's aspect ratio; a `rotatable` game's board is turned 90 degrees
  (display only) when that draws it clearly larger, e.g. a wide board on a
  portrait phone.

`mount()` returns a small handle (`state`, `moves`, `play`, `undo`, `reset`);
game pages expose it as `window.app` for the console.

Because rules are deterministic, a position is fully described by the
options plus the move list. The shell, the AI worker and the tests all rebuild
positions by replaying moves (`replay()` in `common/engine.js`) rather than by
serialising game state.

## AI

`common/ai/mcts.js` is a generic UCT search over the Game contract. At
chance plies it samples an outcome by probability instead of applying UCT,
so decision values are expectations over the randomness. The search is only
asked at decision plies, and it never sees a real draw before the shell makes
it. It runs in
a module Web Worker (`common/ai/worker.js`) that imports the game from
`game.url`, replays the move list and searches for the requested time. If a
worker cannot be created the search runs on the main thread instead. A game
can speed up rollouts by providing `playout(state, rng)`.

## Testing

`npm test` runs `node --test test/*.test.js`. Because games are plain
modules, tests import them directly. `test/conformance.test.js` runs every
game in `games.js`, for every combination of option values, through contract
checks: seeded random playouts terminate, `legalMoves` is empty exactly when
the game is over, moves are well formed and round-trip through `moveKey`,
`clone` is independent, replay reproduces the final position, MCTS returns a
legal move, and boards are well formed. At chance plies it also checks that
`chances()` matches `legalMoves()` with probabilities summing to 1, that
`chanceView` uses declared marble colours, and that MCTS never chooses for
chance; playouts sample chance by probability. Two fixtures in
`test/fixtures/` exercise the suite and the MCTS tests: tic-tac-toe, and bag
tic-tac-toe (a marble draw picks the square colour to play on). Each game adds its
own rule tests.

The page shell is not covered by `npm test`; check it in a browser with
`npm run serve`.

## Adding a game

1. Create `games/<id>/game.js` implementing the contract, building its board
   with a generator from `common/board/`.
2. Create `games/<id>/index.html` with the rules in `<template id="rules">`
   and a module script that calls `mount(game)` (copy Filament's).
3. Register it in `games.js`.
4. Add `test/<id>.test.js` with rule tests and run `npm test`.
