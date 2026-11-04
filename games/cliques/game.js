// Cliques: a territory-by-majority game on a hex-hex board. Pure: no DOM.
//
// A group is a set of connected stones of one colour; a cluster is a set of
// connected stones of either colour (a connected component of all stones).
// A cluster is decided for the player with the larger largest group in it.
//
// On a turn a player either
//   - places a stone on an empty cell, then may pull one of their own stones
//     (not the one just placed) in a straight line through empty cells to any
//     cell where it ends in the placed stone's group. Moves: [p] or
//     [p, from, to]. Or
//   - claims a tied cluster (both players' largest groups there are equal
//     size) that is not already claimed: move [c], where c is a stone of the
//     claimer's largest group(s) there (see claimStone). A claim decides the
//     cluster for the claimer for as long as the cluster stays tied; it lapses
//     when the tie is broken, when the cluster splits, or when it merges with
//     another claimed cluster (both claims lapse).
//
// Cluster minimum M: while there are fewer than M clusters (the opening), a
// turn must raise the count; after that it may never drop below M. In the
// opening every cluster is a single stone (stones - clusters starts at 0 and
// cannot grow), so opening turns are exactly placements touching no stone:
// no pull fits (it leaves two stones touching) and nothing is tied to claim.
//
// The opening always reaches M if every maximal set of non-touching stones
// containing the start stones has at least M stones (independent
// domination, computed by search):
//   side 3: empty 4, corners 7      side 4: empty 7, corners 9
//   side 5: empty 11, corners 13    side 6+: at least 16
// Options exclude the minimums the board cannot guarantee, and side 3 with
// corners also excludes 7, which fills the board's 7 non-touching cells and
// ends the game on Black's first move.
//
// The game ends when the player to move has no legal move (no placement and
// no claim). It cannot end with more than M clusters: an empty cell on the
// edge, or next to a full outer ring, touches at most two clusters, so with
// M + 1 or more a placement there is legal, and working inwards a stuck
// position would need a full board (one cluster). So the game ends with
// exactly M clusters, an odd number. Every tied cluster is claimed by then
// (or claiming would be legal), so every cluster is decided and the player
// with more decided clusters wins. There are no draws.
//
// Swap (pie rule, common/swap.js): White may swap sides on their first turn.

import { hexHexBoard, DIRS6 } from "../../common/board/hex.js";
import { withSwap } from "../../common/swap.js";
import { shuffle } from "../../common/rng.js";

const BLACK = 1, WHITE = 2;
const PLAYERS = {
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff" },
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
};

const SIZES = [3, 4, 5, 6, 7];
const MINIMUMS = [3, 5, 7, 9];

// The largest minimum each board and start supports (see above).
const MAX_MIN = { 3: { empty: 3, corners: 5 }, 4: { empty: 7, corners: 9 } };
export const minimumAllowed = (min, { size, start }) => min <= (MAX_MIN[size]?.[start] ?? 9);

// The cluster count a turn must leave: one more than before in the opening,
// otherwise at least the minimum.
const required = (s, before) => (before < s.min ? before + 1 : s.min);

const boards = new Map();

function buildBoard(side) {
  const board = hexHexBoard(side);
  // Corners in direction order round the board (0 = east, then anticlockwise
  // on screen); alternate Black and White starting with Black.
  const m = side - 1;
  board.corners = DIRS6.map(([dq, dr]) => board.at(m * dq, m * dr));
  // rays[id][d]: the cells from id (exclusive) in direction d to the edge.
  board.rays = board.cells.map((c) => DIRS6.map((_, d) => {
    const out = [];
    for (let n = board.step(c.id, d); n >= 0; n = board.step(n, d)) out.push(n);
    return out;
  }));
  return board;
}

// ---- analysis ------------------------------------------------------------

// Number of clusters (components of occupied cells).
function countClusters(board, cells, seen, stack) {
  seen.fill(0);
  let count = 0;
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || seen[start]) continue;
    count++;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const id = stack.pop();
      for (const n of board.neighbours[id]) {
        if (cells[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
  }
  return count;
}

// Does the group of `a` contain `b`?
function sameGroup(board, cells, a, b, seen, stack) {
  const p = cells[a];
  if (cells[b] !== p) return false;
  seen.fill(0);
  seen[a] = 1;
  stack.length = 0;
  stack.push(a);
  while (stack.length) {
    const id = stack.pop();
    if (id === b) return true;
    for (const n of board.neighbours[id]) {
      if (cells[n] === p && !seen[n]) { seen[n] = 1; stack.push(n); }
    }
  }
  return false;
}

// Full analysis: cluster and group labels, and per cluster its stones and
// each player's largest group size.
//   clusterOf[id]: cluster index, -1 if empty
//   groupSize[id]: size of the stone's group
//   clusters: [{ stones, best: [_, black, white] }]
function analyze(board, cells) {
  const n = cells.length;
  const clusterOf = new Int16Array(n).fill(-1);
  const groupSize = new Int16Array(n);
  const clusters = [];
  const stack = [];
  for (let start = 0; start < n; start++) {
    if (!cells[start] || clusterOf[start] >= 0) continue;
    const k = clusters.length;
    const stones = [];
    clusterOf[start] = k;
    stack.push(start);
    while (stack.length) {
      const id = stack.pop();
      stones.push(id);
      for (const nb of board.neighbours[id]) {
        if (cells[nb] && clusterOf[nb] < 0) { clusterOf[nb] = k; stack.push(nb); }
      }
    }
    clusters.push({ stones: stones.sort((a, b) => a - b), best: [0, 0, 0] });
  }
  const done = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (!cells[start] || done[start]) continue;
    const p = cells[start];
    const group = [start];
    done[start] = 1;
    for (let i = 0; i < group.length; i++) {
      for (const nb of board.neighbours[group[i]]) {
        if (cells[nb] === p && !done[nb]) { done[nb] = 1; group.push(nb); }
      }
    }
    for (const id of group) groupSize[id] = group.length;
    const c = clusters[clusterOf[start]];
    if (group.length > c.best[p]) c.best[p] = group.length;
  }
  return { clusterOf, groupSize, clusters };
}

const isTied = (c) => c.best[BLACK] > 0 && c.best[BLACK] === c.best[WHITE];

// The claimer's stones in the largest group(s) of cluster c (what the claim
// dots mark).
function largestStones(cells, a, c, player) {
  return c.stones.filter((id) => cells[id] === player && a.groupSize[id] === c.best[player]);
}

// The stone that stands for a claim of cluster c by `player`: the lowest of
// the claimer's largest-group stones.
const claimStone = (cells, a, c, player) => largestStones(cells, a, c, player)[0];

// Clusters (indices) that hold a live claim, mapped to the claimer.
function claimedClusters(s, a) {
  const out = new Map();
  for (const claim of s.claims) out.set(a.clusterOf[claim.cells[0]], claim.player);
  return out;
}

// Claim moves for the player to move: [stone] per tied, unclaimed cluster.
// None in the opening, where a turn must raise the cluster count.
function claimMoves(s, a) {
  if (a.clusters.length < s.min) return [];
  const claimed = claimedClusters(s, a);
  const out = [];
  a.clusters.forEach((c, k) => {
    if (isTied(c) && !claimed.has(k)) out.push([claimStone(s.cells, a, c, s.turn)]);
  });
  return out;
}

// Each cluster's decision: the claimer, the player with the larger largest
// group, or 0 (tied and unclaimed).
function decisions(s, a = analyze(s.board, s.cells)) {
  const claimed = claimedClusters(s, a);
  return a.clusters.map((c, k) => {
    if (claimed.has(k)) return claimed.get(k);
    return c.best[BLACK] > c.best[WHITE] ? BLACK : c.best[WHITE] > c.best[BLACK] ? WHITE : 0;
  });
}

function tally(s) {
  const out = { [BLACK]: 0, [WHITE]: 0 };
  for (const d of decisions(s)) if (d) out[d]++;
  return out;
}

// ---- placements ------------------------------------------------------------

// Placement moves for the player to move, in a fixed order. `onlyOne`
// returns as soon as one legal move is found (for the end-of-game test).
// The count rule: see required().
function placementMoves(s, { onlyOne = false, cells: only = null } = {}) {
  const { board } = s;
  const cells = s.cells;
  const me = s.turn;
  const seen = new Uint8Array(cells.length);
  const stack = [];
  const before = countClusters(board, cells, seen, stack);
  const need = required(s, before);

  // Cluster labels for the cheap plain-placement count.
  const label = new Int16Array(cells.length).fill(-1);
  {
    let k = 0;
    for (let start = 0; start < cells.length; start++) {
      if (!cells[start] || label[start] >= 0) continue;
      label[start] = k;
      stack.length = 0;
      stack.push(start);
      while (stack.length) {
        const id = stack.pop();
        for (const n of board.neighbours[id]) if (cells[n] && label[n] < 0) { label[n] = k; stack.push(n); }
      }
      k++;
    }
  }

  const out = [];
  const group = [];
  const inGroup = new Uint8Array(cells.length);
  const dest = new Uint8Array(cells.length);
  const places = only || cells.keys();
  for (const p of places) {
    if (cells[p]) continue;
    // Plain placement: joins the distinct clusters next to p.
    const touching = new Set();
    for (const n of board.neighbours[p]) if (cells[n]) touching.add(label[n]);
    if (before + 1 - touching.size >= need) {
      out.push([p]);
      if (onlyOne) return out;
    }

    // Pulls. Place p, find its group G; every empty cell next to G is a
    // destination, and the first stone seen from it along each line is a
    // possible source if it is ours.
    cells[p] = me;
    group.length = 0;
    group.push(p);
    inGroup[p] = 1;
    for (let i = 0; i < group.length; i++) {
      for (const n of board.neighbours[group[i]]) if (cells[n] === me && !inGroup[n]) { inGroup[n] = 1; group.push(n); }
    }
    const dests = [];
    for (const g of group) for (const n of board.neighbours[g]) if (!cells[n] && !dest[n]) { dest[n] = 1; dests.push(n); }
    const pulls = [];
    for (const d of dests) {
      dest[d] = 0;
      for (const ray of board.rays[d]) {
        let src = -1;
        for (const n of ray) if (cells[n]) { src = n; break; }
        if (src < 0 || src === p || cells[src] !== me) continue;
        cells[src] = 0;
        cells[d] = me;
        // A source outside G leaves G whole, so d is next to it; a source in
        // G may split it, so check d still joins the placed stone.
        const ok = (!inGroup[src] || sameGroup(board, cells, p, d, seen, stack)) &&
          countClusters(board, cells, seen, stack) >= need;
        cells[d] = 0;
        cells[src] = me;
        if (ok) {
          pulls.push([p, src, d]);
          if (onlyOne) break;
        }
      }
      if (onlyOne && pulls.length) break;
    }
    for (const d of dests) dest[d] = 0;
    for (const g of group) inGroup[g] = 0;
    cells[p] = 0;
    pulls.sort((x, y) => x[1] - y[1] || x[2] - y[2]);
    out.push(...pulls);
    if (onlyOne && out.length) return out;
  }
  return out;
}

function hasLegalMove(s) {
  if (claimMoves(s, analyze(s.board, s.cells)).length) return true;
  return placementMoves(s, { onlyOne: true }).length > 0;
}

// After a placement turn: follow the pulled stone, then keep each claim
// whose stones still form one tied cluster that no other claim shares.
function updateClaims(s, from, to) {
  if (!s.claims.length) return;
  const a = analyze(s.board, s.cells);
  const where = new Map();
  for (const claim of s.claims) {
    if (from >= 0) claim.cells = claim.cells.map((id) => (id === from ? to : id));
    const ks = new Set(claim.cells.map((id) => a.clusterOf[id]));
    const k = ks.size === 1 ? [...ks][0] : -1;
    claim.k = k >= 0 && isTied(a.clusters[k]) ? k : -1;
    if (claim.k >= 0) where.set(claim.k, (where.get(claim.k) || 0) + 1);
  }
  s.claims = s.claims
    .filter((claim) => claim.k >= 0 && where.get(claim.k) === 1)
    .map((claim) => ({ player: claim.player, cells: a.clusters[claim.k].stones.slice() }));
}

function finishTurn(s) {
  s.turn = 3 - s.turn;
  if (!hasLegalMove(s)) {
    const t = tally(s);
    s.over = true;
    // Equal counts cannot happen (see the header); 0 would report a draw.
    s.winner = t[BLACK] > t[WHITE] ? BLACK : t[WHITE] > t[BLACK] ? WHITE : 0;
  }
}

function apply(s, move) {
  const id = move[0];
  s.claimed = -1;
  s.placed = -1;
  s.pulled = null;
  if (s.cells[id]) {
    // Claim: the cluster containing the stone.
    const a = analyze(s.board, s.cells);
    s.claims.push({ player: s.turn, cells: a.clusters[a.clusterOf[id]].stones.slice() });
    s.claimed = id;
  } else {
    s.cells[id] = s.turn;
    s.placed = id;
    if (move.length === 3) {
      s.cells[move[1]] = 0;
      s.cells[move[2]] = s.turn;
      s.pulled = [move[1], move[2]];
    }
    updateClaims(s, s.pulled ? s.pulled[0] : -1, s.pulled ? s.pulled[1] : -1);
  }
  finishTurn(s);
  return null;
}

export default withSwap({
  id: "cliques",
  title: "Cliques",
  url: import.meta.url,
  players: PLAYERS,
  options: {
    size: { label: "Board side", choices: SIZES, default: 5 },
    min: { label: "Minimum clusters", choices: MINIMUMS, default: 5, allowed: minimumAllowed },
    start: {
      label: "Start",
      choices: [{ value: "corners", label: "Corners" }, { value: "empty", label: "Empty" }],
      default: "corners",
    },
  },

  createBoard({ size }) {
    if (!boards.has(size)) boards.set(size, buildBoard(size));
    return boards.get(size);
  },
  initialState(board, { min, start }) {
    const cells = new Uint8Array(board.size);
    if (start === "corners") board.corners.forEach((id, d) => { cells[id] = d % 2 ? WHITE : BLACK; });
    return {
      board,
      cells,
      turn: BLACK,
      min,
      claims: [],           // [{ player, cells }]: live claims and their cluster's stones
      placed: -1,           // last turn's placed stone
      pulled: null,         // last turn's pull [from, to]
      claimed: -1,          // last turn's claim stone
      over: false,
      winner: null,
    };
  },
  clone(s) {
    return {
      ...s,
      cells: s.cells.slice(),
      claims: s.claims.map((c) => ({ player: c.player, cells: c.cells.slice() })),
      pulled: s.pulled && s.pulled.slice(),
    };
  },
  toMove(s) {
    return s.turn;
  },
  legalMoves(s) {
    if (s.over) return [];
    return [...placementMoves(s), ...claimMoves(s, analyze(s.board, s.cells))];
  },
  applyMove: apply,
  outcome(s) {
    return s.over ? { winner: s.winner } : null;
  },

  // Random playout without listing every move: try empty cells in random
  // order, taking the first with a legal placement (with a random pull half
  // the time when one exists); claim instead now and then.
  playout(s, rng) {
    while (!s.over) {
      const claims = claimMoves(s, analyze(s.board, s.cells));
      if (claims.length && rng() < 0.3) {
        apply(s, claims[Math.floor(rng() * claims.length)]);
        continue;
      }
      const empties = [];
      for (let id = 0; id < s.cells.length; id++) if (!s.cells[id]) empties.push(id);
      shuffle(empties, rng);
      let move = null;
      for (const p of empties) {
        const moves = placementMoves(s, { cells: [p] });
        if (!moves.length) continue;
        const plain = moves[0].length === 1 ? moves[0] : null;
        move = plain && (moves.length === 1 || rng() < 0.5) ? plain
          : moves[(plain ? 1 : 0) + Math.floor(rng() * (moves.length - (plain ? 1 : 0)))];
        break;
      }
      apply(s, move || claims[Math.floor(rng() * claims.length)]);
    }
    return s.winner;
  },

  // Claim dots on the claimer's largest group(s) in each claimed cluster;
  // rings on the last placed and pulled stones (or the claim stone); target
  // dots on the stones that would claim each tied, unclaimed cluster.
  markers(s) {
    const a = analyze(s.board, s.cells);
    const out = [];
    for (const claim of s.claims) {
      const c = a.clusters[a.clusterOf[claim.cells[0]]];
      for (const id of largestStones(s.cells, a, c, claim.player)) out.push({ id, kind: "dot" });
    }
    if (s.placed >= 0) out.push({ id: s.placed, kind: "ring" });
    if (s.pulled) out.push({ id: s.pulled[1], kind: "ring" });
    if (!s.over) for (const [id] of claimMoves(s, a)) out.push({ id, kind: "target" });
    return out;
  },
  // Log text: a placement ("d4"), with its pull ("d4, pull b2–c3"), or a
  // claim of a tied cluster ("claim c3", naming a stone of the claimer's).
  moveText(s, move) {
    if (!Array.isArray(move)) return null;
    const name = (id) => s.board.cells[id].tags.name;
    if (move.length === 1 && s.cells[move[0]]) return `claim ${name(move[0])}`;
    return move.length === 3 ? `${name(move[0])}, pull ${name(move[1])}–${name(move[2])}` : null;
  },

  turnHint(s) {
    if (s.over) return "";
    const seen = new Uint8Array(s.cells.length);
    const count = countClusters(s.board, s.cells, seen, []);
    const name = PLAYERS[s.turn].name;
    if (count < s.min) return `${name}: place a stone touching no other stone (opening: clusters ${count} of ${s.min}).`;
    const claim = claimMoves(s, analyze(s.board, s.cells)).length ? ", or claim a tied cluster at a yellow dot" : "";
    return `${name}: place a stone, then you may pull one of yours to its group${claim}. Clusters ${count}, minimum ${s.min}.`;
  },
  scoreSummary(s, player) {
    const t = tally(s);
    return {
      main: t[player],
      sub: PLAYERS[player].name,
      title: `Clusters decided for ${PLAYERS[player].name}`,
    };
  },
  outcomeLines(s) {
    const t = tally(s);
    return [`Clusters decided: Black ${t[BLACK]}, White ${t[WHITE]}.`];
  },
});
