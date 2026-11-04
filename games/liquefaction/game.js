// Liquefaction: chess without Queens on a board shaded in four colours, from
// Bag of Tricks. Each turn the player draws a marble; squares of the drawn
// colour are "colour-checked" for their King, which may not stand on one
// after the move. Pure: no DOM.
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
import { makeBag, cloneBag, drawOutcomes, drawMarble, addMarbles, bagSize } from "../../common/bag.js";
import { CHANCE, pickWeighted } from "../../common/engine.js";

const WHITE = 1, BLACK = 2;
const PLAYERS = {
  1: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
  2: { name: "Black", fill: "#202329", mark: "#ffffff" },
};

// Pieces: cells hold type | (BLACK_BIT for Black); 0 = empty.
const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const BLACK_BIT = 8;
const TYPE = 7;
const LETTER = ["", "P", "N", "B", "R", "Q", "K"];
const VALUE = [0, 1, 3, 3, 5, 9, 0];
const NAMES = { N: "Knight", B: "Bishop", R: "Rook" };
const PROMOTIONS = ["N", "B", "R"];
const PROMOTE = "promote:";
const FILL = "fill:";

const owner = (piece) => (piece & BLACK_BIT ? BLACK : WHITE);
const make = (type, player) => type | (player === BLACK ? BLACK_BIT : 0);

const CLASSES = ["A", "B", "C", "D"];
const PER_COLOUR = 5;   // supply: 5 marbles of each colour
const BAG_SIZE = 5;
const FIFTY_MOVE_PLIES = 100;
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

const PIECE_URL = Object.fromEntries([WHITE, BLACK].flatMap((p) => [P, N, B, R, Q, K].map((t) => {
  const name = (p === WHITE ? "w" : "b") + LETTER[t];
  return [make(t, p), new URL(`../../common/pieces/cburnett/${name}.svg`, import.meta.url).href];
})));

// ---- board geometry ------------------------------------------------------

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ORTH = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const DIAG = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

const boards = new Map();
const LAST_MOVE = "rgba(14, 15, 19, 0.75)";

function buildBoard(size) {
  const board = squareBoard({ cols: size });
  const n = size;
  const id = (c, r) => (c >= 0 && c < n && r >= 0 && r < n ? r * n + c : -1);
  const leaps = (deltas) => board.cells.map(({ coord: { col, row } }) =>
    deltas.map(([dc, dr]) => id(col + dc, row + dr)).filter((x) => x >= 0));
  const rays = (deltas) => board.cells.map(({ coord: { col, row } }) => deltas.map(([dc, dr]) => {
    const out = [];
    for (let c = col + dc, r = row + dr; id(c, r) >= 0; c += dc, r += dr) out.push(id(c, r));
    return out;
  }).filter((ray) => ray.length));
  board.chess = {
    n,
    knight: leaps(KNIGHT),
    king: leaps(KING),
    orth: rays(ORTH),
    diag: rays(DIAG),
    cls: board.cells.map((c) => CLASSES[c.tags.quad]),
    col: board.cells.map((c) => c.coord.col),
    row: board.cells.map((c) => c.coord.row),
    big: n === 8,   // castling, double steps and en passant
  };
  return board;
}

// ---- attacks and move generation ----------------------------------------

// Is square `sq` attacked by `by` on `cells`?
function attacked(geo, cells, sq, by) {
  const black = by === BLACK ? BLACK_BIT : 0;
  for (const t of geo.knight[sq]) if (cells[t] === (N | black)) return true;
  for (const t of geo.king[sq]) if (cells[t] === (K | black)) return true;
  // A pawn of `by` attacks sq from one rank behind it (from by's side).
  const r = geo.row[sq] + (by === WHITE ? -1 : 1);
  if (r >= 0 && r < geo.n) {
    for (const dc of [-1, 1]) {
      const c = geo.col[sq] + dc;
      if (c >= 0 && c < geo.n && cells[r * geo.n + c] === (P | black)) return true;
    }
  }
  for (const ray of geo.orth[sq]) {
    for (const t of ray) {
      const x = cells[t];
      if (!x) continue;
      if (x === (R | black) || x === (Q | black)) return true;
      break;
    }
  }
  for (const ray of geo.diag[sq]) {
    for (const t of ray) {
      const x = cells[t];
      if (!x) continue;
      if (x === (B | black) || x === (Q | black)) return true;
      break;
    }
  }
  return false;
}

const other = (p) => 3 - p;

function kingSquare(s, player) {
  return s.kings[player - 1];
}

function inCheck(s, player) {
  return attacked(s.board.chess, s.cells, kingSquare(s, player), other(player));
}

// Pseudo-legal moves for the side to move as [from, to] (castling is the
// King's two-square move; en passant and promotions are plain [from, to]).
function pseudoMoves(s, player) {
  const geo = s.board.chess, cells = s.cells, n = geo.n;
  const mine = (x) => x && owner(x) === player;
  const out = [];
  const slide = (from, rays) => {
    for (const ray of rays) {
      for (const t of ray) {
        if (!cells[t]) { out.push([from, t]); continue; }
        if (!mine(cells[t])) out.push([from, t]);
        break;
      }
    }
  };
  const fwd = player === WHITE ? 1 : -1;
  for (let from = 0; from < cells.length; from++) {
    const x = cells[from];
    if (!mine(x)) continue;
    switch (x & TYPE) {
      case P: {
        const r = geo.row[from] + fwd, c = geo.col[from];
        if (r < 0 || r >= n) break;
        const one = r * n + c;
        if (!cells[one]) {
          out.push([from, one]);
          const startRow = player === WHITE ? 1 : n - 2;
          const two = one + fwd * n;
          if (geo.big && geo.row[from] === startRow && !cells[two]) out.push([from, two]);
        }
        for (const dc of [-1, 1]) {
          if (c + dc < 0 || c + dc >= n) continue;
          const t = r * n + c + dc;
          if ((cells[t] && !mine(cells[t])) || t === s.ep) out.push([from, t]);
        }
        break;
      }
      case N:
        for (const t of geo.knight[from]) if (!mine(cells[t])) out.push([from, t]);
        break;
      case B: slide(from, geo.diag[from]); break;
      case R: slide(from, geo.orth[from]); break;
      case Q: slide(from, geo.orth[from]); slide(from, geo.diag[from]); break;
      case K:
        for (const t of geo.king[from]) if (!mine(cells[t])) out.push([from, t]);
        break;
    }
  }
  return out;
}

// Castling rights: bit 1 White short, 2 White long, 4 Black short, 8 Black long.
const CASTLE_BITS = { [WHITE]: [1, 2], [BLACK]: [4, 8] };

function castlingMoves(s, player, colour) {
  const geo = s.board.chess, cells = s.cells, n = geo.n;
  if (!geo.big) return [];
  const [shortBit, longBit] = CASTLE_BITS[player];
  if (!(s.castling & (shortBit | longBit))) return [];
  const row = player === WHITE ? 0 : n - 1;
  const at = (c) => row * n + c;
  const king = at(4);
  if (cells[king] !== make(K, player)) return [];
  if (geo.cls[king] === colour) return [];               // colour-checked: may not castle
  const enemy = other(player);
  if (attacked(geo, cells, king, enemy)) return [];      // in check
  const out = [];
  const rook = make(R, player);
  // Short: f and g empty, f not attacked; long: b, c and d empty, d not
  // attacked. The destination is checked with the other moves.
  if (s.castling & shortBit && cells[at(7)] === rook && !cells[at(5)] && !cells[at(6)] &&
      !attacked(geo, cells, at(5), enemy)) out.push([king, at(6)]);
  if (s.castling & longBit && cells[at(0)] === rook && !cells[at(1)] && !cells[at(2)] && !cells[at(3)] &&
      !attacked(geo, cells, at(3), enemy)) out.push([king, at(2)]);
  return out;
}

const isCastle = (s, from, to) => (s.cells[from] & TYPE) === K && Math.abs(to - from) === 2;
const isEnPassant = (s, from, to) => (s.cells[from] & TYPE) === P && to === s.ep;

// Legal moves for `player` when `colour` was drawn.
function generateMoves(s, player, colour) {
  const geo = s.board.chess, cells = s.cells;
  const kingAt = kingSquare(s, player);
  const colourChecked = geo.cls[kingAt] === colour;
  const enemy = other(player);
  const out = [];
  const candidates = colourChecked ? [] : castlingMoves(s, player, colour);
  for (const m of pseudoMoves(s, player)) candidates.push(m);
  for (const m of candidates) {
    const [from, to] = m;
    const moving = cells[from];
    const isKing = (moving & TYPE) === K;
    if (colourChecked && !isKing) continue;
    const kingTo = isKing ? to : kingAt;
    if (geo.cls[kingTo] === colour) continue;
    // Try the move and test the King. Castling's rook can't affect it.
    const captured = cells[to];
    let epSq = -1, epPiece = 0;
    if (isEnPassant(s, from, to)) {
      epSq = to + (player === WHITE ? -geo.n : geo.n);
      epPiece = cells[epSq];
      cells[epSq] = 0;
    }
    cells[to] = moving;
    cells[from] = 0;
    const safe = !attacked(geo, cells, kingTo, enemy);
    cells[from] = moving;
    cells[to] = captured;
    if (epSq >= 0) cells[epSq] = epPiece;
    if (safe) out.push(m);
  }
  return out;
}

// ---- turn flow -----------------------------------------------------------

function material(s, player) {
  let total = 0;
  for (const x of s.cells) if (x && owner(x) === player) total += VALUE[x & TYPE];
  return total;
}

// After the draw: list the moves, or end the game if there are none.
function startMovePhase(s) {
  s.moves = generateMoves(s, s.turn, s.colour);
  if (s.moves.length) return;
  const geo = s.board.chess;
  s.winner = other(s.turn);
  s.reason = inCheck(s, s.turn) ? "checkmate"
    : geo.cls[kingSquare(s, s.turn)] === s.colour ? "colourmate" : "stalemate";
}

function endTurn(s, landing) {
  addMarbles(s.bag, s.board.chess.cls[landing]);
  s.moves = null;
  s.colour = null;
  s.turn = other(s.turn);
  s.phase = "draw";
  if (s.clock >= FIFTY_MOVE_PLIES) {
    s.winner = 0;
    s.reason = "fifty";
  }
}

function applyPlayerMove(s, [from, to]) {
  const geo = s.board.chess, cells = s.cells, n = geo.n;
  const piece = cells[from], type = piece & TYPE, player = s.turn;
  let capture = cells[to] !== 0;
  if (isEnPassant(s, from, to)) {
    cells[to + (player === WHITE ? -n : n)] = 0;
    capture = true;
  }
  if (isCastle(s, from, to)) {
    const row = geo.row[from] * n;
    const [rookFrom, rookTo] = to > from ? [row + n - 1, to - 1] : [row, to + 1];
    cells[rookTo] = cells[rookFrom];
    cells[rookFrom] = 0;
  }
  cells[to] = piece;
  cells[from] = 0;
  if (type === K) s.kings[player - 1] = to;

  // Castling rights: lost when the King moves, or a rook leaves or is
  // captured on its corner.
  if (geo.big && s.castling) {
    const corner = { [0]: 2, [n - 1]: 1, [n * (n - 1)]: 8, [n * n - 1]: 4 };
    if (type === K) for (const bit of CASTLE_BITS[player]) s.castling &= ~bit;
    if (corner[from]) s.castling &= ~corner[from];
    if (corner[to]) s.castling &= ~corner[to];
  }

  s.ep = geo.big && type === P && Math.abs(to - from) === 2 * n ? (from + to) / 2 : -1;
  s.clock = capture || type === P ? 0 : s.clock + 1;
  s.last = [from, to];

  const lastRow = player === WHITE ? n - 1 : 0;
  if (type === P && geo.row[to] === lastRow) {
    s.phase = "promote";
    s.pending = to;
    return;
  }
  endTurn(s, to);
}

// ---- playout for the AI --------------------------------------------------

// Playouts play capture-biased random moves for a limited number of plies,
// then adjudicate on material: the side ahead by d points wins with
// probability 1 / (1 + e^(-d/2)). The adjudication ends the (scratch) game.
const PLAYOUT_MOVES = 40;
const CAPTURE_BIAS = 0.75;

function pickPlayoutMove(s, rng) {
  const moves = s.moves;
  if (rng() < CAPTURE_BIAS) {
    let best = -1, bestMoves = null;
    for (const m of moves) {
      const v = VALUE[s.cells[m[1]] & TYPE] + (s.cells[m[1]] ? 1 : 0);
      if (!v) continue;
      if (v > best) { best = v; bestMoves = [m]; } else if (v === best) bestMoves.push(m);
    }
    if (bestMoves) return bestMoves[Math.floor(rng() * bestMoves.length)];
  }
  return moves[Math.floor(rng() * moves.length)];
}

// ---- the game ------------------------------------------------------------

const game = {
  id: "liquefaction",
  title: "Liquefaction",
  url: import.meta.url,
  players: PLAYERS,
  marbles: DEFAULT_SCHEME.marbles,
  options: {
    size: { label: "Board", choices: [{ value: 6, label: "6×6" }, { value: 8, label: "8×8" }], default: 6 },
    bag: { label: "Starting bag", choices: [{ value: "fixed", label: "Fixed" }, { value: "random", label: "Random" }], default: "fixed" },
  },
  colorSchemes,
  moveLabels: Object.fromEntries(PROMOTIONS.map((t) => [PROMOTE + t, `Promote to ${NAMES[t]}`])),

  createBoard({ size }) {
    if (!boards.has(size)) boards.set(size, buildBoard(size));
    return boards.get(size);
  },

  initialState(board, opts) {
    const n = board.chess.n;
    const cells = new Uint8Array(n * n);
    const back = BACK_RANKS[n];
    for (let c = 0; c < n; c++) {
      const t = LETTER.indexOf(back[c]);
      if (t > 0) {
        cells[c] = make(t, WHITE);
        cells[(n - 1) * n + c] = make(t, BLACK);
      }
      cells[n + c] = make(P, WHITE);
      cells[(n - 2) * n + c] = make(P, BLACK);
    }
    const kingCol = back.indexOf("K");
    const random = opts.bag === "random";
    return {
      board,
      cells,
      kings: [kingCol, (n - 1) * n + kingCol],
      turn: WHITE,
      phase: random ? "setup" : "draw",
      bag: makeBag(random ? { A: 0, B: 0, C: 0, D: 0 } : FIXED_BAGS[n]),
      colour: null,         // the colour drawn this turn
      moves: null,          // legal moves this turn (after the draw)
      pending: -1,          // square of a pawn awaiting promotion
      castling: board.chess.big ? 15 : 0,
      ep: -1,               // en passant target square
      clock: 0,             // plies since a capture or pawn move
      last: null,           // [from, to] of the last move
      winner: null,
      reason: null,
    };
  },

  clone(s) {
    return { ...s, cells: s.cells.slice(), kings: s.kings.slice(), bag: cloneBag(s.bag) };
  },

  toMove(s) {
    return s.phase === "setup" || s.phase === "draw" ? CHANCE : s.turn;
  },
  currentPlayer(s) {
    return s.turn;
  },

  chances(s) {
    if (s.phase === "setup") {
      const left = CLASSES.length * PER_COLOUR - bagSize(s.bag);
      return CLASSES.map((c) => ({ move: FILL + c, p: (PER_COLOUR - s.bag.counts[c]) / left }))
        .filter((o) => o.p > 0);
    }
    return drawOutcomes(s.bag);
  },

  legalMoves(s) {
    if (s.winner !== null) return [];
    switch (s.phase) {
      case "setup":
      case "draw": return this.chances(s).map((o) => o.move);
      case "move": return s.moves;
      case "promote": return PROMOTIONS.map((t) => PROMOTE + t);
    }
    return [];
  },

  applyMove(s, move) {
    switch (s.phase) {
      case "setup":
        addMarbles(s.bag, move.slice(FILL.length));
        if (bagSize(s.bag) === BAG_SIZE) s.phase = "draw";
        return null;
      case "draw":
        s.colour = drawMarble(s.bag, move);
        if (s.bag.drawn.length > DRAWN_SHOWN) s.bag.drawn.splice(0, s.bag.drawn.length - DRAWN_SHOWN);
        s.phase = "move";
        startMovePhase(s);
        return null;
      case "move":
        applyPlayerMove(s, move);
        return null;
      case "promote": {
        const t = LETTER.indexOf(move.slice(PROMOTE.length));
        s.cells[s.pending] = make(t, s.turn);
        const landing = s.pending;
        s.pending = -1;
        endTurn(s, landing);
        return null;
      }
    }
    throw new Error(`no move expected in phase ${s.phase}`);
  },

  outcome(s) {
    return s.winner === null ? null : { winner: s.winner };
  },

  // Capture-biased playout with material adjudication (see above).
  playout(s, rng) {
    for (let moves = 0; s.winner === null; ) {
      if (s.phase === "setup" || s.phase === "draw") {
        this.applyMove(s, pickWeighted(this.chances(s), rng));
        continue;
      }
      if (s.phase === "promote") {
        this.applyMove(s, rng() < 0.6 ? PROMOTE + "R" : PROMOTE + PROMOTIONS[Math.floor(rng() * 2)]);
        continue;
      }
      if (moves++ >= PLAYOUT_MOVES) {
        const d = material(s, s.turn) - material(s, other(s.turn));
        s.winner = rng() < 1 / (1 + Math.exp(-d / 2)) ? s.turn : other(s.turn);
        s.reason = "adjudicated";
        break;
      }
      this.applyMove(s, pickPlayoutMove(s, rng));
    }
    return s.winner;
  },

  piecesOf(s) {
    const out = [];
    for (let id = 0; id < s.cells.length; id++) {
      const x = s.cells[id];
      if (x) out.push({ id, player: owner(x), image: PIECE_URL[x] });
    }
    return out;
  },

  // The last move's squares, the drawn colour's squares (hatched) and a
  // King in check.
  markers(s) {
    const out = [];
    if (s.last) for (const id of s.last) out.push({ id, kind: "square", color: LAST_MOVE });
    if (s.winner === null && (s.phase === "move" || s.phase === "promote")) {
      const geo = s.board.chess;
      for (let id = 0; id < s.cells.length; id++) if (geo.cls[id] === s.colour) out.push({ id, kind: "shade" });
    }
    for (const p of [WHITE, BLACK]) {
      if ((s.winner === null && p === s.turn && s.phase === "move" && inCheck(s, p)) ||
          (s.winner === other(p) && s.reason === "checkmate")) out.push({ id: kingSquare(s, p), kind: "check" });
    }
    return out;
  },

  chanceView(s) {
    return [{
      title: s.phase === "setup" ? "Bag (filling)" : "Bag",
      counts: s.bag.counts,
      drawn: s.bag.drawn,
      active: s.winner === null && (s.phase === "draw" || s.phase === "setup"),
    }];
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
    parts.push(s.board.chess.cls[kingSquare(s, s.turn)] === s.colour
      ? `The King must leave its ${colour} square.`
      : `The King may not move onto ${colour}.`);
    const left = FIFTY_MOVE_PLIES - s.clock;
    if (left <= 20) parts.push(`Draw in ${left} moves without a capture or pawn move.`);
    return parts.join(" ");
  },

  scoreSummary(s, player) {
    return { sub: PLAYERS[player].name, title: `${PLAYERS[player].name}: material ${material(s, player)}` };
  },

  outcomeLines(s) {
    const loser = s.winner ? PLAYERS[other(s.winner)].name : "";
    switch (s.reason) {
      case "checkmate": return [`${loser} is checkmated.`];
      case "colourmate": return [`${loser}'s King cannot leave the drawn color.`];
      case "stalemate": return [`${loser} has no legal move (stalemate loses).`];
      case "fifty": return ["50 moves each without a capture or pawn move."];
      case "adjudicated": return ["Adjudicated on material."];
    }
    return [];
  },
};

export default game;

// For tests.
export const internals = { attacked, generateMoves, CLASSES, FIXED_BAGS, make, P, N, B, R, Q, K, WHITE, BLACK };
