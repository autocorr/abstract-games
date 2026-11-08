// How chess pieces move, described as data: a piece's moves are a list of
// atoms, each a set of vectors walked in one manner. Pure: no DOM.
//
// Atoms (Betza-like):
//   leap(dx, dy)    one jump by each image of (dx, dy): a King is
//                   leap(1, 0) + leap(1, 1), a Knight leap(1, 2)
//   ride(dx, dy)    repeated jumps along a line, stopped by the first piece:
//                   a Rook is ride(1, 0), a Nightrider ride(1, 2)
//   cannon(dx, dy)  a Janggi Cannon's move: along the line, hop exactly one
//                   piece of either colour (the hurdle, at any distance),
//                   then move to any empty square beyond it, or capture the
//                   first piece beyond it if it is an enemy
//
// Options on every atom:
//   mode:     "mc" (default) moves and captures, "m" only moves to empty
//             squares, "c" only captures
//   max:      the most steps along a line (leap: 1, otherwise unlimited)
//   dirs:     explicit vectors instead of the 8 images of (dx, dy)
//   relative: the vectors are from the mover's side, so they turn round for
//             the second player (pawns): dy is forward
//   initial:  for "m" atoms, the most steps from the piece's starting rank
//             (a pawn's double step)
//
// compileMoves() turns a list of piece types into tables over a board: the
// rays out from every square along every vector used, each type's moves per
// player, and an index for attack tests that walks out from the attacked
// square (a "super-piece"), so a test costs one short walk per vector rather
// than a scan of every enemy piece.

// The distinct images of (dx, dy) under the 8 symmetries of the square.
export function images(dx, dy) {
  const out = [];
  const seen = new Set();
  for (const [a, b] of [[dx, dy], [dy, dx]]) {
    for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const v = [a * sa, b * sb];
      const key = v.join(",");
      if (!seen.has(key)) { seen.add(key); out.push(v); }
    }
  }
  return out;
}

function atom(kind, dx, dy, { mode = "mc", max = Infinity, dirs = null, relative = false, initial = 0 } = {}) {
  if (!/^(mc|m|c)$/.test(mode)) throw new Error(`bad mode ${mode}`);
  return { kind, vecs: dirs || images(dx, dy), mode, max, relative, initial };
}

export const leap = (dx, dy, opts = {}) => atom("slide", dx, dy, { max: 1, ...opts });
export const ride = (dx, dy, opts = {}) => atom("slide", dx, dy, opts);
export const cannon = (dx, dy, opts = {}) => atom("cannon", dx, dy, opts);

// Standard movements, by the letters used for them in move lists.
export const KING = [leap(1, 0), leap(1, 1)];
export const QUEEN = [ride(1, 0), ride(1, 1)];
export const ROOK = [ride(1, 0)];
export const BISHOP = [ride(1, 1)];
export const KNIGHT = [leap(1, 2)];
export const NIGHTRIDER = [ride(1, 2)];
export const QUEEN_CANNON = [cannon(1, 0), cannon(1, 1)];   // the Chak Quetzal

// A chess pawn: a step forward to an empty square (two from its starting
// rank if `double`), and a capture one step diagonally forward.
export function pawn({ double = true } = {}) {
  return [
    leap(0, 1, { dirs: [[0, 1]], relative: true, mode: "m", initial: double ? 2 : 0 }),
    leap(1, 1, { dirs: [[-1, 1], [1, 1]], relative: true, mode: "c" }),
  ];
}

const MOVE = 1, CAPTURE = 2;

// Tables for `types` (each { moves: [atom] }, indexed as given) on `board`, a
// grid board whose cells have coord { col, row } (square.js):
//   vecs:   [[dx, dy]] every vector used, and its reverse
//   rays:   rays[v][sq] the squares from sq along vecs[v] to the edge
//   moves:  moves[player][type] [{ v, kind, can, max, initial }] (can: MOVE
//           and CAPTURE bits)
//   attack: attack[player] [{ rv, kind, reach }]: for walking out from an
//           attacked square along rv (the reverse of the attacker's vector);
//           reach[type] is how far that type attacks along it (0: not at all)
export function compileMoves(board, types) {
  const vecs = [];
  const vecIndex = new Map();
  const vec = (dx, dy) => {
    const key = `${dx},${dy}`;
    if (!vecIndex.has(key)) {
      vecIndex.set(key, vecs.length);
      vecs.push([dx, dy]);
    }
    return vecIndex.get(key);
  };
  const moves = { 1: [], 2: [] };
  const attackMap = { 1: new Map(), 2: new Map() };
  types.forEach((type, t) => {
    for (const player of [1, 2]) {
      const list = [];
      for (const a of type.moves || []) {
        for (const [dx, dy0] of a.vecs) {
          const dy = a.relative && player === 2 ? -dy0 : dy0;
          const v = vec(dx, dy);
          const rv = vec(-dx, -dy);
          const can = (a.mode.includes("m") ? MOVE : 0) | (a.mode.includes("c") ? CAPTURE : 0);
          list.push({ v, kind: a.kind, can, max: a.max, initial: a.initial });
          if (can & CAPTURE) {
            const key = `${rv}:${a.kind}`;
            if (!attackMap[player].has(key)) attackMap[player].set(key, { rv, kind: a.kind, reach: new Array(types.length).fill(0) });
            const entry = attackMap[player].get(key);
            entry.reach[t] = Math.max(entry.reach[t], a.max);
          }
        }
      }
      moves[player][t] = list;
    }
  });
  const rays = vecs.map(([dx, dy]) => board.cells.map(({ coord: { col, row } }) => {
    const out = [];
    for (let k = 1; ; k++) {
      const id = board.at(col + k * dx, row + k * dy);
      if (id < 0) return out;
      out.push(id);
    }
  }));
  return {
    vecs, rays, moves,
    attack: { 1: [...attackMap[1].values()], 2: [...attackMap[2].values()] },
  };
}

export const CAN_MOVE = MOVE, CAN_CAPTURE = CAPTURE;
