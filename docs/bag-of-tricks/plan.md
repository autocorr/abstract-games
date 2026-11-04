# Bag of Tricks: implementation plan

This plan covers implementing the ten games in [rules.md](rules.md) in the
same way. All of them add chance to an otherwise perfect-information game,
mostly by drawing marbles from a bag. Dice games may come later, so the
mechanism is designed as general **chance**, not "bag".

## Principles

1. **Chance is a turn of its own.** A random event (a marble draw, a die
   roll) is a ply played by a pseudo-player, `CHANCE`. The ply is recorded in
   the move list like any other move. The contract's rule "same options and
   moves give the same position" still holds, and replay, Undo, the URL hash,
   the AI worker and the tests all keep working by replaying moves.
2. **Perfect information.** The booklet plays with a glass dish, so the
   contents of every bag, and the discards in draw order, are always shown.
   Hidden bags are out of scope.
3. **Turns are made of plies.** One player's turn may be several plies in a
   row: draw, place, draw, place, choose a marble to swap. `toMove` may
   return the same player (or `CHANCE`) several times in a row. Nothing in
   the contract requires players to alternate.
4. **Open rules become options.** Every "provisional default" in
   `rules.md` that is cheap to support becomes an entry in `game.options`,
   with the provisional choice as the default. Rules we expect to drop are
   left out rather than becoming options.
5. **Shared code over per-game code.** Bag logic, the bag display, square and
   hex boards, and Go-style group/liberty helpers live in `common/`. Each game
   only adds its rules.

## Contract changes

### Chance plies

```js
import { CHANCE } from "../../common/engine.js";   // CHANCE = 0

toMove(state)        // -> CHANCE when the next event is random
chances(state)       // only at chance plies: [{ move, p }], p > 0, sum = 1
legalMoves(state)    // at chance plies: exactly the moves listed by chances()
```

- Chance moves are strings, so they appear in `moveKey` and the hash as they
  are: `"draw:W"`, and later `"roll:3"`. They must not contain `.`, `&` or
  `=`.
- **One ply per item drawn.** A draw of several marbles is several chance
  plies. This keeps each distribution small, follows physical play, and lets
  decisions come between draws (Accrete's stop or continue). The same goes
  for multi-die rolls if a game needs to decide between dice. Otherwise one
  `"roll:3-5"` ply is fine.
- `outcome.winner === 0` still means a draw. `CHANCE` is never a winner, and
  `0` is never a key in `players`.

### New optional hooks

```js
chanceView(state)    // -> panels describing bags (or dice) for display, e.g.
                     //    [{ title: "Bag", owner: 1|2|null,
                     //       contents: [{ color: "W", fill: "#fff", count: 3 }],
                     //       drawn: ["B", "B", "G"] }]
moveLabel(state, m)  // function form of moveLabels, for buttons like
                     //    "swap:B>W" -> "Replace a drawn black with white"
```

### `common/engine.js`

- Export `CHANCE`, and `sampleChance(game, state, rng)`, which picks from
  `chances(state)` by probability.
- `randomPlayout`: at chance plies, sample by probability rather than
  uniformly.
- `replay`, `findLegalMove` and `moveKey` need no changes.

### `common/ai/mcts.js`: chance nodes

- When a node's `toMove` is `CHANCE`, descend by **sampling** an outcome
  rather than by UCT, creating its child if this is the first time that
  outcome has been seen. Leaving out UCB at chance nodes gives the standard
  "expectimax-flavoured" MCTS, and works well when branching factors are as
  small as these.
- Backprop is unchanged. A node's `mover` is `CHANCE` for chance children,
  which never matches a winner, and the win statistics of those nodes are
  never read.
- The search root is always a decision ply, because the shell resolves
  chance itself. If `mcts()` is given a chance ply, it returns `null`.
- The search never sees a future draw. The shell samples a draw only once it
  is reached, using its own RNG.

### `common/shell.js`

- **Chance plies are automatic.** When `toMove === CHANCE`, the shell waits a
  short delay (so the draw can be seen), calls `sampleChance` with
  `Math.random`, and plays the result. Chance moves are never shown as
  buttons. `isHumanTurn()` must be false at a chance ply; today
  `settings.players[0]` is undefined, so it is treated as human.
- **Undo** returns to the most recent *human decision* ply and **keeps the
  draw** that came before it, so Undo can't be used to re-draw. It must skip
  chance plies as well as AI plies.
- **Bag panel.** Render `chanceView(state)` next to the turn panel. It shows
  each bag's remaining contents with counts, the drawn marbles in order, and
  the latest draw highlighted.
- **Last-move markers.** The default markers look at the last move, which is
  now often a string such as a draw. Use the last *cell* move instead.
- **Status line.** Say what the current draw allows, e.g. "Drew black: move
  a checker on a dark square". The text comes from the game, through
  `scoreSummary` or a new `turnHint(state)` hook.

### Tests

- `test/conformance.test.js`, for games with chance plies:
  - the moves in `chances()` equal `legalMoves()`;
  - every `p > 0`, and they sum to 1 (within ε);
  - seeded playouts sample by probability;
  - `mcts` never returns a chance move.

  The existing checks (termination, replay, clone independence, moveKey
  round-trip) apply unchanged.
- A small **chance fixture** in `test/fixtures/`: a short dice or bag race
  with a known optimal policy, to show that MCTS with chance nodes beats
  random play.
- Every game's tests pin its bag mechanics: draw outcomes and probabilities
  from a given position, refill and cycle behaviour, and marbles added or
  removed after an event.

## Shared modules

| Module                      | Contents                                                                                                       | Used by |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | ------- |
| `common/bag.js`             | Pure multiset helpers on plain objects (cheap to clone): `makeBag(counts)`, `outcomes(bag)` → `[{ move, p }]`, `draw`, `put`, `remove`, `refill` (discards back to the bag), with an ordered discard list | all |
| `common/board/square.js`    | Rectangular grids: file/rank coords, orthogonal, diagonal or 8-way adjacency, direction stepping, edge tags, colour-class tags (`checker`, `dabbaba` quad); a `points` display style for Go-style boards | WC, AD, Rec, Liq, Biv, Man |
| `common/board/hex.js`       | Hex rhombus and hex-hex: axial coords, edge tags, 3-colouring tag, direction stepping                          | Disp, Acc, PI |
| `common/groups.js`          | Connected components by predicate, liberties, capture resolution, area scoring                                 | Disp, Acc, PI, Rec, Man |
| `common/chance-view.js`     | DOM/SVG rendering of `chanceView()` panels (marbles as coloured circles, counts, draw history)                 | all |
| `common/board/mancala.js`   | Pit rows with a sowing order, count labels                                                                     | Cyc |
| renderer additions          | stack-height labels (already possible through `piecesOf().label`), chess glyphs, intersection grid style        | AD, Liq, Biv, Man |

`common/board/graph.js` already supports explicit `neighbours`, which square
boards with diagonal adjacency need. `ARCHITECTURE.md` already plans square
and hex generators. Here they get colour-class tags as well.

## Per-game design

The **move encoding** column shows plies in order. `[a,b]` is a cell move and
`"…"` is a string move.

| Game | Board | Bag(s) | Ply sequence for one turn | Extra UI | Options (from open questions) |
| ---- | ----- | ------ | ------------------------- | -------- | ----------------------------- |
| Wavefunction Collapse | 8×8, `checker` tags | 1 shared, 3W 3B 1G, refilled after 7 | `draw:X` → `[from,to]` (→ `swap:…` choice in variant) | discard row in draw order | gray-after-refill rule; stuck = lose / pass; variant on/off; who swaps |
| Disperse | hex rhombus n×n, 3-colour tags, edge tags | 1 shared, one marble per cell, never refilled | `draw:X` → `[cell]` | per-colour counts (large bag) | size 9 / 11 / 12; swap rule; alternate rules (2-draw) |
| Accrete | hex-hex | 1 shared, 3W 3B | `draw:X`… → `"stop"` / `"draw"` choices → `[cell]`×n | push-your-luck buttons; "n stones left" hint | bag 3W 3B / 4W 2B; board side |
| Parity Inversion | hex-hex | 1 shared, 2W 2B, grows and shrinks | `draw:X` → `[cell]` | bag count changes shown | feedback direction; scoring rule; built only after rules are fixed |
| Alpha Decay | 8×8 | 1 shared, TBD | `draw:X`… (automatic run) → `[from,to]` or a split move | stack-height labels | blocked until setup, movement and bag are defined |
| Recombination | 8×8, 8-way | 1 per player, 3R 2G 1B 1K | `draw:X` → `[from,to]` or `[edgeCell]` | per-player bags; unused-edge markers | black lifetime; setup; no-move = pass |
| Cyclotron | 3×7 or 4×7 pits | 1 per player, 10 black (+ white per opponent capture) | (`draw:X` → `[pit]`)… | pit counts, stores | blocked until stone count and capture rule are fixed |
| Liquefaction | 6×6 / 8×8, `dabbaba` tags | 1 shared, 5 of 4 colours, constant size | `draw:X` → `[from,to]` (promotion as `[from,to,choice]` or a follow-up string ply) | chess glyphs; colour-checked squares highlighted | 6×6 / 8×8; fixed or random initial bag; colour theme (classic / cyan-magenta / colour-blind) |
| Bivalent | 7×7 points | 1 shared, 5G 5R | `draw:X` → `[point]` | score panel; red reserve | board 7 / 9; variant on/off |
| Manifold | 9×9 points | 1 per player | `draw:X` `draw:Y` → `[pt]` / `[pt]` / `"pass"` / `"resign-pass"` (→ swap choice after capture) | 4-colour stones; two bags; komi | bag contents; capture-swap rule; komi |

Notes:

- **Multi-placement turns** (Accrete, Manifold, Disperse alternate) are a
  series of single-cell plies by the same player. A `"done"` string move ends
  the turn early where "up to n" applies. This keeps move generation small,
  and the click-to-move shell works unchanged.
- **Post-event choices** (Wavefunction variant swap, Manifold capture swap)
  are string plies offered as buttons, owned by whichever player the rule
  names.
- **Push-your-luck AI.** MCTS handles `"stop"` and `"draw"` naturally,
  because they are ordinary decision plies followed by chance plies.
- **Chess AI.** Random playouts are poor for chess-like games. Liquefaction
  will probably need a `playout` with a material-based cutoff, or a short
  playout followed by a material evaluation. It is the largest piece of work
  and should come late.
- **Large chance branching** (Disperse: up to 3 colour outcomes, then many
  cells). This is fine: chance outcomes are per *colour*, not per marble.

## Phases

Each phase ends with `npm test` passing and a browser check
(`npm run serve`, then the screenshot script).

### Phase 0: chance infrastructure (done)

All of the steps below are done, as described in `ARCHITECTURE.md`, with these
differences from the design above:

- Group, liberty and line helpers went into `common/board/graph.js` instead
  of a separate `groups.js`. Area scoring and Go capture wait for Manifold.
- New hooks:
  - `currentPlayer(state)` names whose turn a chance ply belongs to, for the
    turn panel;
  - `marbles` declares the marble names and colours that `chanceView` uses.
- `hex.js` was built now, as well as `square.js`.
- `test/fixtures/bag-tictactoe.js` is the chance fixture. It is in the
  conformance suite and drives the MCTS chance tests.
- Still to do, when the first game needs them: stack and chess-glyph
  rendering, and the mancala board.

The original steps:

1. Add `CHANCE`, `sampleChance` and chance-aware `randomPlayout` to
   `engine.js`.
2. Add `common/bag.js` with unit tests.
3. Add chance nodes to MCTS, and the chance fixture plus tests.
4. Add chance plies to the conformance suite.
5. Shell changes: automatic draws, Undo that keeps draws, the bag panel
   (`chance-view.js`), last-cell-move markers, and no buttons for chance
   moves.
6. Add `common/board/square.js`, with colour-class tags and the `points`
   style.
7. Update `ARCHITECTURE.md`: chance plies, the new hooks, the new modules.

### Phase 1: Wavefunction Collapse (the reference game)

This is the most complete ruleset, on the simplest board, and it uses every
part of Phase 0. Build the base game first, then the bag-alteration variant
as an option. Later games copy its structure.

### Phase 2: games with complete or nearly complete rules

Each game adds one new shared piece.

1. **Disperse.** Adds `hex.js` (rhombus, 3-colouring, edge tags) and
   `groups.js` connectivity.
2. **Bivalent.** Adds the points board, line scanning, and neutral stones
   with marbles returning to the bag.
3. **Accrete.** Adds hex-hex, push-your-luck plies, and multi-placement
   turns.
4. **Manifold.** Adds Go capture and liberties, two bags, permanent pass,
   and area scoring.

### Phase 3: Liquefaction (done)

Done in `games/liquefaction/`, with Cburnett piece images in
`common/pieces/cburnett/`. Shared additions: image pieces and the "shade",
"square" and "check" markers in `render.js`, and colour schemes that recolour
marbles (`scheme.marbles`) and reach `turnHint(state, scheme)`. The AI
playout plays capture-biased random moves for 40 moves, then adjudicates on
material, which ends the scratch game in the playout (`reason:
"adjudicated"`). A stronger evaluation is still possible later.

The original plan: chess move generation (no Queens; promotion to N, B or R; castling and
double steps only on 8×8), colour-check, the constant-size bag, and stalemate
as a loss. Do 6×6 first, then 8×8, then a stronger playout for the AI.

The open questions are settled under *Decisions* in `rules.md`. Two points
for the code:

- Name the square classes and marbles by letter (A–D), not by colour. The
  theme option maps letters to fills and display names.
- This is the first game that can go on forever. The 50-move rule is
  required, because `randomPlayout` throws after 100,000 plies.

### Phase 4: drafts and sketches (rules first)

These need design decisions before any code: **Recombination**, **Alpha
Decay**, **Parity Inversion** and **Cyclotron**. Settle each game's open
questions in `rules.md`, ideally playtesting with the earlier games' tools,
then implement it the same way. Recombination is closest to ready.

### Later: dice

Dice games use the same `CHANCE` plies (`"roll:4"`, or `"roll:3-5"` for a
pair whose order doesn't matter, with probability 2/36). A `common/dice.js`
can sit next to `bag.js`, and `chanceView` would get a dice panel.

## Per-game checklist

- [ ] `games/<id>/game.js`: rules, `chances`, `chanceView`, options for open
      questions.
- [ ] `games/<id>/index.html`: rules in `<template id="rules">`, adapted from
      `rules.md` (credit the booklet, CC BY-SA 4.0, and the inspiring game).
- [ ] Register the game in `games.js`.
- [ ] `test/<id>.test.js`: movement, capture or scoring, and bag mechanics
      including refill and feedback.
- [ ] Conformance passes for every option combination. Keep option counts
      small; the suite enumerates all of them.
- [ ] Browser check: draws animate, the bag panel is correct, Undo keeps the
      draw, and the AI plays a legal game.
- [ ] Update `rules.md`: mark which provisional defaults were used.
