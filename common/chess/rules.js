// The rules of chess-like games over piece types described as data: move
// generation, attacks and check, castling, en passant, promotion and move
// notation. Pure: no DOM. A variant describes its pieces and castling with a
// spec; attachRules() compiles it onto a board as board.chess, and the
// functions here take a position `s` whose s.board carries it. chessGame()
// in game.js builds a whole Game on top of these.
//
// Spec:
//   types:    [{ key, name, letter, moves, value, image, rotate, label,
//              royal, becomes, castler, pawn, home, promote }]
//     key:      unique id, used in setups and promotion lists
//     letter:   move-list letter ("" for pawns), name for buttons
//     moves:    atoms from movement.js
//     value:    material, for playouts and the score panel
//     image:    Cburnett piece letter ("K" ... "P"); rotate: degrees
//               (180: upside down); label: text shown at the piece's
//               corner when the game's piece labels are on
//     royal:    the piece check and checkmate are about (one per side)
//     becomes:  the key of the type this piece turns into after it moves
//               (e.g. a two-faced piece flipping over); castling turns
//               both the royal and its castler
//     castler:  the piece the royal castles with (a Rook)
//     pawn:     moves are written without a letter; resets the fifty-move
//               count; a double step allows en passant
//     home:     relative rank (0 = the player's first) where atoms'
//               `initial` reach applies; default 1
//     promote:  keys this type may promote to on the last rank
//   castling: [{ name, king, rook, kingTo, rookTo }] for White, by square
//             names; Black's are mirrored onto the far rank. Rights are
//             bits in this order, White's then Black's.
//   castleMove: "king" (default): castling is the royal's move to kingTo;
//             "rook": the royal's move onto its own castler, for royals that
//             could otherwise move to kingTo
//   check:    true (default): no move may leave the mover's royal attacked;
//             false: royals may be captured, which wins
//   stalemate: "draw" (default) or "loss" for the player without a move
//   drops:    type keys a player may hold in hand and drop, in display
//             order (e.g. ["P", "N", "B", "R", "Q"]); default none
//
// Positions hold: cells (Uint8Array of piece codes, 0 empty), royal
// ([, white square, black square], -1 if none), castling (rights bits), ep
// (en passant target or -1), clock (plies since a capture or pawn move),
// pending (square of a pawn to promote, or -1), and with drops hand
// (Uint8Array of counts, see handIndex).
//
// Drops: a piece in hand is dropped onto an empty square, as the move
// [slot, to], where slot = board.size + handIndex(r, player, t) is an id
// past the board's cells (the shell's hand panels use the same ids). A
// pawn may not be dropped on the first or last rank. A drop may not leave
// the mover's royal attacked, but may give check or mate.

import { compileMoves, CAN_MOVE, CAN_CAPTURE } from "./movement.js";

export const WHITE = 1, BLACK = 2;
export const other = (p) => 3 - p;

// Piece codes: type index (from 1) and owner in one byte.
export const pieceCode = (t, player) => (t << 1) | (player - 1);
export const ownerOf = (x) => (x & 1) + 1;
export const typeOf = (x) => x >> 1;

// Compile `spec` for `board` (a square.js board) and attach it as
// board.chess. Returns the board.
export function attachRules(board, spec) {
  const types = [null, ...spec.types];
  const byKey = {};
  types.forEach((t, i) => { if (t) byKey[t.key] = i; });
  const compiled = compileMoves(board, types.map((t) => t || { moves: [] }));
  const rows = board.rows, cols = board.cols;
  const id = (name) => board.cells.find((c) => c.tags.name === name).id;
  const mirror = (sq) => board.at(board.cells[sq].coord.col, rows - 1 - board.cells[sq].coord.row);
  const castling = [];
  for (const player of [WHITE, BLACK]) {
    for (const def of spec.castling || []) {
      const flip = (name) => (player === WHITE ? id(name) : mirror(id(name)));
      const [king, rook, kingTo, rookTo] = [def.king, def.rook, def.kingTo, def.rookTo].map(flip);
      const span = (a, b) => {
        const row = board.cells[a].coord.row, ca = board.cells[a].coord.col, cb = board.cells[b].coord.col;
        const out = [];
        for (let c = Math.min(ca, cb); c <= Math.max(ca, cb); c++) out.push(board.at(c, row));
        return out;
      };
      const kingPath = span(king, kingTo);
      castling.push({
        player, name: def.name, bit: 1 << castling.length, king, rook, kingTo, rookTo,
        // Squares that must be empty (but for the royal and castler themselves).
        clear: [...new Set([...kingPath, ...span(rook, rookTo)])].filter((sq) => sq !== king && sq !== rook),
        // Squares the royal crosses that may not be attacked (it may not
        // start in check either; kingTo is tested like any destination).
        pass: kingPath.filter((sq) => sq !== kingTo),
      });
    }
  }
  board.chess = {
    types, byKey, ...compiled, castling,
    castleMove: spec.castleMove || "king",
    check: spec.check !== false,
    stalemate: spec.stalemate || "draw",
    rows, cols,
    col: board.cells.map((c) => c.coord.col),
    row: board.cells.map((c) => c.coord.row),
    home: types.map((t) => (t ? t.home ?? 1 : 0)),
    become: types.map((t) => (t && t.becomes ? byKey[t.becomes] : 0)),
    drops: (spec.drops || []).map((k) => {
      if (!byKey[k]) throw new Error(`unknown drop piece ${k}`);
      return byKey[k];
    }),
  };
  return board;
}

// Cells for a setup: `ranks` lists White's ranks from rank 1 as arrays of
// type keys (null for empty); Black's are the same files on the mirrored
// ranks.
export function setupCells(board, ranks) {
  const r = board.chess;
  const cells = new Uint8Array(board.size);
  ranks.forEach((rank, row) => rank.forEach((key, col) => {
    if (!key) return;
    const t = r.byKey[key];
    if (!t) throw new Error(`unknown piece ${key}`);
    cells[board.at(col, row)] = pieceCode(t, WHITE);
    cells[board.at(col, r.rows - 1 - row)] = pieceCode(t, BLACK);
  }));
  return cells;
}

// The royal squares of `cells`: [, white, black], -1 for none.
export function findRoyals(board, cells) {
  const out = [-1, -1, -1];
  cells.forEach((x, sq) => { if (x && board.chess.types[typeOf(x)].royal) out[ownerOf(x)] = sq; });
  return out;
}

// ---- hands and drops ----

// Index into s.hand of `player`'s count of type t.
export const handIndex = (r, player, t) => (player - 1) * r.types.length + t;

// An empty hand for a board with rules attached (null without drops).
export function emptyHand(board) {
  const r = board.chess;
  return r.drops.length ? new Uint8Array(2 * r.types.length) : null;
}

// The hand slot id of `player`'s type t: an id past the board's cells.
export const dropSlot = (s, player, t) => s.board.size + handIndex(s.board.chess, player, t);

// { player, t } for a hand slot id, or null for a square.
export function slotOf(s, id) {
  if (id < s.board.size) return null;
  const n = s.board.chess.types.length, i = id - s.board.size;
  return { player: Math.floor(i / n) + 1, t: i % n };
}

export const isDrop = (s, move) => move[0] >= s.board.size;

export function handCount(s, player, t) {
  return s.hand ? s.hand[handIndex(s.board.chess, player, t)] : 0;
}

// Put a piece of type key `key` into `player`'s hand.
export function addToHand(s, player, key) {
  const r = s.board.chess, t = r.byKey[key];
  if (!r.drops.includes(t)) throw new Error(`${key} cannot be held in hand`);
  s.hand[handIndex(r, player, t)]++;
}

// Drops open to `player` (not yet tested for check), appended to `out`.
export function dropMoves(s, player, out = []) {
  if (!s.hand) return out;
  const r = s.board.chess, cells = s.cells;
  for (const t of r.drops) {
    if (!s.hand[handIndex(r, player, t)]) continue;
    const slot = dropSlot(s, player, t), pawn = r.types[t].pawn;
    for (let to = 0; to < cells.length; to++) {
      if (cells[to]) continue;
      if (pawn && (r.row[to] === 0 || r.row[to] === r.rows - 1)) continue;
      out.push([slot, to]);
    }
  }
  return out;
}

// Is square `sq` attacked by `by`? Walks out from sq along the reverse of
// each vector `by`'s pieces capture along.
export function attacked(s, sq, by) {
  const r = s.board.chess, cells = s.cells;
  for (const { rv, kind, reach } of r.attack[by]) {
    const ray = r.rays[rv][sq];
    let hurdle = kind !== "cannon";   // a cannon needs one piece passed first
    for (let i = 0; i < ray.length; i++) {
      const x = cells[ray[i]];
      if (!x) continue;
      if (!hurdle) { hurdle = true; continue; }
      if (ownerOf(x) === by && reach[typeOf(x)] > i) return true;
      break;
    }
  }
  return false;
}

export function inCheck(s, player) {
  const r = s.board.chess;
  return r.check && s.royal[player] >= 0 && attacked(s, s.royal[player], other(player));
}

// Moves of `player`'s pieces ignoring check, as [from, to], appended to `out`.
export function pseudoMoves(s, player, out = []) {
  const r = s.board.chess, cells = s.cells;
  for (let from = 0; from < cells.length; from++) {
    const x = cells[from];
    if (!x || ownerOf(x) !== player) continue;
    const t = typeOf(x);
    const homeRow = player === WHITE ? r.home[t] : r.rows - 1 - r.home[t];
    for (const { v, kind, can, max, initial } of r.moves[player][t]) {
      const ray = r.rays[v][from];
      const reach = Math.min(ray.length, initial && r.row[from] === homeRow ? initial : max);
      let i = 0;
      if (kind === "cannon") {
        while (i < ray.length && !cells[ray[i]]) i++;   // up to the hurdle
        i++;
        for (; i < ray.length; i++) {
          const y = cells[ray[i]];
          if (!y) { if (can & CAN_MOVE) out.push([from, ray[i]]); continue; }
          if (can & CAN_CAPTURE && ownerOf(y) !== player) out.push([from, ray[i]]);
          break;
        }
        continue;
      }
      for (; i < reach; i++) {
        const to = ray[i], y = cells[to];
        if (!y) {
          if (can & CAN_MOVE) out.push([from, to]);
          else if (to === s.ep && can & CAN_CAPTURE && r.types[t].pawn) out.push([from, to]);
          continue;
        }
        if (can & CAN_CAPTURE && ownerOf(y) !== player) out.push([from, to]);
        break;
      }
    }
  }
  return out;
}

// The castling def `move` makes, or null.
export function castleOf(s, [from, to]) {
  const r = s.board.chess;
  if (!s.castling) return null;
  for (const def of r.castling) {
    if (def.king === from && s.castling & def.bit && (r.castleMove === "rook" ? def.rook : def.kingTo) === to) return def;
  }
  return null;
}

// The move that castles by `def`.
const castleKey = (r, def) => [def.king, r.castleMove === "rook" ? def.rook : def.kingTo];

// Castling moves open to `player` (not yet tested for landing in check).
export function castlingMoves(s, player) {
  const r = s.board.chess, cells = s.cells, out = [];
  if (!s.castling) return out;
  const enemy = other(player);
  for (const def of r.castling) {
    if (def.player !== player || !(s.castling & def.bit)) continue;
    const k = cells[def.king], c = cells[def.rook];
    if (!k || ownerOf(k) !== player || !r.types[typeOf(k)].royal) continue;
    if (!c || ownerOf(c) !== player || !r.types[typeOf(c)].castler) continue;
    if (def.clear.some((sq) => cells[sq])) continue;
    if (r.check && def.pass.some((sq) => attacked(s, sq, enemy))) continue;   // includes the start
    out.push(castleKey(r, def));
  }
  return out;
}

export const isEnPassant = (s, [from, to]) =>
  to === s.ep && !s.cells[to] && s.board.chess.col[from] !== s.board.chess.col[to] &&
  s.board.chess.types[typeOf(s.cells[from])].pawn;

// The square of the pawn an en passant capture to `to` takes.
function epVictim(s, from, to) {
  return s.board.at(s.board.chess.col[to], s.board.chess.row[from]);
}

// The piece code `x` turns into when it moves (itself unless its type
// `becomes` another).
export function turnedOver(r, x) {
  const t = r.become[typeOf(x)];
  return t ? pieceCode(t, ownerOf(x)) : x;
}

// Make `move` on the cells only (no rights or clocks), run fn(royalTo), and
// take it back. Used to test moves for check.
function trial(s, move, castle, fn) {
  const cells = s.cells, [from, to] = move;
  const slot = slotOf(s, from);
  if (slot) {
    cells[to] = pieceCode(slot.t, slot.player);
    const result = fn(s.royal[slot.player]);
    cells[to] = 0;
    return result;
  }
  const moving = cells[from], player = ownerOf(moving);
  const royal = s.royal[player];
  if (castle) {
    const rook = cells[castle.rook];
    cells[castle.king] = 0;
    cells[castle.rook] = 0;
    const saved = [cells[castle.kingTo], cells[castle.rookTo]];
    cells[castle.kingTo] = turnedOver(s.board.chess, moving);
    cells[castle.rookTo] = turnedOver(s.board.chess, rook);
    s.royal[player] = castle.kingTo;
    const result = fn(castle.kingTo);
    cells[castle.kingTo] = saved[0];
    cells[castle.rookTo] = saved[1];
    cells[castle.king] = moving;
    cells[castle.rook] = rook;
    s.royal[player] = royal;
    return result;
  }
  const captured = cells[to];
  let epSq = -1, epPiece = 0;
  if (isEnPassant(s, move)) {
    epSq = epVictim(s, from, to);
    epPiece = cells[epSq];
    cells[epSq] = 0;
  }
  cells[to] = moving;
  cells[from] = 0;
  if (from === royal) s.royal[player] = to;
  const result = fn(s.royal[player]);
  s.royal[player] = royal;
  cells[from] = moving;
  cells[to] = captured;
  if (epSq >= 0) cells[epSq] = epPiece;
  return result;
}

// Legal moves for `player`, drops last. allow(s, move, { royalTo, castle,
// drop }) may rule out more: it sees the position before the move, with
// royalTo the square the mover's royal ends on, castle the castling def, if
// any, and drop the dropped type, if any.
export function legalMoves(s, player, allow = null) {
  const r = s.board.chess;
  const enemy = other(player);
  const out = [];
  const candidates = castlingMoves(s, player);
  pseudoMoves(s, player, candidates);
  dropMoves(s, player, candidates);
  for (const move of candidates) {
    const royal = s.royal[player];
    const slot = slotOf(s, move[0]);
    if (slot) {
      if (allow && !allow(s, move, { royalTo: royal, castle: null, drop: slot.t })) continue;
      if (r.check && royal >= 0 && trial(s, move, null, (to) => attacked(s, to, enemy))) continue;
      out.push(move);
      continue;
    }
    const castle = move[0] === royal ? castleOf(s, move) : null;
    // A castling move by destination may duplicate a plain royal move.
    if (castle && out.some((m) => m[0] === move[0] && m[1] === move[1])) continue;
    const royalTo = castle ? castle.kingTo : move[0] === royal ? move[1] : royal;
    if (allow && !allow(s, move, { royalTo, castle })) continue;
    if (r.check && royalTo >= 0 && trial(s, move, castle, (to) => attacked(s, to, enemy))) continue;
    out.push(move);
  }
  return out;
}

// Play `move` (legal for the side whose piece stands on move[0]). Updates
// cells, royals, rights, ep and the clock; sets s.pending when a pawn
// reaches its last rank, or drops a piece from hand. Returns { castle,
// captured, landing, promote, drop }: landing is the square the moving piece
// ends on (the royal's for castling); drop is the type dropped, for a drop.
// A pawn drop resets the clock, as a pawn move does.
export function playMove(s, move) {
  const r = s.board.chess, cells = s.cells, [from, to] = move;
  const slot = slotOf(s, from);
  if (slot) {
    const i = handIndex(r, slot.player, slot.t);
    if (!s.hand[i]) throw new Error("no such piece in hand");
    s.hand[i]--;
    cells[to] = pieceCode(slot.t, slot.player);
    s.ep = -1;
    s.clock = r.types[slot.t].pawn ? 0 : s.clock + 1;
    s.last = [to];
    s.pending = -1;
    return { castle: null, captured: 0, landing: to, promote: false, drop: slot.t };
  }
  const moving = cells[from], player = ownerOf(moving), t = typeOf(moving);
  const type = r.types[t];
  const turned = turnedOver(r, moving);
  const castle = from === s.royal[player] ? castleOf(s, move) : null;
  let captured = 0, landing = to;
  if (castle) {
    const rook = cells[castle.rook];
    cells[castle.king] = 0;
    cells[castle.rook] = 0;
    cells[castle.kingTo] = turned;
    cells[castle.rookTo] = turnedOver(r, rook);
    landing = castle.kingTo;
  } else {
    captured = cells[to];
    if (isEnPassant(s, move)) {
      const sq = epVictim(s, from, to);
      captured = cells[sq];
      cells[sq] = 0;
    }
    cells[to] = turned;
    cells[from] = 0;
  }
  if (from === s.royal[player]) s.royal[player] = landing;
  if (captured && r.types[typeOf(captured)].royal) s.royal[ownerOf(captured)] = -1;

  // Rights go when the royal or castler leaves its square or is captured there.
  if (s.castling) {
    for (const def of r.castling) {
      if ([def.king, def.rook].some((sq) => sq === from || sq === to)) s.castling &= ~def.bit;
    }
  }
  const doubleStep = type.pawn && Math.abs(r.row[to] - r.row[from]) === 2 && r.col[to] === r.col[from];
  s.ep = doubleStep ? s.board.at(r.col[from], (r.row[from] + r.row[to]) / 2) : -1;
  s.clock = captured || type.pawn ? 0 : s.clock + 1;
  s.last = castle ? [from, castle.kingTo] : [from, to];
  const lastRow = player === WHITE ? r.rows - 1 : 0;
  const promote = !castle && type.promote && type.promote.length && r.row[to] === lastRow;
  s.pending = promote ? to : -1;
  return { castle, captured, landing, promote };
}

// Turn the pending pawn into `key`.
export function promotePending(s, key) {
  const sq = s.pending;
  s.cells[sq] = pieceCode(s.board.chess.byKey[key], ownerOf(s.cells[sq]));
  s.pending = -1;
  return sq;
}

// Material on the board and in hand.
export function material(s, player) {
  const r = s.board.chess, types = r.types;
  let total = 0;
  for (const x of s.cells) if (x && ownerOf(x) === player) total += types[typeOf(x)].value || 0;
  for (const t of r.drops) total += handCount(s, player, t) * (types[t].value || 0);
  return total;
}

// Algebraic notation for `move` from `s` without a check mark: "e4", "Nf3",
// "Bxc4", "exd5", "Nbd2", "O-O", drops "N@f3" and "P@e5". `legal` (the
// mover's legal moves) settles which origins need naming.
export function notation(s, move, legal = []) {
  const r = s.board.chess, [from, to] = move;
  const name = (sq) => s.board.cells[sq].tags.name;
  const slot = slotOf(s, from);
  if (slot) return (r.types[slot.t].letter || "P") + "@" + name(to);
  const x = s.cells[from], t = typeOf(x), type = r.types[t];
  const castle = from === s.royal[ownerOf(x)] ? castleOf(s, move) : null;
  if (castle) return castle.name;
  const capture = (s.cells[to] !== 0 && ownerOf(s.cells[to]) !== ownerOf(x)) || isEnPassant(s, move);
  if (type.pawn) return (capture ? name(from)[0] + "x" : "") + name(to);
  // Name the file, rank or square of origin if a piece with the same letter
  // (either face of a two-faced piece) could also go there.
  const player = ownerOf(x);
  const rivals = legal.filter(([f, d]) => {
    const y = d === to && f !== from && s.cells[f];
    return y && ownerOf(y) === player && r.types[typeOf(y)].letter === type.letter;
  });
  let origin = "";
  if (rivals.length) {
    if (!rivals.some(([f]) => r.col[f] === r.col[from])) origin = name(from).match(/^[a-z]+/)[0];
    else if (!rivals.some(([f]) => r.row[f] === r.row[from])) origin = name(from).match(/\d+$/)[0];
    else origin = name(from);
  }
  return type.letter + origin + (capture ? "x" : "") + name(to);
}
