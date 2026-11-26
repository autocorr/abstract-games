// Portal IV: chess in which every move leaves a portal on the square it
// vacates. Pure: no DOM; the chess comes from common/chess.
//
// There are two portals: White's move puts the blue portal on the square
// White's piece left (removing it from where it was), Black's the vermilion
// portal. A portal is always an empty square, and no piece may stop on one.
// A piece whose step (one square of a line, or a Knight's leap) lands on a
// portal comes out of the other portal and goes on by the same step from
// there; the portals themselves don't count as squares moved. So a King
// stepping onto one lands one square past the other, a Rook may go on
// sliding from it, and a Knight leaps once more from it. A step whose way
// on from the far portal is off the board can't be taken. Until both
// portals are on the board (Black's first move), the lone portal can't be
// entered at all. A line that comes back round to the moving piece's own
// square ends there.
//
// Attacks follow the same paths, so check and checkmate work through the
// portals, and a move may not leave the mover's King attacked with its new
// portal in place. Pawns step, double-step, capture and promote through
// portals too: en passant is open on the square a double step passed over,
// and takes the pawn that made it. Castling is as in chess, but no portal
// may stand between the King and the Rook or on their destinations;
// castling leaves the portal on the King's square. Stalemate draws, as do
// 50 moves each without a capture or pawn move.

import { chessGame } from "../../common/chess/game.js";
import { KING, QUEEN, ROOK, BISHOP, KNIGHT, pawn, CAN_MOVE, CAN_CAPTURE } from "../../common/chess/movement.js";
import { WHITE, BLACK, other, ownerOf, typeOf, playMove, notation, castleOf } from "../../common/chess/rules.js";

export const PORTALS = {
  [WHITE]: { name: "blue", color: "#0072b2", tint: "rgba(0, 114, 178, 0.45)" },
  [BLACK]: { name: "vermilion", color: "#d55e00", tint: "rgba(213, 94, 0, 0.45)" },
};

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
};

// The longest path any line can take: every square once.
const MAX_PATH = 64;

const isPortal = (s, sq) => sq >= 0 && (sq === s.portals[WHITE] || sq === s.portals[BLACK]);

// The square one step (dx, dy) from `sq`, through a portal if the step
// lands on one, or -1 if the step can't be taken (off the board, or onto
// a portal with no partner or whose way on is off the board). Taken
// backwards, a step retraces itself, so attacks can walk out from the
// attacked square.
export function step(s, sq, dx, dy) {
  const b = s.board, r = b.chess;
  const to = b.at(r.col[sq] + dx, r.row[sq] + dy);
  if (!isPortal(s, to)) return to;
  const exit = to === s.portals[WHITE] ? s.portals[BLACK] : s.portals[WHITE];
  if (exit < 0) return -1;
  const out = b.at(r.col[exit] + dx, r.row[exit] + dy);
  return isPortal(s, out) ? -1 : out;
}

// Is `sq` attacked by `by`? Walks out from sq along the reverse of each
// vector `by` captures along.
export function attacked(s, sq, by) {
  const r = s.board.chess, cells = s.cells;
  for (const { rv, reach } of r.attack[by]) {
    const [dx, dy] = r.vecs[rv];
    let at = sq;
    for (let i = 0; i < MAX_PATH; i++) {
      at = step(s, at, dx, dy);
      if (at < 0 || at === sq) break;
      const x = cells[at];
      if (!x) continue;
      if (ownerOf(x) === by && reach[typeOf(x)] > i) return true;
      break;
    }
  }
  return false;
}

const inCheck = (s, player) => s.royal[player] >= 0 && attacked(s, s.royal[player], other(player));

const forward = (player) => (player === WHITE ? 1 : -1);

// Whether the pawn on `from` captures onto `to` in one diagonal step.
function capturesTo(s, from, to) {
  const dy = forward(ownerOf(s.cells[from]));
  return step(s, from, -1, dy) === to || step(s, from, 1, dy) === to;
}

// The en passant capture `move` makes: the square of the pawn it takes, or -1.
function epVictim(s, [from, to]) {
  if (to !== s.ep || s.cells[to] || !s.board.chess.types[typeOf(s.cells[from])].pawn) return -1;
  return capturesTo(s, from, to) ? s.epPawn : -1;
}

// Moves of `player`'s pieces ignoring check, without repeats (two paths to
// the same square are one move).
function pseudoMoves(s, player, out, seen) {
  const r = s.board.chess, cells = s.cells;
  const add = (from, to) => {
    const key = from * cells.length + to;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([from, to]);
  };
  for (let from = 0; from < cells.length; from++) {
    const x = cells[from];
    if (!x || ownerOf(x) !== player) continue;
    const t = typeOf(x), isPawn = r.types[t].pawn;
    const homeRow = player === WHITE ? r.home[t] : r.rows - 1 - r.home[t];
    for (const { v, can, max, initial } of r.moves[player][t]) {
      const [dx, dy] = r.vecs[v];
      const reach = Math.min(MAX_PATH, initial && r.row[from] === homeRow ? initial : max);
      let at = from;
      for (let i = 0; i < reach; i++) {
        at = step(s, at, dx, dy);
        if (at < 0 || at === from) break;
        const y = cells[at];
        if (!y) {
          if (can & CAN_MOVE) add(from, at);
          else if (at === s.ep && can & CAN_CAPTURE && isPawn) add(from, at);
          continue;
        }
        if (can & CAN_CAPTURE && ownerOf(y) !== player) add(from, at);
        break;
      }
    }
  }
  return out;
}

// Castling as in chess, with no portal between the King and the Rook or on
// their destinations.
function castlingMoves(s, player, out, seen) {
  const r = s.board.chess, cells = s.cells, enemy = other(player);
  for (const def of r.castling) {
    if (def.player !== player || !(s.castling & def.bit)) continue;
    const k = cells[def.king], c = cells[def.rook];
    if (!k || ownerOf(k) !== player || !r.types[typeOf(k)].royal) continue;
    if (!c || ownerOf(c) !== player || !r.types[typeOf(c)].castler) continue;
    if (def.clear.some((sq) => cells[sq] || isPortal(s, sq))) continue;
    if (isPortal(s, def.kingTo) || isPortal(s, def.rookTo)) continue;
    if (def.pass.some((sq) => attacked(s, sq, enemy))) continue;   // includes the start
    seen.add(def.king * cells.length + def.kingTo);
    out.push([def.king, def.kingTo]);
  }
}

// Make `move` on the cells, with the mover's portal moved to its origin,
// run fn(royal square), and take it all back.
function trial(s, move, castle, fn) {
  const cells = s.cells, [from, to] = move;
  const moving = cells[from], player = ownerOf(moving);
  const royal = s.royal[player], portal = s.portals[player];
  s.portals[player] = from;
  let result;
  if (castle) {
    const rook = cells[castle.rook];
    cells[castle.king] = 0;
    cells[castle.rook] = 0;
    cells[castle.kingTo] = moving;
    cells[castle.rookTo] = rook;
    s.royal[player] = castle.kingTo;
    result = fn(castle.kingTo);
    cells[castle.kingTo] = 0;
    cells[castle.rookTo] = 0;
    cells[castle.king] = moving;
    cells[castle.rook] = rook;
  } else {
    const captured = cells[to], ep = epVictim(s, move), epPiece = ep >= 0 ? cells[ep] : 0;
    if (ep >= 0) cells[ep] = 0;
    cells[to] = moving;
    cells[from] = 0;
    if (from === royal) s.royal[player] = to;
    result = fn(s.royal[player]);
    cells[from] = moving;
    cells[to] = captured;
    if (ep >= 0) cells[ep] = epPiece;
  }
  s.royal[player] = royal;
  s.portals[player] = portal;
  return result;
}

function legalMoves(s, player) {
  const enemy = other(player), candidates = [], seen = new Set();
  castlingMoves(s, player, candidates, seen);
  pseudoMoves(s, player, candidates, seen);
  return candidates.filter((move) => {
    const castle = move[0] === s.royal[player] ? castleOf(s, move) : null;
    return !trial(s, move, castle, (royal) => royal >= 0 && attacked(s, royal, enemy));
  });
}

// Play a move: rules.js plays it, but en passant and double steps are
// worked out here, along portal paths; then the mover's portal moves to
// the square the move left.
function play(s, move) {
  const [from, to] = move, r = s.board.chess;
  const moving = s.cells[from], player = ownerOf(moving);
  const isPawn = r.types[typeOf(moving)].pawn;
  const ep = epVictim(s, move);
  let victim = 0;
  if (ep >= 0) {
    victim = s.cells[ep];
    s.cells[ep] = 0;
  }
  // A double step: a pawn move onto an empty square that one step doesn't reach.
  const one = isPawn ? step(s, from, 0, forward(player)) : -1;
  const double = isPawn && ep < 0 && !s.cells[to] && to !== one && !capturesTo(s, from, to);
  s.ep = -1;   // rules.js's en passant is by geometry: keep it out
  const info = playMove(s, move);
  if (victim) info.captured = victim;
  s.ep = double ? one : -1;
  s.epPawn = double ? to : -1;
  s.portals = s.portals.slice();
  s.portals[player] = from;
  return info;
}

function moveNotation(s, move, legal) {
  if (epVictim(s, move) >= 0) {
    const name = (sq) => s.board.cells[sq].tags.name;
    return name(move[0])[0] + "x" + name(move[1]);
  }
  const ep = s.ep;
  s.ep = -1;
  const text = notation(s, move, legal);
  s.ep = ep;
  return text;
}

const game = chessGame({
  id: "portal-iv",
  title: "Portal IV",
  url: import.meta.url,
  rules: () => RULES,
  setup: () => [
    ["R", "N", "B", "Q", "K", "B", "N", "R"],
    Array(8).fill("P"),
  ],
  init(s) {
    s.portals = [-1, -1, -1];   // [, blue (White's), vermilion (Black's)]
    s.epPawn = -1;              // the pawn that double-stepped past s.ep
  },
  clone(copy) {
    copy.portals = copy.portals.slice();
  },
  moves: legalMoves,
  inCheck,
  play,
  notation: moveNotation,
  // Each portal: its square tinted in its color, and a ring.
  markers(s) {
    const out = [];
    for (const p of [WHITE, BLACK]) {
      const sq = s.portals[p];
      if (sq < 0) continue;
      out.push({ id: sq, kind: "tint", color: PORTALS[p].tint }, { id: sq, kind: "ring", color: PORTALS[p].color, size: 0.7 });
    }
    return out;
  },
});

export default game;
