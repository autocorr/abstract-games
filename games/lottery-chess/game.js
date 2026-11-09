// Lottery Chess: chess in which each turn may win a piece for your hand.
// Pure: no DOM. The chess and the drops come from common/chess.
//
// Each player has their own bag of 7 marbles: 2 white (a prize) and 5
// black (nothing). A turn starts with a draw from the mover's bag
// ("draw:W"), except White's first, to offset the first move; on white, a ten-sided die ("roll:7") picks the piece put in
// the mover's hand: 1-4 Pawn, 5-6 Knight, 7-8 Bishop, 9 Rook, 10 Queen. A
// bag is not refilled until all 7 are drawn, so each player wins exactly 2
// pieces every 7 draws. Drawn marbles stay in view until the refill.
//
// Then the player moves as in chess, or drops a piece from their hand onto
// any empty square instead (as in Crazyhouse: pawns not on the first or
// last rank; a drop may give check or mate but may not leave your own King
// in check). Captured pieces leave the game: only prizes go to the hand.
// A dropped pawn on its second rank may double-step, and a dropped Rook
// gives no castling rights. Having no legal move is judged after the draw,
// since a piece won may block a check: so a mating move is logged "+", and
// the game ends on the defender's draw. Checkmate wins; stalemate is a
// draw, as is 50 moves each without a capture, pawn move or pawn drop.

import { makeBag, cloneBag, drawOutcomes, drawMarble, returnDrawn, bagSize, totalCounts, bagPanel } from "../../common/bag.js";
import { rollOutcomes, rolledValue, dicePanel } from "../../common/dice.js";
import { chessGame, PLAYERS } from "../../common/chess/game.js";
import { KING, QUEEN, ROOK, BISHOP, KNIGHT, pawn } from "../../common/chess/movement.js";
import { WHITE, BLACK, addToHand } from "../../common/chess/rules.js";

const BAG = { W: 2, B: 5 };
const DIE = 10;
// The prize for each face of the die, from 1.
const PRIZES = ["P", "P", "P", "P", "N", "N", "B", "B", "R", "Q"];
const NAMES = { P: "Pawn", N: "Knight", B: "Bishop", R: "Rook", Q: "Queen" };

const RULES = {
  types: [
    { key: "P", name: "Pawn", letter: "", image: "P", value: 1, moves: pawn(), pawn: true, promote: ["Q", "R", "B", "N"] },
    { key: "N", name: "Knight", letter: "N", image: "N", value: 3, moves: KNIGHT },
    { key: "B", name: "Bishop", letter: "B", image: "B", value: 3, moves: BISHOP },
    { key: "R", name: "Rook", letter: "R", image: "R", value: 5, moves: ROOK, castler: true },
    { key: "Q", name: "Queen", letter: "Q", image: "Q", value: 9, moves: QUEEN },
    { key: "K", name: "King", letter: "K", image: "K", value: 0, moves: KING, royal: true },
  ],
  castling: [
    { name: "O-O", king: "e1", rook: "h1", kingTo: "g1", rookTo: "f1" },
    { name: "O-O-O", king: "e1", rook: "a1", kingTo: "c1", rookTo: "d1" },
  ],
  drops: ["P", "N", "B", "R", "Q"],
};

const prizeOf = (value) => PRIZES[value - 1];
const article = (name) => (/^[AEIOU]/.test(name) ? "an " : "a ") + name;

const base = chessGame({
  id: "lottery-chess",
  title: "Lottery Chess",
  url: import.meta.url,
  rules: () => RULES,
  setup: () => [
    ["R", "N", "B", "Q", "K", "B", "N", "R"],
    Array(8).fill("P"),
  ],
  init(s) {
    s.bags = [null, makeBag(BAG), makeBag(BAG)];
    s.rolling = false;   // drew white this turn; the die is next
    s.roll = 0;          // this turn's die, once rolled
    s.opening = true;    // White's first turn, which has no draw
  },
  clone(copy) {
    copy.bags = [null, cloneBag(copy.bags[WHITE]), cloneBag(copy.bags[BLACK])];
  },
  drawPly: {
    chances(s) {
      if (s.rolling) return rollOutcomes(DIE);
      const bag = s.bags[s.turn];
      return drawOutcomes(bagSize(bag) ? bag : makeBag(totalCounts(bag)));
    },
    apply(s, move) {
      if (s.rolling) {
        s.roll = rolledValue(move);
        s.rolling = false;
        addToHand(s, s.turn, prizeOf(s.roll));
        return;
      }
      const bag = s.bags[s.turn];
      if (!bagSize(bag)) returnDrawn(bag);   // all 7 drawn: refill
      s.rolling = drawMarble(bag, move) === "W";
    },
    done: (s) => !s.rolling,
    skip: (s) => s.opening,
  },
  afterMove(s) {
    s.roll = 0;
    s.opening = false;
  },
});

const game = {
  ...base,
  marbles: {
    W: { name: "White", fill: "#f2f2f0" },
    B: { name: "Black", fill: "#202329" },
  },

  // "drew white", then "rolled 7: Bishop".
  moveText(s, move, info, scheme) {
    if (typeof move === "string" && s.rolling) {
      const value = rolledValue(move);
      return `rolled ${value}: ${NAMES[prizeOf(value)]}`;
    }
    return base.moveText(s, move, info, scheme);
  },

  // Each player's bag, the mover's lit while drawing, and the die when
  // this turn's marble was white.
  chanceView(s) {
    const live = s.winner === null;
    const panels = [WHITE, BLACK].map((p) => ({
      ...bagPanel(s.bags[p], { title: `${PLAYERS[p].name}'s bag`, active: live && s.phase === "draw" && !s.rolling && s.turn === p }),
      owner: p,
    }));
    if (live && (s.rolling || s.roll)) {
      panels.push(dicePanel([s.roll || null], {
        title: "Prize", owner: s.turn, active: s.rolling, result: s.roll ? NAMES[prizeOf(s.roll)] : null,
      }));
    }
    return panels;
  },

  turnHint(s) {
    if (s.winner !== null) return "";
    const name = PLAYERS[s.turn].name;
    if (s.phase === "draw") return s.rolling ? `${name} drew a white marble and rolls for a piece…` : `${name} draws a marble…`;
    const hint = base.turnHint(s);
    if (s.phase !== "move" || !s.roll) return hint;
    return `${name} won ${article(NAMES[prizeOf(s.roll)])}. ${hint}`;
  },
};

export default game;

// For tests.
export const internals = { BAG, DIE, PRIZES, prizeOf };
