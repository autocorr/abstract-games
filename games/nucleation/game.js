// Nucleation: roll a die and grow a group to that size. Pure: no DOM.
//
// Hex-hex board, Black first. A turn is a die roll (a chance ply, "roll:N";
// see common/dice.js) and then one stone placed on an empty cell ([id]).
// The placement's result is the size of the group the new stone ends up in:
// 1 plus every group of the mover's that it touches (merging is allowed).
//
//   - Rolls 1-5: the result must equal the roll.
//   - Roll 6: the result may be 6 or more (only a 6 grows a group past 6).
//   - If no cell gives the rolled result, step down to the largest smaller
//     result some cell gives ("down").
//   - If every empty cell gives a larger result, take the smallest result
//     available ("up").
// Results are capped at 6 when comparing, so all of this is one rule: with
// eff = min(6, result), play a cell whose eff is the largest at most the
// roll, or failing that the smallest.
//
// The game ends when the board is full. Each player's group sizes are sorted
// largest first and compared in order; the first difference decides. The
// board has an odd number of cells, so the players' stone totals differ and
// so do their lists: there are no draws.
//
// Swap (pie rule, common/swap.js, optional): after Black's first stone,
// White may swap sides instead of rolling. White's first turn then starts
// with a decision ply ("keep" or "swap") before the roll, so the swap is
// decided without knowing the die.

import { hexHexBoard } from "../../common/board/hex.js";
import { CHANCE, cachedBoards } from "../../common/engine.js";
import { rollOutcomes, rolledValue, dicePanel } from "../../common/dice.js";
import { withSwap } from "../../common/swap.js";

const BLACK = 1, WHITE = 2;
const PLAYERS = {
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff" },
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
};

const SIZES = [4, 5, 6, 7, 8];
const MAX_ROLL = 6;
const KEEP = "keep";
const SCORE_SIZES = 5;   // group sizes shown in the turn card

// ---- analysis ------------------------------------------------------------

// Groups of connected same-coloured stones: group[id] is the stone's group
// index (-1 if empty); size[g] and owner[g] describe group g.
function analyze(board, cells) {
  const group = new Int16Array(cells.length).fill(-1);
  const size = [], owner = [];
  const stack = [];
  for (let start = 0; start < cells.length; start++) {
    const p = cells[start];
    if (!p || group[start] >= 0) continue;
    const g = size.length;
    let n = 0;
    group[start] = g;
    stack.push(start);
    while (stack.length) {
      const id = stack.pop();
      n++;
      for (const nb of board.neighbours[id]) {
        if (cells[nb] === p && group[nb] < 0) { group[nb] = g; stack.push(nb); }
      }
    }
    size.push(n);
    owner.push(p);
  }
  return { group, size, owner };
}

// Size of the group a stone of `player` placed on empty cell `id` would
// make: 1 plus each distinct touching group of theirs.
function resultAt(board, cells, a, id, player) {
  let total = 1;
  const seen = [];
  for (const nb of board.neighbours[id]) {
    if (cells[nb] !== player) continue;
    const g = a.group[nb];
    if (!seen.includes(g)) { seen.push(g); total += a.size[g]; }
  }
  return total;
}

// The legal placements for the player to move with the rolled value:
// { cells, target, mode }, where target is the (capped) result to make and
// mode is "exact", "down" (stepped down to a smaller result) or "up" (every
// cell gives a larger one).
function placements(s, a = analyze(s.board, s.cells)) {
  const { board, cells, turn, roll } = s;
  const empty = [], eff = [];
  let best = 0, least = Infinity;
  for (let id = 0; id < cells.length; id++) {
    if (cells[id]) continue;
    const e = Math.min(MAX_ROLL, resultAt(board, cells, a, id, turn));
    empty.push(id);
    eff.push(e);
    if (e <= roll && e > best) best = e;
    if (e < least) least = e;
  }
  const target = best || least;
  const mode = best === roll ? "exact" : best ? "down" : "up";
  return { cells: empty.filter((_, i) => eff[i] === target), target, mode };
}

// Each player's group sizes, largest first.
function sizesOf(a, player) {
  return a.size.filter((_, g) => a.owner[g] === player).sort((x, y) => y - x);
}

// Index of the first group where the lists differ, or -1 if they are equal.
function firstDifference(x, y) {
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return i;
  return -1;
}

// ---- moves ---------------------------------------------------------------

// Place the mover's stone on `id`. Callers that already have the analysis
// and the placements for this position may pass them in.
function place(s, id, a = analyze(s.board, s.cells), { target, mode } = placements(s, a)) {
  const size = resultAt(s.board, s.cells, a, id, s.turn);
  s.cells[id] = s.turn;
  s.stones++;
  s.placed = id;
  s.roll = 0;
  if (s.stones === s.cells.length) {
    const after = analyze(s.board, s.cells);
    const black = sizesOf(after, BLACK), white = sizesOf(after, WHITE);
    const i = firstDifference(black, white);
    s.over = true;
    s.winner = i < 0 ? 0 : (black[i] || 0) > (white[i] || 0) ? BLACK : WHITE;
  } else {
    s.turn = 3 - s.turn;
    // White's first turn opens with the swap decision when the rule is on.
    s.phase = s.swapRule && s.stones === 1 ? "ready" : "roll";
  }
  return { size, target, mode };
}

function apply(s, move) {
  if (s.phase === "roll") {
    s.roll = rolledValue(move);
    s.phase = "place";
    return null;
  }
  if (s.phase === "ready") {   // KEEP; a swap goes through withSwap's onSwap
    s.phase = "roll";
    return null;
  }
  return place(s, move[0]);
}

// ---- text ----------------------------------------------------------------

const sizeText = (n) => (n >= MAX_ROLL ? `${MAX_ROLL} or more` : String(n));

// Why the last group differs: "Largest group: 9 vs 7." or "Tied on the top
// 2 groups; group 3 decides: 4 vs 3."
function decider(black, white) {
  const i = firstDifference(black, white);
  if (i < 0) return "";
  const b = black[i] || 0, w = white[i] || 0;
  if (i === 0) return `Largest group: Black ${b}, White ${w}.`;
  return `Tied on the largest ${i} group${i > 1 ? "s" : ""}; group ${i + 1} decides: Black ${b}, White ${w}.`;
}

const listText = (sizes) => sizes.join(" ") || "none";

export default withSwap({
  id: "nucleation",
  title: "Nucleation",
  url: import.meta.url,
  players: PLAYERS,
  options: {
    size: { label: "Board side", choices: SIZES, default: 5 },
    swap: {
      label: "Swap rule",
      choices: [{ value: "on", label: "On" }, { value: "off", label: "Off" }],
      default: "on",
    },
  },
  moveLabels: { [KEEP]: "Keep sides and roll" },
  pieceLabels: "Group sizes",   // Setup can hide the numbers on the stones

  createBoard: cachedBoards((o) => o.size, ({ size }) => hexHexBoard(size)),
  initialState(board, { swap }) {
    return {
      board,
      cells: new Uint8Array(board.size),
      turn: BLACK,
      phase: "roll",          // "roll" (chance), "place", or "ready" (White's swap decision)
      roll: 0,                // the die while placing, else 0
      stones: 0,
      placed: -1,             // the last stone placed
      swapRule: swap === "on",
      over: false,
      winner: null,
    };
  },
  clone(s) {
    return { ...s, cells: s.cells.slice() };
  },
  toMove(s) {
    return s.phase === "roll" ? CHANCE : s.turn;
  },
  currentPlayer(s) {
    return s.turn;
  },
  chances() {
    return rollOutcomes(MAX_ROLL);
  },
  legalMoves(s) {
    if (s.over) return [];
    if (s.phase === "roll") return rollOutcomes(MAX_ROLL).map((o) => o.move);
    if (s.phase === "ready") return [KEEP];
    return placements(s).cells.map((id) => [id]);
  },
  applyMove: apply,
  outcome(s) {
    return s.over ? { winner: s.winner } : null;
  },

  // Rollouts without building move lists: roll, then a random legal cell.
  playout(s, rng) {
    while (!s.over) {
      if (s.phase === "roll") {
        s.roll = 1 + Math.floor(rng() * MAX_ROLL);
        s.phase = "place";
      } else if (s.phase === "ready") {
        s.phase = "roll";
      } else {
        const a = analyze(s.board, s.cells);
        const legal = placements(s, a);
        place(s, legal.cells[Math.floor(rng() * legal.cells.length)], a, legal);
      }
    }
    return s.winner;
  },

  chanceView(s) {
    if (s.over || s.phase === "ready") return [];
    return [dicePanel([s.roll || null], { owner: s.turn, active: s.phase === "roll" })];
  },
  // Every stone shows the size of its group.
  piecesOf(s) {
    const a = analyze(s.board, s.cells);
    const out = [];
    for (let id = 0; id < s.cells.length; id++) {
      if (s.cells[id]) out.push({ id, player: s.cells[id], label: String(a.size[a.group[id]]) });
    }
    return out;
  },
  // An outline round the last stone placed (a ring would cover its label);
  // dots on the cells open to the roll.
  markers(s) {
    const out = [];
    if (s.placed >= 0) out.push({ id: s.placed, kind: "square" });
    if (!s.over && s.phase === "place") for (const id of placements(s).cells) out.push({ id, kind: "target" });
    return out;
  },
  // "d5 (3)": the cell and the size of the group it made.
  moveText(s, move, info) {
    if (move === KEEP) return "kept sides";
    if (!Array.isArray(move)) return null;
    return `${s.board.cells[move[0]].tags.name} (${info.size})`;
  },
  turnHint(s) {
    if (s.over) return "";
    const name = PLAYERS[s.turn].name;
    if (s.phase === "ready") return `${name}: roll to play on.`;
    if (s.phase === "roll") return `${name} rolls the die…`;
    const { target, mode } = placements(s);
    const make = `make a group of ${sizeText(target)}`;
    if (mode === "exact") return `${name} rolled ${s.roll}: ${make}.`;
    if (mode === "down") return `${name} rolled ${s.roll}, but no group of ${sizeText(s.roll)} is possible: ${make}.`;
    return `${name} rolled ${s.roll}, but every cell makes a larger group: ${make}.`;
  },
  // The leading group sizes, which decide the game, largest first.
  scoreSummary(s, player) {
    const sizes = sizesOf(analyze(s.board, s.cells), player);
    return {
      main: sizes.length ? sizes.slice(0, SCORE_SIZES).join(" ") + (sizes.length > SCORE_SIZES ? " …" : "") : "–",
      sub: PLAYERS[player].name,
      title: `${PLAYERS[player].name}'s groups, largest first: ${listText(sizes)}`,
    };
  },
  outcomeLines(s) {
    const a = analyze(s.board, s.cells);
    const black = sizesOf(a, BLACK), white = sizesOf(a, WHITE);
    return [decider(black, white), `Black: ${listText(black)}`, `White: ${listText(white)}`];
  },
}, {
  // Offered at White's decision before the first roll; either way the roll
  // comes next.
  offer: (s) => s.phase === "ready",
  onSwap: (s) => { s.phase = "roll"; },
});

export const internals = { placements, decider };
