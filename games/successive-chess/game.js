// Successive Chess: chess in which a turn is a run of moves, each earned by
// rolling higher than the last. Pure: no DOM. The chess comes from
// common/chess.
//
// A turn opens with a d6 ("roll:4") and a move. Then, unless the roll was
// a 6, the mover may roll again ("again") or end the turn ("stop"). Rolling
// higher than the turn's previous roll earns another move (and the choice
// again); rolling the same or lower is a bust: the mover removes one of
// their own pieces (the move [square]) and the turn ends. Removing your own
// King loses.
//
// The King is not royal: there is no check or checkmate. A player with no
// legal move when they must move (stalemate) loses. Capturing the
// opponent's King wins, but only with a roll at least the opponent's
// final roll of their last turn (a bust's roll included).
//
// Castling is as in chess: the King may not castle out of, through or into
// a square the opponent attacks.
//
// En passant is open against a double step that was the last move of the
// opponent's turn. The fifty-move rule counts single moves: 100 of them
// without a capture or pawn move draw. There is no draw by repetition.

import { rollOutcomes, rolledValue, dicePanel } from "../../common/dice.js";
import { CHANCE, pickWeighted } from "../../common/engine.js";
import { chessGame, PLAYERS, PROMOTE } from "../../common/chess/game.js";
import { KING, QUEEN, ROOK, BISHOP, KNIGHT, pawn } from "../../common/chess/movement.js";
import {
  WHITE, BLACK, other, legalMoves, pseudoMoves, attacked, playMove, promotePending, notation, material, ownerOf, typeOf,
} from "../../common/chess/rules.js";

const SIDES = 6;
const FIFTY = 100;   // single moves without a capture or pawn move
const AGAIN = "again", STOP = "stop";

const RULES = {
  types: [
    { key: "P", name: "Pawn", letter: "", image: "P", value: 1, moves: pawn(), pawn: true, promote: ["Q", "R", "B", "N"] },
    { key: "N", name: "Knight", letter: "N", image: "N", value: 3, moves: KNIGHT },
    { key: "B", name: "Bishop", letter: "B", image: "B", value: 3, moves: BISHOP },
    { key: "R", name: "Rook", letter: "R", image: "R", value: 5, moves: ROOK, castler: true },
    { key: "Q", name: "Queen", letter: "Q", image: "Q", value: 9, moves: QUEEN },
    // "royal" only marks the King for castling and capture: check is off.
    { key: "K", name: "King", letter: "K", image: "K", value: 0, moves: KING, royal: true },
  ],
  castling: [
    { name: "O-O", king: "e1", rook: "h1", kingTo: "g1", rookTo: "f1" },
    { name: "O-O-O", king: "e1", rook: "a1", kingTo: "c1", rookTo: "d1" },
  ],
  check: false,
};

// Playouts: short runs of greedy captures and otherwise random moves that
// avoid attacked squares, then adjudicated on material and mobility (see
// playout). Mutable for tuning experiments.
export const tuning = { moves: 16, mobility: 0.1, scale: 2, rescue: 0.9 };

const base = chessGame({
  id: "successive-chess",
  title: "Successive Chess",
  url: import.meta.url,
  rules: () => RULES,
  setup: () => [
    ["R", "N", "B", "Q", "K", "B", "N", "R"],
    Array(8).fill("P"),
  ],
  fiftyMoves: FIFTY,
  reasons: {
    royal: (loser) => `${loser}'s King was captured.`,
    removed: (loser) => `${loser} removed their own King.`,
    fifty: () => `${FIFTY} moves without a capture or pawn move.`,
  },
});

const typesOf = (s) => s.board.chess.types;
const isKing = (s, x) => x && typesOf(s)[typeOf(x)].royal;
const lastOf = (a) => a[a.length - 1];

// ---- turn flow ----
//
// Phases: "roll" (chance: the mover's die), "move", "promote", "decide"
// (roll again or stop), "remove" (after a bust).

// Castling as in chess, though there is no check: not from, across or
// onto an attacked square.
function castleSafe(s, move, { castle }) {
  if (!castle) return true;
  const enemy = other(s.turn);
  if (castle.pass.some((sq) => attacked(s, sq, enemy))) return false;   // pass includes the start
  const after = base.clone(s);
  playMove(after, move);
  return !attacked(after, castle.kingTo, enemy);
}

// The roll needed to capture the opponent's King: their final roll of
// their last turn (0 before they have had one).
const kingGuard = (s) => lastOf(s.rolls[other(s.turn)]) || 0;

// Whether the mover attacks the opponent's King but rolled too low to take it.
function kingBarred(s) {
  if (s.die >= kingGuard(s)) return false;
  const king = s.cells.findIndex((x) => isKing(s, x) && ownerOf(x) !== s.turn);
  return king >= 0 && attacked(s, king, s.turn);
}

function startMoves(s) {
  s.phase = "move";
  const moves = legalMoves(s, s.turn, castleSafe);
  s.moves = s.die >= kingGuard(s) ? moves : moves.filter((m) => !isKing(s, s.cells[m[1]]));
  s.guarded = s.moves.length < moves.length;   // a King capture was barred
  if (!s.moves.length) {   // stalemate loses
    s.moves = null;
    s.winner = other(s.turn);
    s.reason = "stalemate";
  }
}

// After a move (and its promotion): the choice to roll again, unless the
// roll was a 6, which nothing can beat.
function afterMove(s) {
  s.moves = null;
  if (s.die === SIDES) endTurn(s);
  else s.phase = "decide";
}

function endTurn(s) {
  s.ep = s.epNext;
  s.epNext = -1;
  s.moves = null;
  s.die = 0;
  s.turn = other(s.turn);
  s.phase = "roll";
  if (s.clock >= FIFTY) {
    s.winner = 0;
    s.reason = "fifty";
  }
}

// Play a move on the board. En passant belongs to the opponent only, so
// the double step's square is kept aside (s.epNext) until the turn ends.
function play(s, move) {
  const info = playMove(s, move);
  s.epNext = s.ep;
  s.ep = -1;
  return info;
}

function remove(s, sq) {
  const x = s.cells[sq], r = s.board.chess;
  s.cells[sq] = 0;
  s.last = [sq];
  for (const def of r.castling) if (def.king === sq || def.rook === sq) s.castling &= ~def.bit;
  // The pawn that just double-stepped is gone: nothing to take en passant.
  if (s.epNext >= 0 && sq === s.board.at(r.col[s.epNext], r.row[s.epNext] + (s.turn === WHITE ? 1 : -1))) s.epNext = -1;
  if (isKing(s, x)) {
    s.royal[s.turn] = -1;
    s.winner = other(s.turn);
    s.reason = "removed";
    return;
  }
  endTurn(s);
}

const busts = (s, value) => s.die > 0 && value <= s.die;

function applyMove(s, move) {
  switch (s.phase) {
    case "roll": {
      const value = rolledValue(move);
      // s.rolls is replaced, never changed, so clones may share it.
      s.rolls = s.rolls.slice();
      if (!s.die) {   // the turn's first roll
        s.rolls[s.turn] = [];
      }
      s.rolls[s.turn] = [...s.rolls[s.turn], value];
      if (busts(s, value)) {
        s.phase = "remove";
        s.moves = ownPieces(s);
        return null;
      }
      s.die = value;
      startMoves(s);
      return null;
    }
    case "move": {
      const info = play(s, move);
      if (info.captured && isKing(s, info.captured)) {
        s.moves = null;
        s.pending = -1;   // a pawn taking the King on the last rank needn't promote
        s.winner = s.turn;
        s.reason = "royal";
        return info;
      }
      if (info.promote) s.phase = "promote";
      else afterMove(s);
      return info;
    }
    case "promote":
      promotePending(s, move.slice(PROMOTE.length));
      afterMove(s);
      return null;
    case "decide":
      if (move === AGAIN) s.phase = "roll";
      else endTurn(s);
      s.moves = null;
      return null;
    case "remove":
      s.moves = null;
      remove(s, move[0]);
      return null;
  }
  throw new Error(`no move expected in phase ${s.phase}`);
}

function ownPieces(s) {
  const out = [];
  s.cells.forEach((x, sq) => { if (x && ownerOf(x) === s.turn) out.push([sq]); });
  return out;
}

const promotions = (s) => typesOf(s)[typeOf(s.cells[s.pending])].promote.map((k) => PROMOTE + k);

function legal(s) {
  if (s.winner !== null) return [];
  switch (s.phase) {
    case "roll": return rollOutcomes(SIDES).map((o) => o.move);
    case "move":
    case "remove": return s.moves;
    case "promote": return promotions(s);
    case "decide": return [AGAIN, STOP];
  }
  return [];
}

// ---- playouts ----

// The King's capture if any; else the capture gaining
// the most (victim less the mover, if the square is attacked), if any
// gains; else, often, the most valuable piece in danger (attacked and
// undefended, or a Rook or more attacked at all) to a safe square; else a
// random move, preferring one to a square not attacked.
function playoutMove(s, rng) {
  const types = typesOf(s), me = s.turn, enemy = other(me);
  const value = (sq) => types[typeOf(s.cells[sq])].value || 0;
  let best = 0, bestMoves = null;
  for (const m of s.moves) {
    const x = s.cells[m[1]];
    if (!x || ownerOf(x) === me) continue;
    let gain;
    if (types[typeOf(x)].royal) gain = 1000;
    else {
      gain = types[typeOf(x)].value;
      if (attacked(s, m[1], enemy)) gain -= types[typeOf(s.cells[m[0]])].royal ? 100 : value(m[0]);
    }
    if (gain > best) { best = gain; bestMoves = [m]; } else if (gain === best && bestMoves) bestMoves.push(m);
  }
  if (bestMoves) return bestMoves[Math.floor(rng() * bestMoves.length)];

  if (rng() < tuning.rescue) {
    let danger = -1, worth = 0;
    for (let sq = 0; sq < s.cells.length; sq++) {
      const x = s.cells[sq];
      if (!x || ownerOf(x) !== me) continue;
      const v = types[typeOf(x)].royal ? 50 : value(sq);
      if (v <= worth || !attacked(s, sq, enemy)) continue;
      if (v < 5 && attacked(s, sq, me)) continue;   // defended
      danger = sq;
      worth = v;
    }
    if (danger >= 0) {
      const away = s.moves.filter((m) => m[0] === danger && !attacked(s, m[1], enemy));
      if (away.length) return away[Math.floor(rng() * away.length)];
    }
  }

  let move;
  for (let tries = 0; tries < 4; tries++) {
    move = s.moves[Math.floor(rng() * s.moves.length)];
    if (!attacked(s, move[1], enemy)) break;
  }
  return move;
}

// The cheapest piece other than the King (the King if nothing else is left).
function playoutRemoval(s, rng) {
  const types = typesOf(s);
  let best = Infinity, bestMoves = [];
  for (const m of s.moves) {
    const t = types[typeOf(s.cells[m[0]])];
    const val = t.royal ? Infinity : t.value;
    if (val < best) { best = val; bestMoves = [m]; } else if (val === best) bestMoves.push(m);
  }
  return bestMoves[Math.floor(rng() * bestMoves.length)];
}

function playout(s, rng) {
  for (let moves = 0; s.winner === null; ) {
    switch (s.phase) {
      case "roll":
        applyMove(s, pickWeighted(rollOutcomes(SIDES), rng));
        continue;
      case "promote": {
        const options = promotions(s);
        applyMove(s, rng() < 0.6 ? options[0] : options[Math.floor(rng() * options.length)]);
        continue;
      }
      case "decide":
        // Roll again about as often as it would succeed, and always when
        // the King is there to take but the roll is too low.
        applyMove(s, rng() * SIDES < SIDES - s.die || kingBarred(s) ? AGAIN : STOP);
        continue;
      case "remove":
        applyMove(s, playoutRemoval(s, rng));
        continue;
    }
    if (moves++ >= tuning.moves) {
      const me = s.turn, you = other(me);
      const d = material(s, me) - material(s, you) +
        tuning.mobility * (pseudoMoves(s, me).length - pseudoMoves(s, you).length);
      s.winner = rng() < 1 / (1 + Math.exp(-d / tuning.scale)) ? me : you;
      s.reason = "adjudicated";
      break;
    }
    applyMove(s, playoutMove(s, rng));
  }
  return s.winner;
}

// Whether to roll again, for the AI: MCTS judges it badly, as after
// rolling the mover's next move is a decision in its tree, whose
// exploration of poor moves drags the value down, but after stopping the
// opponent's is (see ARCHITECTURE.md, "AI"). Instead, alternate playouts
// after each choice for the time allowed and take the better.
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function aiMove(s, { timeMs = 1000, iterations = Infinity, rng = Math.random } = {}) {
  if (s.phase !== "decide") return null;
  const choices = [AGAIN, STOP], wins = [0, 0], runs = [0, 0];
  const deadline = now() + Math.max(0, timeMs);
  for (let n = 0; n < 2 || (n < 2 * iterations && now() < deadline); n++) {
    const i = n % 2, t = base.clone(s);
    applyMove(t, choices[i]);
    const winner = playout(t, rng);
    wins[i] += winner === s.turn ? 1 : winner === 0 ? 0.5 : 0;
    runs[i]++;
  }
  return wins[0] / runs[0] > wins[1] / runs[1] ? AGAIN : STOP;
}

// ---- the game ----

const game = {
  ...base,
  moveLabels: { [AGAIN]: "Roll again", [STOP]: "End turn" },
  moveLabel: (s, move) => (move === AGAIN || move === STOP ? null : base.moveLabel(s, move)),

  initialState(board, opts) {
    const s = base.initialState(board, opts);
    s.phase = "roll";
    s.moves = null;
    s.die = 0;          // the turn's current roll (0 before the first)
    s.rolls = [null, [], []];   // each player's rolls in their latest turn
    s.epNext = -1;      // en passant square for the opponent, once the turn ends
    s.guarded = false;  // whether the roll was too low to take the King
    return s;
  },
  refresh(s) {
    s.winner = null;
    s.reason = null;
    s.phase = "roll";
    s.die = 0;
    s.moves = null;
    return s;
  },

  toMove: (s) => (s.phase === "roll" ? CHANCE : s.turn),
  currentPlayer: (s) => s.turn,
  chances: () => rollOutcomes(SIDES),
  legalMoves: legal,
  applyMove,
  playout,
  aiMove,

  moveText(s, move, info, scheme) {
    switch (s.phase) {
      case "roll": {
        const value = rolledValue(move);
        return busts(s, value) ? `rolled ${value}: bust` : `rolled ${value}`;
      }
      case "decide": return "";   // left out: the next roll, or the next turn, shows it
      case "remove": {
        const x = s.cells[move[0]];
        return `removed ${typesOf(s)[typeOf(x)].name} ${s.board.cells[move[0]].tags.name}`;
      }
      case "promote": return "=" + typesOf(s)[s.board.chess.byKey[move.slice(PROMOTE.length)]].letter;
      case "move": return notation(s, move, s.moves || []);
    }
    return null;
  },

  // Each player's rolls in their latest turn, the mover's lit while rolling.
  chanceView(s) {
    const live = s.winner === null;
    return [WHITE, BLACK].map((p) => {
      const rolls = s.rolls[p];
      const rolling = live && s.turn === p && s.phase === "roll";
      // A new turn's first roll clears the last turn's.
      const dice = rolling ? (s.die ? [...rolls, null] : [null]) : rolls.length ? rolls : [null];
      const bust = !(rolling && !s.die) && rolls.length > 1 && lastOf(rolls) <= rolls[rolls.length - 2];
      return dicePanel(dice, { title: `${PLAYERS[p].name}'s rolls`, owner: p, active: rolling, result: bust ? "Bust" : null });
    });
  },

  turnHint(s, scheme) {
    if (s.winner !== null) return "";
    const name = PLAYERS[s.turn].name;
    const countdown = s.clock >= FIFTY - 20 ? ` Draw after ${FIFTY - s.clock} more moves without a capture or pawn move.` : "";
    switch (s.phase) {
      case "roll": return s.die ? `${name} rolls again, needing more than ${s.die}…` : `${name} rolls…`;
      case "move": {
        const guard = s.guarded ? ` ${PLAYERS[other(s.turn)].name}'s King can't be taken on a roll below ${kingGuard(s)}.` : "";
        return `${name} rolled ${s.die}: move a piece.${guard}${countdown}`;
      }
      case "promote": return `${name}: choose a piece to promote to.`;
      case "decide": return `${name}: roll again (more than ${s.die} for another move, else lose a piece) or end the turn.`;
      case "remove": return `${name} rolled ${lastOf(s.rolls[s.turn])}, not more than ${s.die}: remove one of your pieces.`;
    }
    return "";
  },
};

export default game;

// For tests.
export const internals = { SIDES, FIFTY, AGAIN, STOP };
