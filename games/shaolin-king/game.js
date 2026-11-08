// Shaolin King: chess in which each King is a Shaolin Master, a two-faced
// piece that turns over every time it moves. Upright (as dealt) it moves as
// a Queen; turned over it moves as a Cannon along Queen lines: it hops
// exactly one piece of either colour, at any distance along the line, then
// moves to any empty square beyond it or captures the first piece beyond it
// if that is an enemy. With nothing to hop it cannot move. Pure: no DOM; the
// chess comes from common/chess.
//
// The Master is royal: check and checkmate apply to it whichever face is up,
// and each Master attacks by its own face, so one Master may check or mate
// the other, and two Masters may stand side by side when neither face
// attacks the other's square. Castling follows chess (the Master and Rook
// unmoved, the squares between empty, not out of, through or into check); it
// counts as the Master's move, so it turns the Master over. Because an
// upright Master could also move two squares along the rank, castling is
// entered as the Master's move onto its own Rook ([e1, h1]). Stalemate is a
// draw, as is 50 moves each without a capture or pawn move.
//
// Setup options give each side a pair of faces: Queen / Cannon (the Shaolin
// Master), King / Queen, King / Knight, King / Nightrider or Rook / Bishop.
// With random Masters the game opens with chance plies ("master:kn"), one
// for both sides (symmetric) or one each, White's first (asymmetric); until
// then the Masters are unassigned.

import { chessGame, PLAYERS } from "../../common/chess/game.js";
import { KING, QUEEN, ROOK, BISHOP, KNIGHT, NIGHTRIDER, QUEEN_CANNON, pawn } from "../../common/chess/movement.js";
import { WHITE, BLACK, pieceCode, typeOf } from "../../common/chess/rules.js";

// Movements a Master's face may have: [name, label, atoms].
const MOVERS = {
  K: ["King", "K", KING],
  Q: ["Queen", "Q", QUEEN],
  C: ["Cannon", "C", QUEEN_CANNON],
  N: ["Knight", "N", KNIGHT],
  NN: ["Nightrider", "NN", NIGHTRIDER],
  R: ["Rook", "R", ROOK],
  B: ["Bishop", "B", BISHOP],
};

// Master pairs: the upright face first.
export const PAIRS = {
  shaolin: ["Q", "C"],
  kq: ["K", "Q"],
  kn: ["K", "N"],
  knr: ["K", "NN"],
  rb: ["R", "B"],
};
const PAIR_KEYS = Object.keys(PAIRS);
const pairName = (key) => PAIRS[key].map((m) => MOVERS[m][0]).join(" / ");

const MASTER = "master:";
const UNASSIGNED = "M?";
const faceKey = (pair, face) => `M:${pair}:${face}`;

const masterTypes = PAIR_KEYS.flatMap((pair) => PAIRS[pair].map((m, face) => ({
  key: faceKey(pair, face),
  name: "Master",
  letter: "K",
  image: "K",
  rotate: face ? 180 : 0,
  label: MOVERS[m][1],
  moves: MOVERS[m][2],
  mover: MOVERS[m][0],
  royal: true,
  becomes: faceKey(pair, 1 - face),
})));

const RULES = {
  types: [
    { key: "P", name: "Pawn", letter: "", image: "P", value: 1, moves: pawn(), pawn: true, promote: ["Q", "R", "B", "N"] },
    { key: "N", name: "Knight", letter: "N", image: "N", value: 3, moves: KNIGHT },
    { key: "B", name: "Bishop", letter: "B", image: "B", value: 3, moves: BISHOP },
    { key: "R", name: "Rook", letter: "R", image: "R", value: 5, moves: ROOK, castler: true },
    { key: "Q", name: "Queen", letter: "Q", image: "Q", value: 9, moves: QUEEN },
    ...masterTypes,
    // A Master not yet dealt (random Masters, before the draw).
    { key: UNASSIGNED, name: "Master", letter: "K", image: "K", label: "?", moves: [], royal: true },
  ],
  castling: [
    { name: "O-O", king: "e1", rook: "h1", kingTo: "g1", rookTo: "f1" },
    { name: "O-O-O", king: "e1", rook: "a1", kingTo: "c1", rookTo: "d1" },
  ],
  castleMove: "rook",
};

const pairChoices = PAIR_KEYS.map((value) => ({ value, label: pairName(value) }));
const fixedOnly = (opts) => opts.random !== "off";

// Deal `pair` to `player`'s unassigned Master.
function deal(s, player, pair) {
  const sq = s.royal[player];
  s.cells[sq] = pieceCode(s.board.chess.byKey[faceKey(pair, 0)], player);
  s.pairs[player] = pair;
}

const typeAt = (s, sq) => s.board.chess.types[typeOf(s.cells[sq])];
// The movement name of `player`'s Master now (null before it is dealt).
const masterMover = (s, player) => (s.royal[player] < 0 ? null : typeAt(s, s.royal[player]).mover || null);
// Whose Master the next random draw is for.
const nextDeal = (s) => (s.pairs[WHITE] ? BLACK : WHITE);

const base = chessGame({
  id: "shaolin-king",
  title: "Shaolin King",
  url: import.meta.url,
  options: {
    white: { label: "White Master", choices: pairChoices, default: "shaolin", inactive: fixedOnly },
    black: { label: "Black Master", choices: pairChoices, default: "shaolin", inactive: fixedOnly },
    random: {
      label: "Random Masters",
      choices: [{ value: "off", label: "Off" }, { value: "same", label: "Symmetric" }, { value: "each", label: "Asymmetric" }],
      default: "off",
    },
  },
  rules: () => RULES,
  setup: () => [
    ["R", "N", "B", "Q", UNASSIGNED, "B", "N", "R"],
    Array(8).fill("P"),
  ],
  init(s, opts) {
    s.random = opts.random;
    s.pairs = [null, null, null];   // [, White's pair, Black's pair] once dealt
    if (opts.random === "off") {
      deal(s, WHITE, opts.white);
      deal(s, BLACK, opts.black);
    }
  },
  clone(copy) {
    copy.pairs = copy.pairs.slice();
  },
  setupPly: {
    chances: () => PAIR_KEYS.map((pair) => ({ move: MASTER + pair, p: 1 / PAIR_KEYS.length })),
    apply(s, move) {
      const pair = move.slice(MASTER.length);
      if (s.random === "same") {
        deal(s, WHITE, pair);
        deal(s, BLACK, pair);
      } else {
        deal(s, nextDeal(s), pair);
      }
    },
    done: (s) => Boolean(s.pairs[WHITE] && s.pairs[BLACK]),
  },
});

const game = {
  ...base,
  pieceLabels: "Master moves",
  pieceLabelsDefault: "off",

  // "Masters: King / Knight", or "White's Master: ..." when dealt one each.
  moveText(s, move, info, scheme) {
    if (typeof move === "string" && move.startsWith(MASTER)) {
      const pair = pairName(move.slice(MASTER.length));
      return s.random === "same" ? `Masters: ${pair}` : `${PLAYERS[nextDeal(s)].name}'s Master: ${pair}`;
    }
    return base.moveText(s, move, info, scheme);
  },

  moveLabel(s, move) {
    return move.startsWith(MASTER) ? pairName(move.slice(MASTER.length)) : base.moveLabels[move];
  },

  // The chess status, then how each Master moves now.
  turnHint(s) {
    if (s.winner !== null) return "";
    if (s.phase === "setup") {
      return s.random === "same" ? "Drawing the Masters at random…" : `Drawing ${PLAYERS[nextDeal(s)].name}'s Master at random…`;
    }
    const w = masterMover(s, WHITE), b = masterMover(s, BLACK);
    const faces = w === b ? `Both Masters move as ${article(w)}.`
      : `White's Master moves as ${article(w)}, Black's as ${article(b)}.`;
    return `${base.turnHint(s)} ${faces}`;
  },

  scoreSummary(s, player) {
    const summary = base.scoreSummary(s, player);
    const now = masterMover(s, player);
    if (!now) return summary;
    const pair = PAIRS[s.pairs[player]].map((m) => MOVERS[m][0]);
    const next = pair[0] === now ? pair[1] : pair[0];
    return { ...summary, sub: `${now} · next ${next}`, title: `${summary.title}; the Master moves as ${article(now)}, then ${article(next)}` };
  },
};

const article = (name) => (/^[AEIOU]/.test(name) ? "an " : "a ") + name;

export default game;

// For tests.
export const internals = { faceKey, UNASSIGNED, MASTER };
