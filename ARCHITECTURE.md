# Architecture

The site is static files served by GitHub Pages with no build step. Code is
shared between games through native ES modules. Each game supplies its rules
and a board; everything else (layout, rendering, input, AI, history, the move
log, tests) comes from `common/`.

## Layout

```
index.html                  landing page: one card per game from the registry
games.js                    registry of games: { id, title, blurb, path, module }
common/
  base.css                  tokens (light/dark colours, radii, spacing), controls, game page
                            layout, landing page
  fonts/                    Inter variable font (SIL OFL), subset by .tools/scripts/subset_inter.py
  theme.js                  the site-wide Theme setting (auto / light / dark)
  theme-init.js             classic script in each page head: applies the saved theme before paint
  engine.js                 helpers over the Game contract: move keys, option choices, replay,
                            playouts, cachedBoards(), CHANCE
  log.js                    move-log text: describeMove(), moveLabel(), turns of plies
  timeline.js               the move line with a cursor: review, branching, Undo
  rng.js                    seedable RNG for reproducible playouts and tests
  bag.js                    bags of coloured marbles: draws as chance plies, refills, bagPanel()
  dice.js                   dice: rolls as chance plies, dicePanel()
  swap.js                   withSwap(game): the swap (pie) rule for any two-player game
  largest-groups.js         group sizes and the "largest groups cascading" win condition, with
                            piecesOf / scoreSummary / outcomeLines hooks (Nucleation, Coagulate)
  board/
    graph.js                makeBoard(): polygons -> adjacency, bounds, viewBox; geometry
                            helpers; groups, liberties, side-to-side connection,
                            directions (ray, lineLength)
    square.js               square grids: chess/draughts boards and Go-style points boards
    hex.js                  hex rhombus (Hex), hex-hex and triangle (Y) boards
    cairo.js                Cairo pentagonal tiling patches
  chess/                    chess-like games, generic over piece movement (see "Chess variants")
    movement.js             movement atoms (leap, ride, cannon), standard pieces, compiled tables
    rules.js                rules specs: move generation, attacks and check, castling, en passant,
                            promotion, notation
    game.js                 chessGame(variant): a whole Game from a rules spec and hooks
  render.js                 SVG renderer: cell, highlight, piece and marker layers
  chance-view.js            bag and dice panels shown in the turn card
  pieces/cburnett/          chess piece images (Cburnett, BSD; see its README)
  shell.js                  mount(game): builds the page UI around a Game
  ui/
    dom.js                  h(), svgEl(), collapsible sections with remembered open state
    settings.js             saved Setup settings (localStorage) and the URL hash
    setup.js                the Setup section (players, AI time, options, colours); segmented
                            buttons for short choice lists, dropdowns for long ones
    move-list.js            the Log section (turns, navigation, Copy link); not named
                            log-view.js, which EasyPrivacy blocks (see "Blocked file names")
  ai/
    mcts.js                 generic UCT Monte Carlo tree search over the Game contract
    worker.js               module Web Worker that runs searchMove() off the main thread
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
| `squareBoard({ cols, rows, adjacency, style, stars, grid })` | `{ col, row }`, row 0 = rank 1 at the bottom | `name` ("a1"), `dark` (a1 dark), `quad` (Dabbaba sub-grid 0-3), `edges` ("N"/"S"/"E"/"W") |
| `rhombusBoard(n)`, `hexHexBoard(side)`, `triangleBoard(n)` | axial `{ q, r }`, pointy-top; a triangle adds `d`, the distances to its sides | `tri` (3-colouring), `edges` (rhombus "N"/"S"/"E"/"W"; hex-hex side 0-5; triangle "W"/"E"/"S"), `name` ("a1": column from q, row from r, top row 1) |
| `cairoBoard(centres, { rotate })` | (none) | `tone` (pentagon orientation), `name` ("1".."n" in reading order) |

Cell names (`tags.name`) are what the move log shows, so every generator
gives one; the conformance tests check that they are unique.

`squareBoard` adjacency is `"orth"` (default), `"diag"` or `"king"`. With
`grid: false` the squares are drawn without outlines between them and the
board gets one border around its edge, as on a chessboard (Liquefaction). With
`style: "points"` pieces sit on intersections as in Go: the renderer draws
`board.lines` and star points (`board.dots`) over a continuous surface, and
the cells stay as click targets. `starPoints(n)` gives the usual Go layout
for `stars`.

Grid boards also carry directions for line-based rules: `board.dirs` (8 king
steps for squares, 6 for hexes, listed so that the opposite of `d` is
`opposite(board, d)`), `board.at(...coord)` and `board.step(id, d)` (both -1
off the board). `graph.js` builds on these with `ray()` and `lineLength()`,
and on adjacency alone with `components()`, `groupAt()` and `liberties()`.
For connection games, `goalMasks(board, players)` marks each player's
`sides` (edge tags) and `connectsSides(board, cells, id, mask, sides = 2)`
tells whether a group touches all of them (two opposite sides in Hex, three
in Y).

Boards depend only on the options and are never mutated, so a game can
build each one once with `createBoard: cachedBoards(keyOf, build)` from
`engine.js`, keyed on the options that shape the board.

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
  options: {                        // the shell builds the Setup section from this
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
  chanceView(state),                // -> panels: bags [{ title, owner, counts, drawn, active }]
                                    //   or dice [{ title, owner, dice: [4 | null], active, result? }]

  // the swap rule: withSwap() (common/swap.js) needs swapColours and adds the rest
  swapColours(state),               // exchange the position's colours (and reflect the board)
  swap,                             // true
  swapOffered(state),               // whether "swap" is legal now; see "Swap"

  // optional hooks (currentPlayer may also return null for plies that
  // belong to no player, e.g. filling a bag before the game starts)
  defaultPlayers,                   // e.g. { 1: "human", 2: "ai" } (the default)
  moveLabels,                       // button labels for string moves, e.g. { pass: "Pass" }
  moveLabel(state, move),           // the same, computed (takes precedence)
  moveText(before, move, info, scheme), // log text for a ply (see "The move log"); null for the default
  turnHint(state, scheme),          // status line text while the game is on (scheme: the
                                    //   active colour scheme object, or null)
  boardDecor(board),                // -> lines over the cells, e.g. goal edges (outside: true
                                    //   draws an edge line outside the cells instead;
                                    //   optional: true only with optionalDecor shown)
  optionalDecor,                    // e.g. "Corner marks": Setup offers Show / Hide (saved,
                                    //   no new game; Hide by default) for optional decor
  pieceStyles,                      // e.g. { bars: { name: "Bars" }, discs: { name: "Discs" } }:
                                    //   Setup offers them as "Pieces" (saved, no new game; the
                                    //   first is the default) and piecesOf gets the key
  pieceLabels,                      // e.g. "Group sizes": the pieces carry labels, and Setup
                                    //   offers Show / Hide for them (saved, no new game)
  pieceLabelsDefault,               // "off": the labels start hidden (default "on")
  rotatable,                        // true: the shell may turn the board 90 degrees;
                                    //   a number: by that angle (clockwise, degrees)
  piecesOf(state, style),           // -> [{ id, player, label?, image? }]; default reads state.cells;
                                    //   label: short text on the disc (e.g. a group size), or
                                    //   small in the corner of an image;
                                    //   image: URL drawn instead of a disc (e.g. a chess piece);
                                    //   a neutral piece has player null and its own fill (and mark)
                                    //   rotate: degrees to turn an image (180: upside down);
                                    //   size: disc diameter as a fraction of a cell (default 0.84);
                                    //   shadow: false draws a disc without its drop shadow;
                                    //   bar: { width, height, x?, y?, labelSize?, labelX?, labelY? }
                                    //   draws a level rounded rectangle instead, centred (x, y)
                                    //   from the cell's centre (cell units, y down), with the
                                    //   label on it or at (labelX, labelY); stroke: its outline
                                    //   width; tile: true shades the whole cell in the piece's
                                    //   colour (e.g. a neutral piece with a fill)
  markers(state, move, info),       // -> [{ id, kind, color?, y? }] for the last move. Over pieces:
                                    //   "ring" | "dot" | "target" (y: cells below the centre,
                                    //   level on screen); under pieces: "shade" (hatched
                                    //   cell), "square" (cell outline), "check" (red glow)
  scoreSummary(state, player),      // -> { main, sub, title } for the turn panel
  outcomeLines(state, outcome),     // -> HTML lines shown under the game-over verdict
  playout(state, rng),              // faster rollout for MCTS; returns a winner
};
```

An option may also declare `allowed(value, opts)` to rule out combinations
(e.g. a minimum too high for a small board): `resolveOptions()` replaces a
disallowed value with the nearest allowed choice before it, the Setup
section disables it, and the conformance tests skip those combinations.
An option that means nothing alongside the others (e.g. a choice of pieces
when the pieces are drawn at random) declares `inactive(opts)`: Setup greys
the whole row out and keeps its value, the game ignores it, and the
conformance tests try only its default.

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

Random events (drawing a marble, rolling a die) are **chance plies**:
`toMove(state)` returns `CHANCE` (0, exported from `engine.js`),
`chances(state)` lists the outcomes as `[{ move, p }]`, and `legalMoves`
returns the same moves. Outcomes are string moves such as `"draw:W"` or `"roll:4"`. They
are applied and recorded like any other move, so a game with chance is still
fully described by its options and move list, and replay, the URL hash, the
AI worker and the tests work unchanged. Drawing several marbles is several
chance plies, which lets a player decide between draws (push-your-luck).

`common/bag.js` implements bags as plain objects
(`{ counts: { W: 3, B: 3 }, drawn: [] }`): `drawOutcomes(bag)` gives a chance
ply's outcomes, `drawMarble(bag, move)` applies one, and helpers add, remove,
replace and return marbles. Bags are always public: `chanceView` shows their
contents and the drawn marbles in order.

`common/dice.js` does the same for dice: `rollOutcomes(sides)` gives a
roll's outcomes (`"roll:1"` .. `"roll:6"`), `rolledValue(move)` reads one
back, and `dicePanel(values, { owner, active })` shows the faces (null for
a die not rolled yet), optionally followed by `result` text such as what
the roll comes to. Each die is its own ply. Nucleation rolls one die a
turn.

### Swap

The swap (pie) rule is generic: `export default withSwap({ ... })` adds it
to a two-player game, which supplies `swapColours(state)`. Swapping takes
over the opponent's opening without anyone changing colour, as in Hex: the
colours of the whole position are exchanged (stones, the player to move,
and anything owned by a colour, such as claims or marble colours), and the
board is reflected where the players' goals differ (Determinant mirrors it
across the diagonal, so N-S edges become W-E). After White swaps on move 2,
the opening stone is White's and Black moves next. This is the same game as
the players trading sides, but each player keeps their colour, and so do
their human/AI settings and the AI's sense of who wins.

By default the string move `"swap"` is offered once, at player 2's first
decision in their own turn (`currentPlayer`, so not when player 2 acts
inside player 1's turn); `withSwap(game, { offer })` narrows that.
Nucleation offers it at a decision ply before White's first roll, so it is
made without knowing the die; its `swapColours` moves on to the roll. The
state gains `swapClosed`.

## The shell

`mount(game)` in `common/shell.js` builds the whole page around a game.

### Layout

```
.page
  .board-col > .board-wrap > svg.board
  aside.gutter
    header.page-head      title, the registry blurb, link back to the games
    .card.turn-card       players (score, AI tag, thinking dots), status,
                          bags, move buttons, Undo, New game; while
                          reviewing, a strip with "Back to latest"
    details Log           (open by default)
    details Setup         human or AI per player, AI think time, the game's options
                          and colour schemes, Theme (open on wide screens)
    details Rules         the page's <template id="rules">, after the blurb
```

On landscape screens and wide windows (`WIDE_QUERY` in shell.js, mirrored
in base.css) the board takes the left column and the gutter is a sticky
right-hand column that scrolls on its own. Otherwise the gutter's children
flow under the board, and the head becomes a slim bar above it. Which
sections are open is saved site-wide. Settings are saved per game in
`localStorage` (`common/ui/settings.js`); option changes start a new game
at once, and a link's options become the saved ones. Display settings
(colour scheme, piece style, Show / Hide for a game's `pieceLabels` and
`optionalDecor`) only redraw, and stay out of the URL.

A board whose cells fill a rectangle (square grids) sits on a framing panel;
other shapes (hexagons, diamonds, Cairo patches) are drawn straight on the
page.

The board is sized to its column and capped by the viewport height (on one
column it leaves room below for the top of the turn card). A `rotatable`
game's board is turned (display only; 90 degrees, or the game's angle) when
that draws it clearly larger, e.g. a wide board on a portrait phone.
Depletion turns its diamond by -60 degrees so that Black's edges stand
vertical.

### Play

- Move input and highlighting as described above, plus last-move markers
  (by default a ring on the destination of the last cell move).
- Chance plies: after a short pause the shell samples an outcome and plays
  it; `chanceView` panels appear in the turn card and `turnHint` in the
  status line.

### The move line, review and the URL hash

The shell keeps the game as a *line* of moves with a cursor
(`common/timeline.js`); the board shows the position after the plies
before the cursor. At the end of the line the game is live. Before it:

- the AI and chance wait; only a human to move can play;
- playing the line's next move just moves the cursor on, and any other move
  replaces the plies after the cursor (a branch), after which the game is
  live again;
- Undo moves the cursor back to the last human decision and keeps the later
  plies, so stepping forward redoes them. Draws before that decision are
  kept, so Undo cannot re-roll chance. With no earlier human decision (a
  human moving second, at their first move) Undo does nothing.

The Log section, the arrow keys and Home/End move the cursor. The URL hash
holds the options and the whole line, plus the cursor while reviewing
(`#size=48&moves=17.23.4&at=2`), so any position can be shared as a link; an
illegal move in a hand-edited hash truncates the line there. Copy link
copies it.

### The move log

`common/log.js` describes each ply. `game.moveText(before, move, info,
scheme)` is asked first (`before` is the position before the move, `info`
what `applyMove` returned, `scheme` the active colour scheme or null);
returning null falls back to the defaults: cell moves join cell names with
"–", `"draw:X"` reads "drew red" (marble names from the scheme's or the
game's marbles), `"roll:4"` reads "rolled 4", and other string moves use their button label. Plies are
grouped into turns by `currentPlayer`, so a draw is listed with the move
after it; plies of no player get an unnumbered line.

### Theme

`base.css` has dark and light palettes in the same variables, chosen by
`prefers-color-scheme`. The Theme setting (Auto / Light / Dark, saved
site-wide by `theme.js`) overrides it with `data-theme` on `<html>`, and
`theme-init.js` applies a saved choice before first paint. The landing page
has the same control. Board colours belong to the games and do not change
with the theme, though the dark theme dims boards slightly. Text is set in
Inter, self-hosted and preloaded by each page.

`mount()` returns a small handle (`state`, `moves` (the whole line),
`cursor`, `play`, `jump`, `live`, `undo`, `reset`); game pages expose it as
`window.app` for the console.

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
`game.url`, replays the move list and searches for the requested time
(`searchMove()` in `mcts.js`). If a worker cannot be created the same
search runs on the main thread instead. A game
can speed up rollouts by providing `playout(state, rng)`.

## Chess variants

`common/chess/` plays chess-like games without assuming standard chess.
Pieces are data: a type lists its movement as atoms from `movement.js`
(`leap(1, 2)` a Knight, `ride(1, 0)` a Rook, `ride(1, 2)` a Nightrider,
`cannon(1, 0)` a Janggi Cannon; `mode` "m" or "c" for move- or capture-only,
`relative` vectors for pawns, `initial` for a double step), plus flags:
`royal` (the piece check is about), `becomes` (the type it turns into after
moving, for two-faced pieces), `castler`, `pawn`, `promote`. A variant's
rules spec adds castling (by square names, mirrored for Black; castling may
be entered as the royal's move to its square or onto its own Rook), whether
check applies, and whether stalemate draws or loses. `attachRules(board,
spec)` compiles it onto the board as `board.chess`: rays from every square
along every vector used, and an attack index that walks out from the
attacked square, so attack tests do not depend on which pieces exist.

`chessGame(variant)` (`game.js`) builds a whole Game on that: positions
(`cells` of piece codes, `royal` squares, castling rights, en passant,
fifty-move clock), turns of a move plus a promotion choice, algebraic
notation with check marks, last-move and check markers, Cburnett images,
material scores and a capture-biased playout. Hooks let a variant add state,
chance plies before the game (`setupPly`) or before each move (`drawPly`),
rule out moves (`allow`), act after a turn (`afterMove`) and decide what
having no move means (`noMoves`); the returned object can be spread and its
methods overridden. Liquefaction is built this way (a marble draw before
each move, a colour-check in `allow`), as is Shaolin King (two-faced
royals that turn over as they move, dealt at random by `setupPly`).

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
chance; playouts sample chance by probability. Every ply must get log text
under every colour scheme. Two fixtures in
`test/fixtures/` exercise the suite and the MCTS tests: tic-tac-toe, and bag
tic-tac-toe (a marble draw picks the square colour to play on). Each game adds its
own rule tests.

The page shell is not covered by `npm test`; check it in a browser with
`npm run serve`.

## Blocked file names

Content blockers (uBlock Origin, AdGuard, Brave) block scripts whose URLs
match tracker patterns, e.g. EasyPrivacy's `/log-view.js`. A blocked module
breaks every module that imports it, leaving the page blank. Check new file
names with:

```
uv run --project .tools python .tools/scripts/check_blocklists.py
```

It downloads uBlock Origin's default lists and reports any site file they
block.

## Adding a game

1. Create `games/<id>/game.js` implementing the contract, building its board
   with a generator from `common/board/`.
2. Create `games/<id>/index.html` with the rules in `<template id="rules">`
   and a module script that calls `mount(game)`. Copy Filament's: its head
   also loads `theme-init.js`. The title and blurb come from the registry.
3. Register it in `games.js`.
4. Optionally add `moveText` if the default log text (cell names) does not
   read well for the game's moves.
5. Add `test/<id>.test.js` with rule tests and run `npm test`.
