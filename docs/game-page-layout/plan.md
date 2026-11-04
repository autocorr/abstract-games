# Game page layout: board + gutter redesign

> **Status: implemented** on `ui/board-gutter-layout`. Departures from the
> plan below:
> - Two columns apply on landscape screens at least 560px wide and on any
>   window at least 1000px wide, not at 700px. This keeps portrait tablets
>   in one column with a full-width board.
> - The renderer needed no theme variables: board colours belong to the
>   games, and their decor reads well on both panels.
> - Points boards (Determinant) now draw one surface under the cells. That
>   hides the anti-aliasing seams between cells that showed as stripes.
> - Plies that belong to no player (Liquefaction's random-bag setup) get an
>   unnumbered line in the log.

This plan reworks the shared game page (`common/shell.js`, `common/base.css`)
to follow the layout of `references/hex_grow.html`. The board comes first.
Everything else sits in stacked sections: below the board on a phone, in a
right-hand gutter on a wider screen. The dialogs and the board overlay go
away. A move log with position review is added for every game. The page
follows the system light/dark preference.

Game modules need no changes to keep working. Each part below is either
shared code or an optional new hook.

## Decisions

| Question | Decision |
| -------- | -------- |
| Theme | Follow the system (`prefers-color-scheme`), with an Auto / Light / Dark override in Setup |
| Game options (board size, ...) | Apply immediately, as today (a change restarts the game) |
| Log | Review and branch: click any ply, or use ◀ ▶, to view that position; playing a move there branches |
| Title and blurb | In the gutter on wide screens; a slim bar above the board on phones |

## Problems with the current page

- Rules and Options are hidden in modal dialogs behind a row of buttons, so
  the setup and the rules are one or two clicks away and out of sight while
  playing.
- The turn panel and title are overlaid on the board, which needs special
  cases: they are moved above the board on narrow screens and pinned to a
  sidebar on landscape phones (`--aside-top`, measured in `fitBoard`).
- Nothing records what happened. On an AI move, a chance draw, or a cascade
  (Filament fills, Determinant recolours), the only evidence is the
  position.
- Each new feature (more options, analysis, display toggles) would mean
  another button or dialog.

## Layout

One grid with three areas: `head`, `board`, `side`. Media queries only move
the areas around. The DOM order stays the same.

**Narrow** (portrait phone, width < 700px): one column.

```
┌──────────────────────────┐
│ ← Games      LIQUEFACTION│  head: one slim line, no blurb
├──────────────────────────┤
│                          │
│          board           │  full width, height capped so the
│                          │  turn card's first line stays on screen
├──────────────────────────┤
│ ● White  3   ○ Black  2  │  Turn card (always open)
│ White drew orange: ...   │
│ [Bag ● 1 ● 1 ● 1 ● 1 |●] │
│ [Promote…] [Undo] [New]  │
├──────────────────────────┤
│ ▾ Log                    │  collapsible sections
│ ▸ Setup                  │
│ ▸ Rules                  │
└──────────────────────────┘
```

**Wide** (width ≥ 700px, or any landscape screen, so landscape phones
included): board on the left, gutter on the right.

```
┌──────────────────────────────────┬────────────────────┐
│                                  │ ← Games            │
│                                  │ LIQUEFACTION       │
│                                  │ Chess without ...  │  head: title + blurb
│                                  ├────────────────────┤
│              board               │ Turn card          │
│      (as large as the column     ├────────────────────┤
│       and viewport height allow) │ ▾ Log              │
│                                  │ ▸ Setup            │  gutter: sticky,
│                                  │ ▸ Rules            │  scrolls on its own
└──────────────────────────────────┴────────────────────┘
```

- Gutter width `clamp(260px, 30vw, 360px)`. The board column takes the rest.
- On wide screens the gutter is `position: sticky; max-height: 100dvh;
  overflow: auto`, so a long log or the rules never push the board off
  screen.
- This replaces both existing media queries (narrow header reflow and
  landscape-phone sidebar) and the `--aside-top` measurement.

### Sections

Each section below the head is a card. Every card except the Turn card is a
`<details>`. Which cards are open is saved in `localStorage` for the whole
site (not per game), so a player who closes Rules once keeps it closed.

1. **Turn card** (never collapsed). It takes over from the board overlay,
   the status line, the chance area and the move buttons.
   - One row per player: stone, name, "(AI)" when the seat is an AI, and
     `scoreSummary` main/sub. The player to move is highlighted, and the
     thinking dots sit on that row (not on the board).
   - Status: `turnHint`, or the verdict plus `outcomeLines` when the game is
     over, or the error text.
   - Chance panels (`renderChance`), unchanged.
   - Move buttons (string moves), then **Undo** and **New game** (the
     current Reset).
   - While reviewing, a strip: "Viewing move 12 of 30 · [Back to live]".
2. **Log** (open by default). See below.
3. **Setup** (open by default on wide screens, closed on narrow). It
   replaces the Options dialog with the same rows: players per seat, AI
   think time, the game's own options (applied immediately), Colors, and
   new: Theme (Auto / Light / Dark).
4. **Rules** (closed by default). The page's `<template id="rules">`, as
   now.

The Games link, Rules and Options buttons, and both `<dialog>`s are removed.

### Board sizing

`fitBoard` gets simpler. Available width is the board column's content
width. Available height is the viewport height minus the board's top offset
and bottom padding. On narrow screens it also subtracts a fixed allowance
(about 120px) so the first line of the Turn card stays visible. The
`rotatable` logic stays as it is and runs against the new limits.

## Log, review and branching

### Model: moves plus a cursor

The shell keeps `moves` (the full line) and `cursor` (0..moves.length). The
board shows the position after `moves[0..cursor]`.

- **Live** means `cursor === moves.length`. Play works as it does today.
- **Reviewing** means `cursor < moves.length`. The plies after the cursor
  are the *tail*, shown greyed in the log.
  - The AI and the chance timer are paused. Nothing advances on its own.
  - If a human is to move at the cursor, the board accepts input. Playing
    the move that is already next in the tail just advances the cursor.
    Playing any other move drops the tail and appends the new move. That is
    the branch, and the shell is live again afterwards, so the AI and
    chance resume.
  - At a chance or AI ply the board is locked, and only ◀ ▶ move.
- **Undo** becomes "move the cursor back to the previous human decision"
  and keeps the tail. **▶** therefore works as Redo until a different move
  is played. The current guarantee holds: draws before a decision are
  never re-rolled, because replaying the same decision follows the tail and
  a different decision is a different line.
- **New game** and option changes clear both moves and tail, as Reset does
  now.

The logic goes in a pure module, `common/timeline.js`:
`{ moves, cursor }` with `jump(n)`, `play(move)` (advance or branch),
`undoTarget(isHumanAt)` and `isLive`. Node can test it, because the shell
itself has no tests.

### URL hash

`#size=6&moves=...` carries the full line. While reviewing it gets
`&at=12`. A reload or shared link opens at that position with the tail
intact. Without `at` the page opens live, as now.

### Log text

A pure module, `common/log.js`:

- `describeMove(game, before, move, info, { board, marbles })` returns a
  string. Defaults:
  - `"draw:X"` gives "drew " + the marble's name (the active colour scheme's
    marbles, so names match what is shown).
  - Other string moves use `moveLabel`, then `moveLabels`, then the
    capitalised move.
  - Cell moves join cell names with "–". A cell's name is `tags.name`, or
    `#id` if it has none.
- New optional contract hook `moveText(before, move, info)` overrides the
  default for a game. `info` is what `applyMove` returned, so a game can
  report captures, check, fills and so on without re-deriving them.
- `turns(game, options, moves)` groups plies into turns: a turn is a
  maximal run of plies with the same `currentPlayer`. It returns
  `[{ number, player, plies: [{ index, text }] }]`.

The view shows one line per turn, with a token per ply:
`7. White  drew orange · Nf3`. Clicking a token jumps the cursor to after
that ply. A "Start" entry at the top jumps to 0. The cursor's ply is
highlighted and the tail is greyed. When the game ends, a final line shows
the verdict.

Under the log: ⏮ ◀ ▶ ⏭ and **Copy link**. Keys: ← → step a ply, Home/End
jump. Keys are ignored while focus is in a `<select>`.

Cost: stepping replays the line from the start. That is fast for these
games (at most a few hundred plies). If it ever is not, a snapshot cache of
`clone(state)` every N plies is a contained fix.

### Cell names

Boards without names need them for a readable log:

- `hexHexBoard`: "a1"-style names from axial coords, with the file from q
  and the rank from r, offset so they start at a1. Listed in the hex.js tag
  table.
- `cairoBoard`: numbers 1..n in reading order (top to bottom, then left to
  right by centre).

The conformance tests check that names, where present, are unique on every
board.

## Theme

- `base.css` gets a light palette next to the dark one, in the same
  variables (`--bg`, `--panel`, `--text`, `--line`, `--accent`, ...). The
  light palette starts from the reference: paper `#f4f1ea`, panel
  `#fffdf8`, line `#d8d2c4`, ink `#222`.
- The palette is chosen by `@media (prefers-color-scheme: light)`. Setting
  `data-theme="light"` or `"dark"` on `<html>` overrides it. The Theme
  setting sets that attribute and is saved site-wide. Pages declare
  `<meta name="color-scheme" content="light dark">`.
- A tiny inline script in each page head (or in the shared module before
  first paint) applies the saved theme to avoid a flash. The landing page
  uses the same variables, so it follows too.
- Board cells keep their own fills, independent of the page theme. What
  changes around the board is the board-wrap panel. That matters for decor
  drawn just outside the cells: goal edges with halos (Depletion,
  Determinant) and Filament's outline. Each game is checked in both themes.
  Renderer colours that depend on the theme (`HIGHLIGHT` uses the accent)
  become CSS custom properties referenced from SVG `style`, so they follow
  the theme without re-rendering.

## Code structure

`shell.js` already runs to 530 lines, so the new UI is split off:

| Module | Contents |
| ------ | -------- |
| `common/shell.js` | `mount()`: state, flow, AI, input, fitting; builds the page from the parts below |
| `common/timeline.js` | pure moves + cursor model (tested) |
| `common/log.js` | pure `describeMove`, `turns` (tested) |
| `common/ui/dom.js` | `h()`, `escapeHtml`, `<details>` sections with saved open state |
| `common/ui/log-view.js` | log DOM, nav buttons, keyboard |
| `common/ui/setup.js` | Setup rows (moved out of `buildOptions`) |
| `common/theme.js` | read/apply/save the theme |

The `mount()` handle gains `cursor`, `jump(n)` and `live()`.

## Phases

Work happens on a branch (`ui/board-gutter-layout`), with one commit per
phase.

1. **Pure groundwork.** Cell names for hex-hex and Cairo boards;
   `common/log.js`; `common/timeline.js`; tests (`test/log.test.js`,
   `test/timeline.test.js`). Conformance additions: every ply in random
   playouts gets a non-empty `describeMove`, and board names are unique.
2. **Layout.** Restructure the shell's DOM into head, board and gutter
   sections; turn the dialogs into Setup and Rules sections; move the turn
   panel, status, chance and actions into the Turn card; new grid CSS; drop
   the overlay and landscape special cases; rewrite `fitBoard`. Pull the
   blurb from `games.js` by `game.id`. No log yet.
3. **Log and review.** Log section, cursor model wired into play, Undo, the
   AI and chance pauses, input locking, the `at=` hash, keyboard, Copy
   link.
4. **Theme.** Light palette, system preference, Theme setting, no-flash
   apply, landing page, renderer colours as CSS variables.
5. **Per-game log text** (optional, can follow later). `moveText` for
   Liquefaction (algebraic notation: "Nf3", "exd5", "O-O", "=R", "+"/"#"),
   Filament ("e5, +3 filled"), Determinant (recolours) and Cliques (place
   and pull).
6. **Docs and checks.** Update the shell and contract sections in
   `ARCHITECTURE.md` and the "Adding a game" steps. Screenshot every game at
   390×844, 844×390 and 1400×900, in light and dark, and test by hand on a
   real phone.

Phases 1 and 2 are each worth merging alone. Phase 3 depends on 1. Phase 4
depends only on 2.

## Out of scope / later

- The reference's **Batch simulation** card (AI vs AI win rates). It would
  fit as a collapsed "Analysis" section, but it needs a worker-pool driver
  and its own design.
- A display toggle for showing cell names (coordinates) on the board.
- Exporting or importing the log as text.

## Risks and checks

- **Branching by accident.** Clicking the board while reviewing can drop
  the tail. Mitigations: the review strip makes the mode obvious, and a
  move that matches the tail never branches. If this still bites, a
  one-level "restore tail" would fix it.
- **Small landscape phones** (667×375): the gutter is 260px and the board
  is limited by the 375px height, so both fit. Check by screenshot.
- **Rotatable boards** (Depletion on a portrait phone): the board is
  limited by width and now also by the height allowance. Check that the
  rotation choice still looks right.
- **Theme contrast** of board decor against the light panel (see Theme).
