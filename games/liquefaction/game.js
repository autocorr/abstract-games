// Liquefaction: chess without Queens on a board shaded in four colours, from
// Bag of Tricks. Each turn the player draws a marble; squares of the drawn
// colour are "colour-checked" for their King, which may not stand on one
// after the move. Pure: no DOM. The chess itself comes from common/chess.
//
// The four colours are the sub-grids a Dabbaba (2,0 leaper) moves within,
// named by letter (square.js's `quad` tag): A = odd file, odd rank (a1,
// dark), B = even file, odd rank (b1, light), C = odd file, even rank (a2,
// light), D = even file, even rank (b2, dark). Colour schemes map letters to
// fills and names; rules only see letters.
//
// A turn is a chance ply ("draw:A") followed by the player's move [from, to],
// and for a promotion a further choice ("promote:N"). The drawn marble goes
// back to the supply, and a marble matching the moved piece's landing square
// (the King's for castling) goes into the bag, so the bag always holds 5 at
// the start of a turn. With the random-bag option, the game opens with 5
// chance plies ("fill:A") filling the bag from the supply of 5 per colour.
//
// A move is legal if afterwards the mover's King is not attacked and does not
// stand on the drawn colour. A player with no legal move after their draw
// loses (checkmate, "colour-mate" or stalemate alike). Castling (8x8 only) is
// not allowed while colour-checked, may pass through the drawn colour but not
// land on it, and otherwise follows chess. 100 plies by the players without a
// capture or pawn move is a draw. See docs/bag-of-tricks/rules.md.

import { squareBoard } from "../../common/board/square.js";
import { makeBag, cloneBag, drawOutcomes, drawMarble, addMarbles, bagSize, bagPanel } from "../../common/bag.js";
import { chessGame, fiftyHint, PLAYERS } from "../../common/chess/game.js";
import { KING, ROOK, BISHOP, KNIGHT, pawn } from "../../common/chess/movement.js";
import { WHITE, BLACK, other, inCheck, pieceCode } from "../../common/chess/rules.js";

const FILL = "fill:";
const CLASSES = ["A", "B", "C", "D"];
const PER_COLOUR = 5;   // supply: 5 marbles of each colour
const BAG_SIZE = 5;
const DRAWN_SHOWN = 12;   // drawn history kept for display

// Colour schemes; the first (colour-blind safe) is the default. Within each, the dark pair (A, D) shares one OKLCH
// lightness (0.66) and the light pair (B, C) another (0.88), so the board
// reads as a checkerboard.
const SCHEMES = {
  colorblind: {
    name: "Color-blind safe",
    colours: { A: ["Orange", "#d77343"], B: ["Yellow", "#f9d460"], C: ["Sky", "#aedffd"], D: ["Blue", "#6293db"] },
  },
  classic: {
    name: "Classic",
    colours: { A: ["Red", "#db6c66"], B: ["Yellow", "#f9d460"], C: ["Green", "#8ef29e"], D: ["Blue", "#5d94da"] },
  },
  booklet: {
    name: "Cyan and magenta",
    colours: { A: ["Purple", "#b576c3"], B: ["Pink", "#ffc4de"], C: ["Cyan", "#8ce9f4"], D: ["Teal", "#31a5a5"] },
  },
};
const colorSchemes = Object.fromEntries(Object.entries(SCHEMES).map(([key, { name, colours }]) => [key, {
  name,
  cellFill: (cell) => colours[CLASSES[cell.tags.quad]][1],
  marbles: Object.fromEntries(CLASSES.map((c) => [c, { name: colours[c][0], fill: colours[c][1] }])),
}]));
const DEFAULT_SCHEME = colorSchemes.colorblind;

// Fixed starting bags: each King's starting colour appears once.
const FIXED_BAGS = {
  6: { A: 2, B: 1, C: 1, D: 1 },   // Kings on d1 (B) and d6 (D)
  8: { A: 1, B: 2, C: 1, D: 1 },   // Kings on e1 (A) and e8 (C)
};

const BACK_RANKS = { 6: "NB.KBN", 8: "RNB.KBNR" };

// Pieces: chess without the Queen; pawns promote to N, B or R. On 6x6 there
// is no double step (so no en passant) and no castling.
function rules(size) {
  const big = size === 8;
  return {
    types: [
      { key: "P", name: "Pawn", letter: "", image: "P", value: 1, moves: pawn({ double: big }), pawn: true, promote: ["N", "B", "R"] },
      { key: "N", name: "Knight", letter: "N", image: "N", value: 3, moves: KNIGHT },
      { key: "B", name: "Bishop", letter: "B", image: "B", value: 3, moves: BISHOP },
      { key: "R", name: "Rook", letter: "R", image: "R", value: 5, moves: ROOK, castler: true },
      { key: "K", name: "King", letter: "K", image: "K", value: 0, moves: KING, royal: true },
    ],
    castling: big ? [
      { name: "O-O", king: "e1", rook: "h1", kingTo: "g1", rookTo: "f1" },
      { name: "O-O-O", king: "e1", rook: "a1", kingTo: "c1", rookTo: "d1" },
    ] : [],
    stalemate: "loss",
  };
}

const cls = (s, sq) => CLASSES[s.board.cells[sq].tags.quad];

const base = chessGame({
  id: "liquefaction",
  title: "Liquefaction",
  url: import.meta.url,
  options: {
    size: { label: "Board", choices: [{ value: 6, label: "6×6" }, { value: 8, label: "8×8" }], default: 6 },
    bag: { label: "Starting bag", choices: [{ value: "fixed", label: "Fixed" }, { value: "random", label: "Random" }], default: "fixed" },
  },
  colorSchemes,
  lastMove: "outline",   // a green tint would muddy the four square colours
  board: ({ size }) => squareBoard({ cols: size, grid: false }),
  boardKey: (o) => o.size,
  rules: ({ size }) => rules(size),
  setup({ size }) {
    const back = [...BACK_RANKS[size]].map((c) => (c === "." ? null : c));
    return [back, Array(size).fill("P")];
  },
  init(s, opts) {
    s.bag = makeBag(opts.bag === "random" ? { A: 0, B: 0, C: 0, D: 0 } : FIXED_BAGS[s.board.cols]);
    s.colour = null;   // the colour drawn this turn
  },
  clone(copy) {
    copy.bag = cloneBag(copy.bag);
  },
  setupPly: {
    chances(s) {
      const left = CLASSES.length * PER_COLOUR - bagSize(s.bag);
      return CLASSES.map((c) => ({ move: FILL + c, p: (PER_COLOUR - s.bag.counts[c]) / left })).filter((o) => o.p > 0);
    },
    apply(s, move) { addMarbles(s.bag, move.slice(FILL.length)); },
    done: (s) => bagSize(s.bag) === BAG_SIZE,
  },
  drawPly: {
    chances: (s) => drawOutcomes(s.bag),
    apply(s, move) {
      s.colour = drawMarble(s.bag, move);
      if (s.bag.drawn.length > DRAWN_SHOWN) s.bag.drawn.splice(0, s.bag.drawn.length - DRAWN_SHOWN);
    },
  },
  // A colour-checked King must move (and so may not castle), and no King
  // may end on the drawn colour.
  allow(s, [from], { royalTo, castle }) {
    const checked = cls(s, s.royal[s.turn]) === s.colour;
    if (checked && (from !== s.royal[s.turn] || castle)) return false;
    return cls(s, royalTo) !== s.colour;
  },
  afterMove(s, landing) {
    addMarbles(s.bag, cls(s, landing));
    s.colour = null;
  },
  noMoves(s) {
    const reason = inCheck(s, s.turn) ? "checkmate" : cls(s, s.royal[s.turn]) === s.colour ? "colourmate" : "stalemate";
    return { winner: other(s.turn), reason };
  },
  // The drawn colour's squares are hatched until the move is made.
  markers(s) {
    if (s.winner !== null || !s.colour) return [];
    const out = [];
    for (let id = 0; id < s.cells.length; id++) if (cls(s, id) === s.colour) out.push({ id, kind: "shade" });
    return out;
  },
  reasons: {
    colourmate: (loser) => `${loser}'s King cannot leave the drawn color.`,
  },
});

const game = {
  ...base,
  marbles: DEFAULT_SCHEME.marbles,

  // Setup draws read "added orange"; draws use the default ("drew orange").
  moveText(s, move, info, scheme) {
    if (typeof move === "string" && move.startsWith(FILL)) {
      const marbles = (scheme && scheme.marbles) || DEFAULT_SCHEME.marbles;
      return `added ${marbles[move.slice(FILL.length)].name.toLowerCase()}`;
    }
    return base.moveText(s, move, info, scheme);
  },

  chanceView(s) {
    return [bagPanel(s.bag, {
      title: s.phase === "setup" ? "Bag (filling)" : "Bag",
      active: s.winner === null && (s.phase === "draw" || s.phase === "setup"),
    })];
  },

  turnHint(s, scheme) {
    if (s.winner !== null) return "";
    const marbles = (scheme && scheme.marbles) || DEFAULT_SCHEME.marbles;
    const name = PLAYERS[s.turn].name;
    if (s.phase === "setup") return "Filling the bag with 5 random marbles…";
    if (s.phase === "draw") return `${name} draws a marble…`;
    if (s.phase === "promote") return `${name}: choose a piece to promote to.`;
    const colour = marbles[s.colour].name.toLowerCase();
    const parts = [`${name} drew ${colour}.`];
    if (inCheck(s, s.turn)) parts.push("Check!");
    parts.push(cls(s, s.royal[s.turn]) === s.colour
      ? `The King must leave its ${colour} square.`
      : `The King may not move onto ${colour}.`);
    const countdown = fiftyHint(s);
    if (countdown) parts.push(countdown);
    return parts.join(" ");
  },
};

export default game;

// For tests.
export const internals = { CLASSES, FIXED_BAGS, pieceCode, WHITE, BLACK };
