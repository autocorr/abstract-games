# Bag of Tricks: rules

Rules extracted from *Bag of Tricks: Modern Strategy Games Using Elementary
Methods of Chance* (Brian E. Svoboda, `references/Bag_of_Tricks.pdf`,
CC BY-SA 4.0). The games are perfect-information abstracts with one source of
chance: drawing marbles from a bag. The booklet assumes a glass dish rather
than an opaque bag, so the bag's contents are always public. On the board,
pieces are called **checkers** or **stones**. Items drawn from a bag are called
**marbles**.

The booklet is a work in progress. Each game below has a **status**:

- **Complete**: the rules are fully specified (apart from small gaps listed
  under *Open questions*), with figures and examples.
- **Draft**: the core rules are written, but setup, board size or edge cases
  are missing.
- **Sketch**: a design idea with rules that contradict each other or are
  missing in places.

*Open questions* lists every gap or contradiction found in the text. Where an
implementation needs a choice, a **provisional default** is suggested. These
defaults are not decisions. Each one should become a game option, or be
revisited before that game is built.

| #  | Game                  | Inspired by                | Board                 | Chance mechanism                                   | Status   |
| -- | --------------------- | -------------------------- | --------------------- | -------------------------------------------------- | -------- |
| 1  | Wavefunction Collapse | Hens and Chicks, Breakthrough | 8×8 chequered      | 1 draw/turn picks square colour; cycle and refill  | Complete |
| 2  | Disperse              | Hex                        | Hex rhombus, 3 colours | Bag = one marble per cell, never refilled         | Draft    |
| 3  | Accrete               | Catchup                    | Hex-hex               | Push-your-luck draws set the number of placements  | Draft    |
| 4  | Parity Inversion      | Odd                        | Hex-hex               | Draw picks stone colour; bag grows or shrinks with groups | Sketch |
| 5  | Alpha Decay           | Chase, Lielow              | 8×8                   | Run of white draws picks the stack height to move  | Sketch   |
| 6  | Recombination         | Lines of Action            | 8×8 (assumed)         | Per-player bag picks distance; black marble adds a checker | Draft |
| 7  | Cyclotron             | Hawalis (mancala)          | 3×7 pits              | Per-player bag gives extra sowings                 | Sketch   |
| 8  | Liquefaction          | Chess                      | 6×6 / 8×8, 4 colours  | Draw "colour-checks" the King; bag refilled by moves | Draft  |
| 9  | Bivalent              | Yavalath, Squava           | 7×7 points            | Draw picks own stone vs neutral red stone          | Complete |
| 10 | Manifold              | Go, Blooms                 | 9×9 points            | Per-player bag; 2 draws pick the colours to place  | Draft    |

---

## 1. Wavefunction Collapse

**Status:** Complete. **Inspired by:** James Ernest's *Hens and Chicks*, Dan
Troyka's *Breakthrough*.

Get one of your checkers across the board. Each turn, a marble drawn from the
bag says which square colour you must move from.

### Components

- An 8×8 chess board with light and dark squares (a1 is dark).
- 12 white and 12 black checkers.
- 7 marbles: 3 white, 3 black, 1 gray.

### Setup

From Figure 1.1:

- **White:** all of rank 2, plus a1, d1, e1 and h1.
- **Black:** all of rank 7, plus a8, d8, e8 and h8.
- **Bag:** 3W 3B 1G.

White moves first.

### Turn

1. **Draw.** Draw a marble and set it aside, keeping the order of draws
   visible.
   - **White** marble: move a checker that is on a light square.
   - **Black** marble: move a checker that is on a dark square.
   - **Gray** marble: it takes the colour of the previous marble drawn. If
     gray is the first marble of the game, you may move any checker.
   - When all 7 marbles have been drawn (after 7 turns), put them all back in
     the bag.
2. **Move.** Move one checker of the drawn colour one square diagonally
   forward, onto an empty square. A checker can never move straight forward
   or backward. Because it only moves diagonally, it always stays on its
   starting colour.
3. **Capture.** If the moved checker lands directly beside (left or right of)
   an opposing checker on the same rank, that checker is captured and removed.
   If the landing square is between two opposing checkers, with one on each
   side, nothing is captured. The checker has moved into a protected gap.
   - Side-by-side squares are always opposite colours, so a checker can only
     capture, and only be captured by, checkers on the other square colour.
     Same-colour checkers block each other but never capture each other.

### End

- You win if one of your checkers is on the far rank at the end of your turn:
  rank 8 for White, rank 1 for Black.
- If you have no legal move, you are stalemated and lose.

### Notation

Squares are written a1 to h8. Marbles are written W, B and G. The bag is
written as a sum, e.g. `3W 3B 1G`. Draws are written in order, e.g.
`BBGWWBW`.

### Variant: bag alteration

Needs 6 white and 6 black marbles in the supply. All the standard rules
apply. In addition, after a capture, an already-drawn marble may be replaced
with a white or black marble chosen from the supply. The undrawn contents of
the bag cannot be changed. Example: `3B 3W 1G`, then a drawn B is replaced by
a W, giving `2B 4W 1G`.

### Decisions

The open questions in the booklet are settled as follows for the
implementation.

- **Marble count.** The bag starts as **3W 3B 1G**. The component list's
  "3 white, 3 black, and 1 white" is a typo for 1 gray, and the formal rules'
  "three white marbles and three black marbles" leaves out the gray.
- **Gray as the first draw of a new cycle.** Gray takes the colour of the
  last marble drawn, which is the last marble of the previous cycle. If that
  marble was itself gray, gray keeps the colour it stood for. Only the very
  first draw of the game lets you move any checker.
- **Drawn colour with no legal move.** If none of your checkers on the
  drawn colour can move, you must pass. Only if no checker of yours can move
  at all, on either colour, are you stalemated, and you lose. (A full
  lock-up can happen: White a3, c3 against Black b4, d4 blocks every
  diagonal.) The booklet's strict reading, where no move for the drawn
  colour loses, ended 43–51% of MCTS self-play games in stalemate (see the
  trials below). Passing keeps cutting off a colour worth doing, through
  lost tempo, without making it the usual way to win.
- **Back rank.** The back rank is random rather than fixed. White's 4
  back-rank checkers go on 4 of the 8 squares of rank 1, chosen at random
  (70 setups, each equally likely). Black's back rank is the same set turned
  180° (a1 ↔ h8, b1 ↔ g8, ...), so each side has the same square colours.
  Ranks 2 and 7 are always full. The booklet setup (a1, d1, e1, h1) is one
  of the 70.
- **Variant.** Set aside for now. Its open questions (who replaces a marble,
  whether gray can be replaced, whether declining is allowed, and whether a
  capture on the 7th draw comes before the refill) are not decided.
- **Swap rule.** None for now. MCTS self-play with forced passing found a
  small first-player edge, about 3 points:

  | Search per move | Games | White wins |
  | --------------- | ----- | ---------- |
  | 2,000 iterations | 1,000 | 53.5% ± 1.6 |
  | 10,000 iterations | 400 | 52.0% ± 2.5 |

  Games last about 57 moves, and 1–2% end in stalemate. The loser passes
  about once a game and the winner 0.2–0.3 times. A swap would be simple to
  add (turning the board 180° keeps every square's colour). Under the
  earlier lose-on-stalemate rule, White won 49.0% ± 2.5 of 400 games at
  2,000 iterations and 48.0% ± 3.5 of 200 at 10,000; games lasted about 52
  moves, and 43–51% ended in stalemate.
- **Turtling** (advancing as a flat phalanx) is not a dominant strategy.
  "Turtle" takes a winning move if it has one and otherwise moves its
  rearmost movable checker; "turtle + captures" takes a capture first. With
  forced passing:

  | Turtle player | Opponent | Games | Turtle wins | Stalemates |
  | ------------- | -------- | ----- | ----------- | ---------- |
  | Turtle | MCTS 2,000 | 400 | 0.8% | 4% |
  | Turtle | MCTS 10,000 | 120 | 0% | 2% |
  | Turtle + captures | MCTS 2,000 | 400 | 12.0% | 6.5% |
  | Turtle | Random | 8,000 | 31.9% | 6% |
  | Turtle | Greedy (win, else capture, else random) | 8,000 | 17.5% | 5% |
  | Turtle + captures | Greedy | 8,000 | 52.9% | 23% |
  | Turtle + captures | Turtle | 8,000 | 53.0% | 21% |

  Each pairing is split evenly between the colours. A strict phalanx passes
  up captures and loses even to random play. MCTS keeps a looser formation
  (about 3 ranks from front to rear checker, against 2 for the turtles).
  Under lose-on-stalemate the turtles did about as badly: 1.3% and 13.5%
  against MCTS 2,000.

---

## 2. Disperse

**Status:** Draft. **Inspired by:** *Hex* (Piet Hein, John Nash).

Connect your two sides of the board. A bag holds one marble for each cell,
and it is drawn down over the whole game.

### Rules

- The board is an initially empty hex grid in the shape of a rhombus with
  equal sides. Opposite pairs of sides belong to White and to Black.
- The cells are coloured with three colours in a regular pattern. Following
  the standard hex 3-colouring, no two neighbouring cells share a colour.
- The bag starts with one marble per cell, in the same colour proportions as
  the board.
- On your turn, draw a marble, set it aside, and place a stone of your colour
  on an empty cell of the drawn colour.
- You win by connecting your two sides with a chain of your stones. A player
  may also resign.

Every draw removes one marble of a colour and every placement fills one cell
of that colour. The marbles left of each colour therefore always equal the
empty cells of that colour, so a legal placement always exists. As in Hex,
there are no draws.

### Alternate rules

- The board and colouring are the same as above.
- The bag holds 2 red, 2 green and 2 blue marbles. On your turn, draw two
  marbles one after the other, without replacement. Return both to the bag at
  the end of the turn.
- **Same colour:** place a stone on a cell of that colour, then you may place
  a second stone on a neighbouring cell.
- **Different colours:** place one stone on a cell of the first marble's
  colour.

### Open questions

- **Board size.** It is not given. Hex is commonly 11×11. A size that is a
  multiple of 3 gives equal colour counts. *Provisional default:* options for
  9, 11 and 12, defaulting to 11.
- **First-player advantage.** There is no swap or pie rule. Chance softens
  the first-move advantage, but by how much is unknown. *Provisional
  default:* no swap rule, but keep a swap option.
- **Alternate rules, second stone.** Is the "neighbouring cell" next to the
  first stone? Can it be any colour? *Provisional default:* any empty cell
  next to the first stone, of any colour.
- **Alternate rules, no cell of the drawn colour.** On a nearly full board
  there may be no empty cell of the drawn colour. *Provisional default:* the
  player passes.

---

## 3. Accrete

**Status:** Draft. **Alternative name:** Coagulate. **Inspired by:** Nick
Bentley's *Catchup*.

Make the largest connected group. You choose how many marbles to draw, in a
push-your-luck fashion.

### Rules

- **Materials:** a hex-hex board, white and black stones, and a bag of white
  and black marbles. The bag holds 3 white and 3 black marbles.
- **Drawing.** At the start of your turn, draw marbles one at a time without
  replacement.
  - Black marbles drawn before the first white are ignored.
  - After the first white, you may stop or keep drawing.
  - Each further white adds to your count, and you may keep drawing.
  - If you draw a black after the first white, you must pass: you **bust**
    and place nothing.
- **Placement.** If you stop without busting, place as many stones of your
  colour as the white marbles you drew, on empty cells. Stones never move and
  are never captured.
- **End.** The game ends when the board is full. The player with the largest
  connected group of stones wins. Players may also resign, or agree to a
  draw.
- It can also be played with pencil and paper.

### Design notes from the booklet

- An uneven bag, e.g. 4 white and 2 black, may make high counts more likely.
  Estimate the frequencies with Monte Carlo simulation.

### Open questions

- **Returning marbles.** The rules don't say when marbles go back.
  *Provisional default:* all marbles return at the end of every turn.
- **Bag composition.** It is 3W 3B, but the notes suggest 4W 2B.
  *Provisional default:* make it an option, 3W 3B or 4W 2B.
- **Ties for largest group.** No tie-break is given. *Provisional default:*
  compare the next-largest groups, as in Catchup. If they are tied all the
  way down, the game is a draw.
- **Board size.** It is not given. *Provisional default:* hex-hex with side 5
  or 6.
- **Overflow.** If a player has more stones to place than there are empty
  cells, they place as many as fit.
- **First-player advantage.** There is no balancing rule (Catchup has
  one). Unknown whether one is needed.

---

## 4. Parity Inversion

**Status:** Sketch. **Inspired by:** Nick Bentley's *Odd*.

Have the most groups of your colour. Players place stones of *either* colour.
Marbles are added to or removed from the bag based on how the number of
groups changes, which gives some negative feedback.

### Rules (as written)

- The board is a hex-hex grid with white and black stones. The bag starts
  with 2 white and 2 black marbles.
- The player with the most groups of their colour wins.
- On your turn, draw a marble and place a stone of the **opposite** colour.
  Return the marble to the bag at the end of the turn.
- At the end of the turn, marbles **of the drawn marble's colour** (not the
  placed stone's colour) are added to or removed from the bag:
  - **The placement made a new group,** i.e. a new singleton: add 1 marble.
  - **The placement merged groups:** remove 1 marble for each group lost,
    usually 1 and up to 3.
  - **The group count stayed the same,** i.e. an existing group was extended:
    no change.

### Design notes from the booklet (unresolved)

- "Largest group" was already used in Accrete, so this game should make "most
  groups" work.
- Same-colour feedback (as written above) is too non-linear. A player can
  make many singletons to tilt the odds, then connect them at the end, which
  is degenerate.
- For negative feedback, add marbles of the *opposite* colour instead. A
  simpler alternative: place a stone of the drawn colour.
- Under negative feedback, extending a group doesn't change the odds.
  Drawing your own colour makes you weigh a new group (good for you) against
  improving the opponent's odds.
- Other scoring candidates:
  - total number of groups;
  - only even-sized groups, which excludes singletons;
  - only odd-sized groups larger than 3. Odd itself counts only odd-sized
    groups larger than 5.

### Open questions

- Which feedback direction to use, and which scoring rule.
- When the game ends. *Provisional default:* when the board is full.
- What happens when a colour runs out of marbles, or the bag empties.
- Which colour each player owns, and who starts.

---

## 5. Alpha Decay

**Status:** Sketch. **Alternative name:** Tokamak. **Inspired by:** Tom
Kruszewski's *Chase*, Michael Amundsen and Alek Erickson's *Lielow*.

Force your opponent to collect all their pieces into three stacks. The
repeated draws favour low counts over high ones.

### Rules (as written)

- **Board:** an 8×8 board with 12 white and 12 black checkers.
- **Win:** you win when your opponent is reduced to three stacks.
- **Drawing.** Draw marbles one at a time:
  1. Discard black marbles until the first white.
  2. After the first white, keep drawing and count the whites, until a black
     is drawn.
  3. The count is the number of white marbles drawn. There is no
     push-your-luck choice; the draw runs on its own.
- **Moving.** Move one of your stacks whose height equals the count.
  - With a count of 4, you may either move a 4-high stack, or split any stack
    by moving part of it onto a neighbouring space.
  - A stack is at most 4 checkers high.
  - A stack moves by leaping exactly as many spaces as its height.
- **Capture.** If your stack lands on an opposing stack, that stack is
  captured. Its owner must spread the captured checkers over their other
  stacks, but may not add to stacks that are already 4 high.

### Design notes from the booklet

- As with Recombination, an uneven bag (more white than black) would make
  higher counts more likely.

### Open questions

- **Starting position** and the **bag's contents.** Neither is given.
- **When marbles are returned.** *Provisional default:* at the end of each
  turn.
- **Movement.** Which directions are allowed (orthogonal, diagonal, or
  both)? Is a "leap" a jump over the squares in between? Can a stack land on
  a friendly stack and merge with it, up to the 4-high cap?
- **No matching stack.** What happens when you have no stack of the drawn
  height? Options are pass, or move the nearest height. Also undefined: a
  count above 4, or a bag that runs out.
- **Capture details.** When the captured checkers can't all be placed because
  every other stack is 4 high, are the extras lost? Does the capturing stack
  stay at its height?
- **"Reduced to three stacks"**: does that mean three or fewer? *Provisional
  default:* ≤ 3.

---

## 6. Recombination

**Status:** Draft. **Inspired by:** Claude Soucie's *Lines of Action*.

Join all your checkers into one connected group. Each player has their own
bag. The black marble in it is removed for good after it has been drawn
enough times.

### Rules

1. Two players, White and Black, with white and black checkers.
2. Each player has a bag of red, green, blue and black marbles. Marbles are
   drawn without replacement, and the bag is refilled when it is empty.
3. The drawn colour sets the exact distance a checker moves:
   - red = 1, green = 2, blue = 3;
   - these colours appear in the ratio 3 : 2 : 1, so a bag has 3 red, 2
     green and 1 blue.
4. **Black marble.** Each bag also has one black marble. When you draw it,
   you must place a new checker on an empty edge square, not a corner.
   - You may introduce a checker on each board edge only once. A checker
     placed outside the board along an edge reminds you that the edge is
     unused.
   - After it has been drawn four times, the black marble is removed from
     play.
5. A checker may move over friendly checkers but not over opposing ones. It
   may land on an opposing checker but not on a friendly one.
6. Landing on an opposing checker captures it, and it is removed from play.

### Open questions

- **Black marble lifetime.** Rule 2 says the black marble is removed when
  drawn. Rule 4 says it is removed after four draws, once per edge.
  *Provisional default:* follow rule 4. The black marble goes back on each
  refill until it has been drawn four times.
- **Board size and setup.** Neither is given. *Provisional default:* 8×8,
  using the Lines of Action start: 6 checkers on each of a player's two
  opposite edges, corners empty.
- **Direction of movement.** *Provisional default:* a straight line in any of
  the 8 directions, as in LOA. The distance comes from the marble, not from
  LOA's line count.
- **Connectivity.** *Provisional default:* 8-neighbour, as in LOA.
- **Both players connected at once.** *Provisional default:* the mover wins,
  as in LOA. A player reduced to one checker counts as connected.
- **No legal move**, either for the drawn distance or for placement after a
  black draw. *Provisional default:* pass.

---

## 7. Cyclotron

**Status:** Sketch. **Inspired by:** the traditional mancala game *Hawalis*.

A mancala game where draws can give you extra sowings. Each player has a bag,
and white marbles are added to it based on the captures the opponent makes.

### Rules (as written)

- **Board:** a 3×7 board of pits. Each player owns their near row; the middle
  row is shared. Every pit starts with 2 stones.
- **Win:** capture 29 or more stones. If both players capture 28, the game is
  a draw.
- **Sowing.** Sow counter-clockwise through your near row and the middle row,
  using relay sowing.
  - You must sow from a pit with 2 or more stones. You may sow a single stone
    only if all your pits hold singletons.
  - **Capture:** capture if the final pit is a middle pit and the opponent's
    near row holds an odd number of stones. Captured stones go to your store.
- **Bag.** Each player's bag starts with 10 black marbles.
  - Before sowing, draw a marble from your own bag. On white, you may sow
    again after this sowing, drawing again first. On black, your turn ends
    after this sowing.
  - Marbles are drawn without replacement during a turn, and all drawn
    marbles return to the bag at the end of the turn.
  - For every capturing move you make, a white marble is added to your
    **opponent's** bag. This is catch-up feedback.
- **Feeding.** If a player has no stones to play, the opponent must make a
  move that gives them stones. If no such move exists, the game ends.

### Open questions

- **Stone count.** A 3×7 board with 2 stones per pit holds 42 stones, but
  the 29 / 28 targets imply 56 stones, i.e. a 4×7 board as in Hawalis. The
  board size or the starting count needs to be fixed.
- **Sowing direction.** Both circuits share the middle row, so the players
  presumably sow through it in opposite directions. Confirm.
- **What exactly is captured.** The opposite pit in the opponent's near row,
  or that row's contents? "Odd number of stones" in the whole row, or in the
  opposite pit?
- **Relay sowing details.** Does relay sowing stop at empty pits only, or
  also at captures?
- **Leftover stones** when the game ends because the opponent can't be fed.
- **Marble return.** There is a contradiction: "the drawn marble is returned
  to the bag" versus "drawn without replacement, returned at end of turn".
  *Provisional default:* without replacement during a turn, returned at the
  end.

---

## 8. Liquefaction

**Status:** Draft. **Inspired by:** International Chess.

Checkmate on a board shaded in four colours. The bag always holds a fixed
number of marbles, but which colours they are changes during play.

### Board and colours

The squares are shaded in four colours, one for each sub-grid a **Dabbaba**
((2,0) leaper) can reach. Each colour is a class of (file parity, rank
parity). In Figure 8.1, which shows 6×6:

- odd ranks alternate dark purple and light pink, starting with purple at a1;
- even ranks alternate light cyan and teal, starting with cyan at a2.

Two classes are dark and two are light, so the board still reads as an
ordinary checkerboard. The implementation names the classes by letter and
colours them with a theme (a game option). In each theme, the two dark
colours have the same OKLCH lightness (0.66), and so do the two light
colours (0.88). The colours within a pair differ only in hue, and the
light/dark contrast stays obvious.

| Class | Squares                    | Shade | Booklet | Classic | Cyan/magenta | Colour-blind safe (default) |
| ----- | -------------------------- | ----- | ------- | ----------------- | ------------ | ----------------- |
| A     | odd file, odd rank (a1)    | dark  | purple  | red `#db6c66`     | purple `#b576c3` | vermilion `#d77343` |
| B     | even file, odd rank (b1)   | light | pink    | yellow `#f9d460`  | pink `#ffc4de`   | yellow `#f9d460`    |
| C     | odd file, even rank (a2)   | light | cyan    | green `#8ef29e`   | cyan `#8ce9f4`   | sky `#aedffd`       |
| D     | even file, even rank (b2)  | dark  | teal    | blue `#5d94da`    | teal `#31a5a5`   | blue `#6293db`      |

The colour-blind theme uses an orange/blue contrast within each pair. In
simulated protanopia, deuteranopia and tritanopia (Machado 2009, full
severity), every pair of its colours stays at least 14 ΔE_OK × 100 apart.
In the classic theme, yellow and green are only 7 apart under red-green
colour blindness. Marbles use the same fills as their squares.

### Rules

- **Bag.** The supply has 20 marbles, 5 in each colour. The bag holds 5
  marbles drawn from them at random. Figure 8.1 shows 1 cyan, 1 teal, 1
  pink, 2 purple (see *Decisions* for the starting bag used).
- **Colour-check.** At the start of your turn, draw a marble. Squares of that
  colour count as **threatened** for your King this turn:
  - if your King stands on that colour, it must leave the square or you
    lose;
  - your King cannot move to, or capture on, a square of that colour this
    turn.
- **Replacing the marble.** Set the drawn marble aside, and put a marble into
  the bag matching the colour of the square your moved piece lands on. The
  bag always holds 5 marbles.
- **Pieces.** Normal chess rules apply, except:
  - there are no Queens;
  - a pawn reaching the last rank may promote to a Knight, Bishop or Rook;
  - stalemate is a **loss** for the stalemated player.
- **Small game, 6×6.** Each side has 6 Pawns, 2 Knights and 2 Bishops, set up
  as `NB1KBN`: White a1 N, b1 B, c1 empty, d1 K, e1 B, f1 N, with pawns on
  rank 2. Black mirrors this on ranks 6 and 5.
  - There is no pawn double step and no en passant.
  - The Queen squares (c1 and c6) stay empty, to avoid smothered mate when
    the King is colour-checked.
- **Full game, 8×8.** Each side has 8 Pawns and `RNB1KBNR` (the Queen
  squares d1 and d8 stay empty). Normal pawn moves apply. You may not castle
  while colour-checked.

### Design notes from the booklet

- Colour-checks greatly limit the King's mobility, so mate becomes possible
  with weaker pieces. They act a bit like a knight fork: you can often make
  two captures while the opponent's King is forced to move instead of
  recapturing.
- The draws should mainly affect tempo and the initiative.
- The King's horizontal neighbours share a colour, so a bare King or a
  Commoner can stalemate the opponent.
- Bishops are preferred over Ferz on 6×6. Edge pawns are weak.
- Optional: if one side gets down to a single piece besides the King, add
  Xiangqi's **flying King** rule, to make mate easier with little material.

### Decisions

The open questions in the booklet are settled as follows for the
implementation.

- **Starting bag (option).** The default is a fixed bag that gives each
  King's starting colour the same count:
  - 6×6: Figure 8.1's bag, 2 A, 1 B, 1 C, 1 D. The Kings start on d1 (B)
    and d6 (D).
  - 8×8: 1 A, 2 B, 1 C, 1 D. The Kings start on e1 (A) and e8 (C). Figure
    8.1's bag would colour-check White's King 2 times in 5 but Black's only
    1 in 5. As on 6×6, the doubled colour is the one beside White's King on
    its home rank.
  - Option **random bag:** the bag starts as 5 marbles drawn at random from
    the 20, as 5 chance plies before White's first turn.
- **Supply.** Drawn marbles go back to the supply at once. A colour can
  then never run out: after a draw the bag holds 4 marbles, so at least 1 of
  every colour is outside it.
- **Legality and losing.** Colour-check is an extra legality condition. A
  move is legal only if, afterwards, your King is not attacked and does not
  stand on a colour-checked square. If you have no legal move after your
  draw, you lose. This covers checkmate, "colour-mate" (no move can both
  escape check and leave the colour) and stalemate alike.
- **Castling (8×8).** You may not castle while colour-checked (your King
  stands on the drawn colour), and the King may not land on the drawn colour.
  It **may** pass through a colour-checked square. As in chess, it may not
  castle out of, through or into a normal check.
- **Replacement colour.** The marble added to the bag matches the moving
  piece's landing square. For castling that is the King's destination. For
  promotion and en passant it is the pawn's destination.
- **Draw rule.** The 50-move rule: the game is a draw after 100 consecutive
  plies by the players (chance plies don't count) with no capture and no
  pawn move. There is no threefold-repetition rule and no
  insufficient-material rule, since a bare King can still win by
  stalemating the opponent.
- **Flying King.** Left out of the first implementation.
- **Colour theme (option).** Colour-blind safe (default), classic, or
  cyan/magenta, as in the table under *Board and colours*. This only
  changes the display.

---

## 9. Bivalent

**Status:** Complete. **Inspired by:** Cameron Browne's *Yavalath*, Néstor
Romeral Andrés's *Squava*.

Score points for lines of four, and avoid making lines of three, which score
for your opponent. Red marbles leave the bag until they score, so the odds
shift over the game.

### Components

- A 7×7 board, or another odd size. Stones are played on the 49
  intersections ("points"), as in Go.
- 25 white, 25 black and 5 red stones.
- 5 gray and 5 red marbles.

### Setup

White moves first. The board starts empty. The bag holds `5G 5R`.

### Turn

1. Draw a marble.
   - **Gray:** place a stone of your colour on any empty point, and return
     the marble to the bag.
   - **Red:** place a neutral red stone on any empty point, and set the
     marble aside.
2. Score any lines of three or four made by the placement.

### Scoring lines

Lines run horizontally, vertically or diagonally. A line is made of your
stones and/or red stones.

- **Four in a row:** you score 1 point.
- **Exactly three** (not part of a four): your **opponent** scores 1 point.
- **Five or more** (an overline): scores nothing.
- Each line scores separately. Example (Fig. 9.2): a placement that makes one
  three and one four gives each player 1 point.

### Neutral stones

- During scoring, red stones count as the colour of the player whose turn it
  is.
- When a red stone takes part in a scored line of three or four, it is
  replaced with a stone of that player's colour, and one red marble is
  returned to the bag for each red stone replaced.
- A red stone that does not score stays red, and on the next turn it counts
  for the other player.
- Example (Fig. 9.3): a red stone placed where it is on the end of one of the
  *opponent's* lines of three can't score on your turn. On their turn it
  then completes the three, which counts against them. This is a common
  endgame tactic.

### End

- The game ends when every point is occupied.
- The player with more points wins.
- If points are tied, the player who scored last wins.
- If neither player scored at all, the game is a draw.

### Variant

Once all red stones have been placed, they are immediately replaced with
stones of the current player's colour, and all red marbles return to the bag.

### Notation

Points are written a1 to g7, and marbles G and R.

### Decisions

The open questions in the booklet are settled as follows for the
implementation.

- **Which lines count.** After each placement, check the maximal run, in
  each of the 4 directions, through the placed stone and through every red
  stone on the board. Red stones count as the mover's colour. A run of
  exactly 3 scores for the opponent, exactly 4 for the mover, and 5 or more
  scores nothing. Rescoring red stones each turn is what makes Fig. 9.3 (3)
  work: a red stone that completes the opponent's three scores against them
  on their next turn, wherever they play. A line never scores twice: a red
  stone in a scoring line converts at once, and a line without red stones
  only changes when a stone is placed in it.
- **Conversions.** A converted stone takes the mover's colour, which it
  already counted as this turn, so a conversion makes no new lines. A run of
  the mover's own stones that a conversion to the *other* colour cuts out of
  a longer run is not scored, since it holds neither the placed stone nor a
  red stone.
- **Red supply.** A converted red stone goes back to the reserve, with its
  marble back in the bag, so the red marbles in the bag always equal the red
  stones in reserve.
- **Ties.** The "player who scored last" tie-break is dropped. A komi, set
  in 0.5 steps from White +3 to Black +3, is added to one player's points; a
  fractional komi rules out ties, and with a whole-number komi a tie is a
  draw. The default is **White +1.5**, from MCTS self-play trials, which
  found the second player ahead:

  | Search per move | Games | Mean White − Black | White wins, komi White +1.5 | White +0.5 | Black +0.5 |
  | --------------- | ----- | ------------------ | --------------------------- | ---------- | ---------- |
  | 2,000 iterations | 240 | −0.67 ± 0.31 | 58% | 49% | 38% |
  | 10,000 iterations | 120 | −1.21 ± 0.39 | 54% | 43% | 28% |

  Black's edge grows with playing strength, so a stronger AI or human play
  may call for more. About 28 points are scored in a game.
- **Board.** 7×7 only, for now.
- **Stone counts.** Ignored: a player never runs out of stones.
- **Variant.** Set aside for now.

---

## 10. Manifold

**Status:** Draft. **Inspired by:** Go, Nick Bentley's *Blooms*.

Control the most territory. Each player owns two stone colours, and their own
bag decides which colours they may place. Captures let a player change the
contents of a bag.

### Components

- A 9×9 board, with stones played on the points as in Go.
- About 20 stones in each of four colours: light red, dark red, light blue
  and dark blue.
- Marbles in the same four colours.

### Setup

- **Red** (first player) owns light red and dark red. **Blue** (second
  player) owns light blue and dark blue.
- The board starts empty, and each player has their own bag of marbles in
  their two colours.

### Turn

1. **Draw** two marbles from your own bag and show them. They are the colours
   of stone you may place this turn. Return them at the end of the turn.
   - On Red's first turn only, draw one marble and place one stone. This
     balances the first-move advantage (the booklet writes it as 1-2\*).
2. **Pass or place.** Either:
   - **place** up to two stones in the drawn colours, one at a time;
   - **pass** this turn only; or
   - **pass permanently**, for all following turns.

### Groups, liberties and capture

- **Group:** stones of the *same colour* connected orthogonally. Light red
  and dark red stones form separate groups.
- **Liberty:** an empty point orthogonally next to a group. Any stone,
  including your own stone of the other colour, takes away a liberty.
- **Capture:** a placement that removes an opposing group's last liberty
  captures it. The stones go back to their owner's reserve.
- **Illegal placements.** A placement is illegal if it leaves one of your own
  groups with no liberties, whether it is the placed stone's group or your
  other colour's group. The exception is a placement that captures an
  opposing group and so frees liberties.
- **Bag change after a capture.** (The text contradicts itself; see below.)
- **Ko.** No ko rule. Repeating cycles are expected to be broken by
  uncooperative draws.

### End

- The game ends when both players have passed permanently.
- Dead stones, as agreed by both players, are removed.
- **Score:** area (Chinese) scoring. A player scores their stones on the
  board (both colours) plus the empty points enclosed only by their stones.
  Captured stones are not counted.

### Design notes from the booklet

- A player needs different plans for different draws. Your two colours
  support each other but aren't interchangeable. A mixed-colour shape is
  weaker than a single colour, because your own other colour takes liberties.
- Captures matter beyond territory, because they let you change the bag.
  That makes kos tricky.
- The endgame has some chance in it: a player may need a particular colour
  to claim a neutral point or secure a group.

### Open questions

- **Bag contents.** The text gives three different versions:
  - "four light and four dark" marbles per player;
  - 5 marbles per player: Red 2 light + 3 dark, Blue 3 light + 2 dark;
  - "five marbles in the same colors as the stones".

  *Provisional default:* 5 marbles per bag, Red 2L 3D and Blue 3L 2D (from
  the formal rules), with an option for 4L 4D.
- **Who changes a bag after a capture, and how.** There are two versions:
  - the player whose stones were captured may replace one of their marbles
    with a colour of their choice, as long as at least one marble of each
    colour remains;
  - the capturing player may swap the colours of the marbles they drew.

  These are very different rules. Make this an option, and pick one through
  playtesting.
- **Dead stones** have no automatic resolution. *Provisional default:* no
  removal by agreement; play it out, since permanent passing allows that.
  Score the board as it stands.
- **Komi.** Unresolved: does the 1-2\* opening balance the game, or is komi
  needed? *Provisional default:* a komi option (0 by default).
- **Drawing two marbles and placing one.** If both marbles are the same
  colour, can you place just one stone? *Provisional default:* yes, "up to
  two".
- **A permanent passer later.** Do they still draw? *Provisional default:*
  their turns are skipped completely.
