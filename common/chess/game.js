// chessGame(variant): a whole Game (see ARCHITECTURE.md) for a chess-like
// variant, from its rules spec (rules.js) and a few hooks. Pure: no DOM.
//
// A turn is the mover's move [from, to] and, when a pawn reaches its last
// rank, a further choice ("promote:Q"). A variant may add chance plies:
// `setup` plies before the game (they belong to no player) and a `draw` ply
// before every move (Liquefaction's marble).
//
// Variant fields (besides the usual id, title, url, options, ...):
//   board(opts)          -> a square.js board (default: 8x8 chessboard)
//   boardKey(opts)       -> the options that shape the board and rules
//   rules(opts)          -> rules spec (see rules.js)
//   setup(opts)          -> White's ranks from rank 1, as type keys (see
//                           setupCells); Black mirrors them
//   init(s, opts)        add variant state to the starting position
//   clone(copy)          deepen the copy of variant state (copy is shallow)
//   setupPly:            { chances(s), apply(s, move), done(s) }
//   drawPly:             { chances(s), apply(s, move), done(s) }: chance
//                           plies before every move, until done(s) (default:
//                           one ply)
//   allow(s, move, ctx)  rules out moves (see rules.js legalMoves)
//   afterMove(s, landing) after a turn's last ply, before the next turn
//   noMoves(s)           -> { winner, reason } when the mover has no move;
//                           default: checkmate loses, stalemate per spec
//                           (spec.stalemate: "draw" (default) or "loss")
//   markers(s)           extra markers, after the last move and check
//   lastMove             how the last move's squares are marked: "tint"
//                           (default, Lichess's green) or "outline"
//   fiftyMoves           plies without capture or pawn move that draw
//                           (default 100; 0: never)
//   reasons              { reason: (loserName, s) => line } outcome lines
//
// The returned game can be spread and its methods overridden; the methods
// call each other directly, not through `this`. Besides the contract it has
// refresh(s), which starts the mover's turn on a position edited by hand.
//
// With drops in the rules spec, positions carry hands (see rules.js) and
// the game has hands(s) for the shell's hand panels: Black's above the
// board, White's below, as Lichess shows them.

import { squareBoard } from "../board/square.js";
import { CHANCE, pickWeighted, cachedBoards } from "../engine.js";
import {
  WHITE, BLACK, other, attachRules, setupCells, findRoyals, legalMoves, playMove, promotePending, inCheck,
  notation, material, ownerOf, typeOf, emptyHand, dropSlot, handCount, isDrop,
} from "./rules.js";

export const PLAYERS = {
  1: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
  2: { name: "Black", fill: "#202329", mark: "#ffffff" },
};

// Lichess board colours: [light, dark]; the first is the default.
export const BOARD_SCHEMES = Object.fromEntries(Object.entries({
  brown: { name: "Brown", colours: ["#f0d9b5", "#b58863"] },
  blue: { name: "Blue", colours: ["#dee3e6", "#8ca2ad"] },
}).map(([key, { name, colours: [light, dark] }]) => [key, { name, cellFill: (cell) => (cell.tags.dark ? dark : light) }]));

export const PROMOTE = "promote:";
const LAST_MOVE = "rgba(14, 15, 19, 0.75)";

const PIECE_URLS = Object.fromEntries([WHITE, BLACK].flatMap((p) => ["K", "Q", "R", "B", "N", "P"].map((l) => {
  const name = (p === WHITE ? "w" : "b") + l;
  return [p + l, new URL(`../pieces/cburnett/${name}.svg`, import.meta.url).href];
})));
export const pieceImage = (player, letter) => PIECE_URLS[player + letter];

// Playouts play capture-biased random moves for a limited number of moves,
// then adjudicate on material: the side ahead by d points wins with
// probability 1 / (1 + e^(-d/2)). The adjudication ends the (scratch) game.
const PLAYOUT_MOVES = 40;
const CAPTURE_BIAS = 0.75;
// Otherwise, with pieces in hand, a drop this often (drops can far outnumber
// moves, so a uniform pick would be nearly all drops).
const DROP_CHANCE = 0.3;

// The fifty-move countdown for the status line, in its last 10 moves. The
// rule counts plies; say it as moves each, like the rules do.
export function fiftyHint(s, plies = 100) {
  if (!plies) return "";
  const left = Math.ceil((plies - s.clock) / 2);
  return left <= 10 ? `Draw in ${left} ${left === 1 ? "move" : "moves"} each without a capture or pawn move.` : "";
}

export function chessGame(v) {
  const fifty = v.fiftyMoves ?? 100;
  const players = v.players || PLAYERS;
  const typesOf = (s) => s.board.chess.types;

  function startTurn(s) {
    if (v.drawPly) {
      s.phase = "draw";
      return;
    }
    startMoves(s);
  }

  // The mover's moves, or the end of the game if there are none.
  function startMoves(s) {
    s.phase = "move";
    s.moves = legalMoves(s, s.turn, v.allow ? v.allow : null);
    if (s.moves.length) return;
    const end = v.noMoves ? v.noMoves(s) : null;
    if (end) {
      s.winner = end.winner;
      s.reason = end.reason;
    } else if (inCheck(s, s.turn)) {
      s.winner = other(s.turn);
      s.reason = "checkmate";
    } else {
      s.winner = s.board.chess.stalemate === "loss" ? other(s.turn) : 0;
      s.reason = "stalemate";
    }
  }

  function endTurn(s, landing) {
    if (v.afterMove) v.afterMove(s, landing);
    s.moves = null;
    s.turn = other(s.turn);
    if (!s.board.chess.check && s.royal[s.turn] < 0) {
      s.winner = other(s.turn);
      s.reason = "royal";
      return;
    }
    if (fifty && s.clock >= fifty) {
      s.winner = 0;
      s.reason = "fifty";
      return;
    }
    startTurn(s);
  }

  function applyMove(s, move) {
    switch (s.phase) {
      case "setup":
        v.setupPly.apply(s, move);
        if (v.setupPly.done(s)) startTurn(s);
        return null;
      case "draw":
        v.drawPly.apply(s, move);
        if (!v.drawPly.done || v.drawPly.done(s)) startMoves(s);
        return null;
      case "move": {
        const info = playMove(s, move);
        if (info.promote) s.phase = "promote";
        else endTurn(s, info.landing);
        return info;
      }
      case "promote":
        endTurn(s, promotePending(s, move.slice(PROMOTE.length)));
        return null;
    }
    throw new Error(`no move expected in phase ${s.phase}`);
  }

  function chances(s) {
    return s.phase === "setup" ? v.setupPly.chances(s) : v.drawPly.chances(s);
  }

  function promotions(s) {
    return typesOf(s)[typeOf(s.cells[s.pending])].promote.map((k) => PROMOTE + k);
  }

  function legal(s) {
    if (s.winner !== null) return [];
    switch (s.phase) {
      case "setup":
      case "draw": return chances(s).map((o) => o.move);
      case "move": return s.moves;
      case "promote": return promotions(s);
    }
    return [];
  }

  function clone(s) {
    const copy = { ...s, cells: s.cells.slice(), royal: s.royal.slice() };
    if (s.hand) copy.hand = s.hand.slice();
    if (v.clone) v.clone(copy);
    return copy;
  }

  // "+" if `move` leaves the opponent in check, "#" if checkmated (not
  // until a pending promotion is chosen, nor before a draw ply).
  function checkMark(s, move) {
    const after = clone(s);
    applyMove(after, move);
    if (after.phase === "promote") return "";
    if (after.reason === "checkmate") return "#";
    return after.winner === null && inCheck(after, after.turn) ? "+" : "";
  }

  function pickPlayoutMove(s, rng) {
    const moves = s.moves, types = typesOf(s);
    if (rng() < CAPTURE_BIAS) {
      let best = -1, bestMoves = null;
      for (const m of moves) {
        const x = s.cells[m[1]];
        if (!x || ownerOf(x) === s.turn) continue;
        const val = (types[typeOf(x)].value || 0) + 1;
        if (val > best) { best = val; bestMoves = [m]; } else if (val === best) bestMoves.push(m);
      }
      if (bestMoves) return bestMoves[Math.floor(rng() * bestMoves.length)];
    }
    // Drops come last in the move list.
    let boardMoves = moves.length;
    while (boardMoves > 0 && isDrop(s, moves[boardMoves - 1])) boardMoves--;
    const drop = boardMoves < moves.length && (!boardMoves || rng() < DROP_CHANCE);
    return drop ? moves[boardMoves + Math.floor(rng() * (moves.length - boardMoves))] : moves[Math.floor(rng() * boardMoves)];
  }

  const reasons = {
    checkmate: (loser) => `${loser} is checkmated.`,
    stalemate: (loser, s) => (s.winner ? `${loser} has no legal move (stalemate loses).` : "Stalemate."),
    fifty: () => "50 moves each without a capture or pawn move.",
    adjudicated: () => "Adjudicated on material.",
    royal: (loser) => `${loser}'s royal piece was captured.`,
    ...(v.reasons || {}),
  };

  const game = {
    id: v.id,
    title: v.title,
    url: v.url,
    players,
    options: v.options || {},
    ...(v.colorSchemes !== null ? { colorSchemes: v.colorSchemes || BOARD_SCHEMES } : {}),
    // Promotion buttons name the piece: "Promote to Queen".
    moveLabel(s, move) {
      if (!move.startsWith(PROMOTE)) return null;
      return `Promote to ${typesOf(s)[s.board.chess.byKey[move.slice(PROMOTE.length)]].name}`;
    },

    createBoard: cachedBoards(v.boardKey || (() => ""), (opts) => {
      return attachRules(v.board ? v.board(opts) : squareBoard({ cols: 8, grid: false }), v.rules(opts));
    }),

    initialState(board, opts) {
      const cells = setupCells(board, v.setup(opts));
      const r = board.chess;
      const s = {
        board,
        cells,
        royal: findRoyals(board, cells),
        turn: WHITE,
        phase: "move",
        moves: null,
        pending: -1,
        castling: r.castling.reduce((bits, d) => bits | d.bit, 0),
        ep: -1,
        clock: 0,
        last: null,
        winner: null,
        reason: null,
      };
      const hand = emptyHand(board);
      if (hand) s.hand = hand;
      if (v.init) v.init(s, opts);
      if (v.setupPly && !v.setupPly.done(s)) s.phase = "setup";
      else startTurn(s);
      return s;
    },

    clone,
    // Start the mover's turn afresh on a position edited by hand (tests,
    // puzzles): list the moves, or end the game if there are none.
    refresh(s) {
      s.winner = null;
      s.reason = null;
      startTurn(s);
      return s;
    },
    toMove: (s) => (s.phase === "setup" || s.phase === "draw" ? CHANCE : s.turn),
    currentPlayer: (s) => (s.phase === "setup" ? null : s.turn),
    chances,
    legalMoves: legal,
    applyMove,
    outcome: (s) => (s.winner === null ? null : { winner: s.winner }),

    playout(s, rng) {
      for (let moves = 0; s.winner === null; ) {
        if (s.phase === "setup" || s.phase === "draw") {
          applyMove(s, pickWeighted(chances(s), rng));
          continue;
        }
        if (s.phase === "promote") {
          const options = promotions(s);
          applyMove(s, rng() < 0.6 ? options[0] : options[Math.floor(rng() * options.length)]);
          continue;
        }
        if (moves++ >= PLAYOUT_MOVES) {
          const d = material(s, s.turn) - material(s, other(s.turn));
          s.winner = rng() < 1 / (1 + Math.exp(-d / 2)) ? s.turn : other(s.turn);
          s.reason = "adjudicated";
          break;
        }
        applyMove(s, pickPlayoutMove(s, rng));
      }
      return s.winner;
    },

    // Hand panels (none without drops): Black's above, White's below.
    hands(s) {
      if (!s.hand) return [];
      const r = s.board.chess;
      return [BLACK, WHITE].map((player) => ({
        player,
        side: player === BLACK ? "top" : "bottom",
        slots: r.drops.map((t) => ({
          id: dropSlot(s, player, t),
          image: pieceImage(player, r.types[t].image),
          name: r.types[t].name,
          count: handCount(s, player, t),
        })),
      }));
    },

    piecesOf(s) {
      const types = typesOf(s), out = [];
      for (let id = 0; id < s.cells.length; id++) {
        const x = s.cells[id];
        if (!x) continue;
        const type = types[typeOf(x)], player = ownerOf(x);
        const piece = { id, player, image: pieceImage(player, type.image) };
        if (type.rotate) piece.rotate = type.rotate;
        if (type.label) piece.label = type.label;
        out.push(piece);
      }
      return out;
    },

    // The last move's squares (tinted green) and a royal in check (or
    // checkmated), glowing red.
    markers(s) {
      const out = [];
      if (s.last) {
        for (const id of s.last) {
          out.push(v.lastMove === "outline" ? { id, kind: "square", color: LAST_MOVE } : { id, kind: "tint" });
        }
      }
      for (const p of [WHITE, BLACK]) {
        if (s.royal[p] < 0) continue;
        if ((s.winner === null && p === s.turn && s.phase === "move" && inCheck(s, p)) ||
            (s.winner === other(p) && s.reason === "checkmate")) out.push({ id: s.royal[p], kind: "check" });
      }
      if (v.markers) out.push(...v.markers(s));
      return out;
    },

    // Algebraic notation with "+" or "#"; "=Q" for promotions. Other string
    // moves (chance plies) fall back to the default text.
    moveText(s, move) {
      if (typeof move === "string") {
        if (!move.startsWith(PROMOTE)) return null;
        const letter = typesOf(s)[s.board.chess.byKey[move.slice(PROMOTE.length)]].letter;
        return "=" + letter + (s.phase === "promote" ? checkMark(s, move) : "");
      }
      return notation(s, move, s.moves || []) + checkMark(s, move);
    },

    // "White to move. Check!", and the fifty-move countdown near its end.
    turnHint(s) {
      if (s.winner !== null || s.phase === "setup" || s.phase === "draw") return "";
      const name = players[s.turn].name;
      if (s.phase === "promote") return `${name}: choose a piece to promote to.`;
      const parts = [`${name} to move.`];
      if (inCheck(s, s.turn)) parts.push("Check!");
      const countdown = fiftyHint(s, fifty);
      if (countdown) parts.push(countdown);
      return parts.join(" ");
    },

    scoreSummary(s, player) {
      return { sub: players[player].name, title: `${players[player].name}: material ${material(s, player)}` };
    },

    outcomeLines(s) {
      const loser = s.winner ? players[other(s.winner)].name : "";
      const line = reasons[s.reason];
      return line ? [line(loser, s)] : [];
    },
  };
  return game;
}
