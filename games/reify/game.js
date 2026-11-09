// Reify: chess in which every piece but the pawns has two sides, concrete
// and abstract. Both sides move and capture as the chess piece does; a piece
// turns over every time it lands (castling turns over both the King and the
// Rook). Every piece starts concrete. You must always keep at least one
// concrete piece on the board: a move that would turn over your last one is
// not allowed, and a player whose last concrete piece is captured loses at
// once. Pawns have one side and do not count; they promote to a concrete
// piece. The King is royal on either side (check and checkmate as in chess)
// and counts as a concrete piece while it is concrete. Stalemate loses; 50
// moves each without a capture or pawn move, or a position occurring three
// times, draws. Pure: no DOM; the chess comes from common/chess.
//
// Concrete pieces are drawn in a dark shade of their player's color,
// abstract pieces and pawns in a light shade. The color schemes are palettes
// of player colors, on a neutral board, and name the players.

import { chessGame } from "../../common/chess/game.js";
import { KING, QUEEN, ROOK, BISHOP, KNIGHT, pawn } from "../../common/chess/movement.js";
import { WHITE, BLACK, other, ownerOf, typeOf, turnedOver } from "../../common/chess/rules.js";
import { CONCRETE, ABSTRACT } from "./cburnett.js";

// Two-sided pieces: [letter, name, value, moves, flags].
const PIECES = [
  ["K", "King", 0, KING, { royal: true }],
  ["Q", "Queen", 9, QUEEN, {}],
  ["R", "Rook", 5, ROOK, { castler: true }],
  ["B", "Bishop", 3, BISHOP, {}],
  ["N", "Knight", 3, KNIGHT, {}],
];
// Type keys: "Q" a concrete Queen, "Q~" an abstract one.
const ABSTRACT_MARK = "~";

const RULES = {
  types: [
    { key: "P", name: "Pawn", letter: "", image: "P", value: 1, moves: pawn(), pawn: true, promote: ["Q", "R", "B", "N"] },
    ...PIECES.flatMap(([letter, name, value, moves, flags]) => [
      { key: letter, name, letter, image: letter, value, moves, ...flags, concrete: true, becomes: letter + ABSTRACT_MARK },
      { key: letter + ABSTRACT_MARK, name, letter, image: letter, value, moves, ...flags, becomes: letter },
    ]),
  ],
  castling: [
    { name: "O-O", king: "e1", rook: "h1", kingTo: "g1", rookTo: "f1" },
    { name: "O-O-O", king: "e1", rook: "a1", kingTo: "c1", rookTo: "d1" },
  ],
  stalemate: "loss",
};

// Palettes: the first player's color, then the second's, each a dark
// (concrete) and light (abstract) shade. The first is the default.
const PALETTES = {
  okabeIto: ["Okabe-Ito Vermilion & Blue", ["Vermilion", "#d55e00", "#f7c09a"], ["Blue", "#0072b2", "#a6d3f0"]],
  teal: ["Vermilion & Teal", ["Vermilion", "#b8360f", "#f5a58a"], ["Teal", "#0b6466", "#86d2cd"]],
  okabeItoPure: ["Okabe-Ito Pure", ["Vermilion", "#d55e00", "#e69f00"], ["Blue", "#0072b2", "#56b4e9"]],
  greenPurple: ["Okabe-Ito Green & Purple", ["Green", "#007a59", "#8fd9c0"], ["Purple", "#9c4a7a", "#ecbcd6"]],
  amberIndigo: ["Amber & Indigo", ["Amber", "#a86400", "#f6cf7f"], ["Indigo", "#33388f", "#b6b9ee"]],
  crimsonSlate: ["Crimson & Slate", ["Crimson", "#9e1b32", "#eba3ae"], ["Slate", "#3a4a5c", "#b9c6d4"]],
};
const BOARD = ["#e4e1da", "#a8a49c"];   // a neutral "stone" board: [light, dark]
const INK = "#141414";

// A piece image in `shades` ({ dark, light }) as a data URL.
function pieceSvg(letter, concrete, { dark, light }) {
  const svg = concrete
    ? CONCRETE[letter]
      .replace(/stroke(:|=")#000(000)?/g, `stroke$1${INK}`)
      .replace(/fill(:|=")#000(000)?/g, `fill$1${dark}`)
      .replace(/#fff(fff)?/g, light)
    : ABSTRACT[letter].replace(/#000(000)?/g, INK).replace(/#fff(fff)?/g, light);
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

export const COLOR_SCHEMES = Object.fromEntries(Object.entries(PALETTES).map(([key, [name, ...sides]]) => {
  const players = {}, images = {};
  sides.forEach(([player, dark, light], i) => {
    const p = i + 1;
    players[p] = { name: player, fill: dark, mark: "#ffffff" };
    images[p] = {};
    for (const [letter] of PIECES) {
      images[p][letter] = pieceSvg(letter, true, { dark, light });
      images[p][letter + ABSTRACT_MARK] = pieceSvg(letter, false, { dark, light });
    }
    images[p].P = pieceSvg("P", false, { dark, light });
  });
  return [key, { name, players, images, cellFill: (cell) => BOARD[cell.tags.dark ? 1 : 0] }];
}));
const DEFAULT_SCHEME = Object.values(COLOR_SCHEMES)[0];

const isConcrete = (s, x) => Boolean(s.board.chess.types[typeOf(x)].concrete);

// How many concrete pieces `player` has on the board.
export function concreteCount(s, player) {
  let n = 0;
  for (const x of s.cells) if (x && ownerOf(x) === player && isConcrete(s, x)) n++;
  return n;
}

// The change in the mover's concrete count from turning over the piece x.
const flipDelta = (s, x) => {
  const r = s.board.chess;
  if (turnedOver(r, x) === x) return 0;   // pawns
  return isConcrete(s, x) ? -1 : 1;
};

const base = chessGame({
  id: "reify",
  title: "Reify",
  url: import.meta.url,
  players: DEFAULT_SCHEME.players,
  colorSchemes: COLOR_SCHEMES,
  rules: () => RULES,
  setup: () => [
    ["R", "N", "B", "Q", "K", "B", "N", "R"],
    Array(8).fill("P"),
  ],
  repetition: 3,
  // No move may turn over the mover's last concrete piece.
  allow(s, [from], { castle }) {
    const player = ownerOf(s.cells[from]);
    let delta = flipDelta(s, s.cells[from]);
    if (castle) delta += flipDelta(s, s.cells[castle.rook]);
    return delta >= 0 || concreteCount(s, player) + delta > 0;
  },
  // Capturing the opponent's last concrete piece wins.
  afterMove(s) {
    return concreteCount(s, other(s.turn)) ? null : { winner: s.turn, reason: "abstract" };
  },
  reasons: {
    abstract: (loser) => `${loser} has no concrete piece left.`,
  },
});

const named = (scheme) => (scheme || DEFAULT_SCHEME).players;

const game = {
  ...base,

  piecesOf(s, style, scheme) {
    const images = (scheme || DEFAULT_SCHEME).images, types = s.board.chess.types, out = [];
    for (let id = 0; id < s.cells.length; id++) {
      const x = s.cells[id];
      if (x) out.push({ id, player: ownerOf(x), image: images[ownerOf(x)][types[typeOf(x)].key] });
    }
    return out;
  },

  // The chess status, and a warning when the mover is down to one concrete
  // piece.
  turnHint(s, scheme) {
    const hint = base.turnHint(s, scheme);
    if (!hint || s.phase !== "move" || concreteCount(s, s.turn) !== 1) return hint;
    return `${hint} Only one concrete piece left: it may not turn over.`;
  },

  scoreSummary(s, player, scheme) {
    const name = named(scheme)[player].name, n = concreteCount(s, player);
    return { sub: `${n} concrete`, title: `${name}: ${n} concrete ${n === 1 ? "piece" : "pieces"}` };
  },
};

export default game;

// For tests.
export const internals = { ABSTRACT_MARK, PALETTES };
export { WHITE, BLACK };
