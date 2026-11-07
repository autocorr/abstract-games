// Broadcast: a game of Y with dice and sowing. Pure: no DOM.
//
// Board: a triangle of hexagons (as in Y), or a hexagon of hexagons whose six
// sides are taken in adjacent pairs as three sides (common/board/hex.js).
// Cells on two sides (corners) belong to both. The board starts empty and
// Black moves first.
//
// Checkers stack. Each cell holds a stack, listed bottom to top; whoever has
// the top checker controls the cell, and a player "caps" the stacks they
// control.
//
// A turn: roll two dice (two chance plies, "roll:N"; see common/dice.js), then
// one move by the roller. With k the difference of the dice:
//   - k = 0: place a checker on a vacant cell ([id]).
//   - k > 0: sow a stack the mover caps whose height is exactly k, or failing
//     that the tallest height below k that they cap (down to 1). The whole
//     stack is lifted and dropped one checker per cell along a path of as
//     many steps as checkers ([origin, c1, ..., ch]), from the bottom of the
//     stack to the top, so the cap lands last, on top of the path's end. Each
//     step goes to a neighbour (vacant or occupied); the path may revisit
//     cells, including its origin, but never steps straight back to the cell
//     it just left.
//   - If the mover caps no stack of height k or less, they place instead.
//
// At the end of every turn, whoever's controlled cells join all three sides
// wins: the opponent too, if the mover's sow dropped their checkers to join
// it. As in Y, the top colours of a position never connect for both players
// at once, and a full board always connects for exactly one, so the game
// never stalls without a vacant cell to place on.
//
// Swap (pie rule, common/swap.js, optional): after Black's first turn, White
// may swap instead of rolling: Black's opening checker becomes White's and
// Black rolls next. White's first turn opens with a decision ply ("keep" or
// "swap") before the roll, so the swap is decided without knowing the dice.

import { triangleBoard, hexHexBoard } from "../../common/board/hex.js";
import { CHANCE, cachedBoards } from "../../common/engine.js";
import { rollOutcomes, rolledValue, dicePanel } from "../../common/dice.js";
import { withSwap } from "../../common/swap.js";

const BLACK = 1, WHITE = 2;
const PLAYERS = {
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff" },
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
};
const DIE = 6;
const KEEP = "keep";

const SIZES = Array.from({ length: 10 }, (_, i) => 4 + i);   // 4-13: hexagon 4-6, triangle 7-13
const sizeAllowed = (size, { shape }) => (shape === "hexagon" ? size <= 6 : size >= 7);

// Three side sets. A triangle's sides face out in two of the six directions
// each (DIRS6 in hex.js: 0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE); hex-hex side d
// faces d and d + 1, and sides 2i and 2i + 1 make set i.
const TRIANGLE_SETS = { W: 0, E: 1, S: 2 };
const TRIANGLE_FACING = { W: [2, 3], E: [0, 1], S: [4, 5] };
const setOf = (board, side) => (board.shape === "triangle" ? TRIANGLE_SETS[side] : side >> 1);
const facing = (board, side) => (board.shape === "triangle" ? TRIANGLE_FACING[side] : [side, (side + 1) % 6]);

// Side colours, drawn as lines along a hexagon's edge (a triangle's sides
// need no marking).
const SIDE_COLOURS = ["#c0392b", "#2471a3", "#d4a017"];

const colorSchemes = {
  brown: { name: "Brown", cellFill: () => "#f0d9b5" },
  blue: { name: "Blue", cellFill: () => "#dee3e6" },
};

// Stacks are drawn as piles of level bars, bottom checker lowest, centred on
// the cell and kept within it (sizes in cells; a cell is a little over 1.15
// tall). "shaded" (the default): every bar alike, on a cell shaded for the
// player on top, with the height beside piles of more than three;
// "capped": the top checker is a wider, taller bar carrying the height;
// "plain": every bar alike, thinning as the pile grows. None casts a shadow.
const PILE = 0.75, GAP = 0.018;
const pieceStyles = { shaded: { name: "Shaded" }, capped: { name: "Capped" }, plain: { name: "Plain" } };
const SHADES = { [BLACK]: "#8d8a84", [WHITE]: "#fffdf8" };

const TOP = { width: 0.76, height: 0.21 };
const restHeight = (rest) => (rest ? Math.min(0.087, (PILE - TOP.height - GAP * rest) / rest) : 0);
const cappedPile = (n) => TOP.height + (n - 1) * (restHeight(n - 1) + GAP);

function cappedStack(id, stack) {
  const rest = stack.length - 1;
  const h = restHeight(rest);
  let y = cappedPile(stack.length) / 2;   // the bottom of the pile
  const out = [];
  for (let i = 0; i < rest; i++) {
    out.push({ id, player: stack[i], stroke: 0.018, bar: { width: 0.58, height: h, y: y - h / 2 } });
    y -= h + GAP;
  }
  const top = { id, player: stack[rest], stroke: 0.025, bar: { ...TOP, y: y - TOP.height / 2, labelSize: 0.16 } };
  if (rest) top.label = String(stack.length);
  out.push(top);
  return out;
}

function plainStack(id, stack, { x = 0, width = 0.66 } = {}) {
  const n = stack.length;
  const h = Math.min(0.115, (PILE - GAP * (n - 1)) / n);
  const bottom = (n * h + (n - 1) * GAP) / 2;
  return stack.map((player, i) => ({
    id, player, stroke: 0.018, bar: { x, width, height: h, y: bottom - h / 2 - i * (h + GAP) },
  }));
}

function shadedStack(id, stack) {
  const n = stack.length;
  const tile = { id, player: null, fill: SHADES[stack[n - 1]], tile: true };
  if (n <= 3) return [tile, ...plainStack(id, stack)];
  // Room for the height on the right: the pile moves left and narrows.
  const bars = plainStack(id, stack, { x: -0.1, width: 0.5 });
  const top = bars[n - 1];
  top.label = String(n);
  top.bar = { ...top.bar, labelX: 0.33, labelY: 0, labelSize: 0.24 };
  return [tile, ...bars];
}

const STACK_DRAWERS = { shaded: shadedStack, capped: cappedStack, plain: plainStack };

function buildBoard({ shape, size }) {
  const board = shape === "hexagon" ? hexHexBoard(size) : triangleBoard(size);
  board.goal = Uint8Array.from(board.cells, (c) => c.tags.edges.reduce((m, side) => m | (1 << setOf(board, side)), 0));
  return board;
}

// The player whose controlled cells join all three side sets, or 0.
function connector(board, tops) {
  const seen = new Uint8Array(board.size);
  const stack = [];
  for (let start = 0; start < board.size; start++) {
    // Every connecting group touches set 0, so start only from there.
    if (seen[start] || !tops[start] || !(board.goal[start] & 1)) continue;
    const p = tops[start];
    let touched = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const id = stack.pop();
      touched |= board.goal[id];
      for (const n of board.neighbours[id]) {
        if (!seen[n] && tops[n] === p) { seen[n] = 1; stack.push(n); }
      }
    }
    if (touched === 7) return p;
  }
  return 0;
}

// ---- what the roll allows --------------------------------------------------

const difference = (s) => Math.abs(s.dice[0] - s.dice[1]);

// The height to sow for the player to move: k if they cap a stack that tall,
// else the tallest below k they cap; 0 if they must place instead.
function sowHeight(s) {
  const k = difference(s);
  let best = 0;
  if (k === 0) return 0;
  for (let id = 0; id < s.stacks.length; id++) {
    const h = s.stacks[id].length;
    if (h <= k && h > best && s.tops[id] === s.turn) best = h;
  }
  return best;
}

// Every sowing path of `h` steps from `origin`: [origin, c1, ..., ch].
function sowPaths(board, origin, h) {
  const out = [];
  const path = [origin];
  const walk = (prev) => {
    if (path.length > h) { out.push(path.slice()); return; }
    const cur = path[path.length - 1];
    for (const n of board.neighbours[cur]) {
      if (n === prev) continue;
      path.push(n);
      walk(cur);
      path.pop();
    }
  };
  walk(-1);
  return out;
}

// ---- moves -----------------------------------------------------------------

function endTurn(s) {
  const winner = connector(s.board, s.tops);
  s.turns++;
  s.dice = [0, 0];
  s.phase = "roll";
  if (winner) { s.winner = winner; return; }
  s.turn = 3 - s.turn;
  // White's first turn opens with the swap decision when the rule is on.
  if (s.swapRule && s.turns === 1) s.phase = "ready";
}

function place(s, id) {
  s.stacks[id].push(s.turn);
  s.tops[id] = s.turn;
}

function sow(s, path) {
  const { stacks, tops } = s;
  const lifted = stacks[path[0]];
  stacks[path[0]] = [];
  tops[path[0]] = 0;
  for (let i = 0; i < lifted.length; i++) {
    const id = path[i + 1];
    stacks[id].push(lifted[i]);
    tops[id] = lifted[i];
  }
}

function apply(s, move) {
  if (s.phase === "ready") {   // KEEP; a swap goes through swapColours
    s.phase = "roll";
    return null;
  }
  if (s.phase === "roll") {
    s.dice[s.dice[0] ? 1 : 0] = rolledValue(move);
    if (s.dice[1]) s.phase = "move";
    return null;
  }
  const mover = s.turn;
  if (move.length === 1) place(s, move[0]);
  else sow(s, move);
  s.last = move.slice();
  endTurn(s);
  return { player: mover };
}

// ---- text ------------------------------------------------------------------

function hint(s) {
  const name = PLAYERS[s.turn].name;
  if (s.phase === "ready") return `${name}: roll to play on.`;
  if (s.phase === "roll") return `${name} rolls the dice…`;
  const [a, b] = s.dice;
  const k = difference(s);
  const rolled = `${name} rolled ${a} and ${b}`;
  if (k === 0) return `${rolled}: place a checker on a vacant cell.`;
  const h = sowHeight(s);
  if (h === k) return `${rolled}: sow a stack of ${k}.`;
  if (h) return `${rolled}, but caps no stack of ${k}: sow a stack of ${h}.`;
  return `${rolled}, but caps no stack of ${k} or less: place a checker on a vacant cell.`;
}

// Line segments along the board's edge for each side set, for boardDecor. An
// outer edge of a corner cell between two sets is split at its midpoint.
function sideSegments(board) {
  const out = [[], [], []];
  for (const c of board.cells) {
    if (!c.tags.edges.length) continue;
    const sides = (dir) => c.tags.edges.filter((side) => facing(board, side).includes(dir)).map((side) => setOf(board, side));
    for (let k = 0; k < 6; k++) {
      const dir = (6 - k) % 6;   // poly edge k faces this direction
      if (board.step(c.id, dir) >= 0) continue;
      const sets = [...new Set(sides(dir))];
      if (!sets.length) continue;
      const a = c.poly[k], b = c.poly[(k + 1) % 6];
      if (sets.length === 1) { out[sets[0]].push([a, b]); continue; }
      // Vertex k is shared with edge k - 1, which faces dir + 1.
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const atA = sides((dir + 1) % 6)[0] ?? sets[0];
      out[atA].push([a, m]);
      out[sets.find((x) => x !== atA) ?? atA].push([m, b]);
    }
  }
  return out;
}

export default withSwap({
  id: "broadcast",
  title: "Broadcast",
  url: import.meta.url,
  players: PLAYERS,
  options: {
    shape: {
      label: "Board",
      choices: [{ value: "triangle", label: "Triangle" }, { value: "hexagon", label: "Hexagon" }],
      default: "triangle",
    },
    size: { label: "Board side", choices: SIZES, default: 10, allowed: sizeAllowed },
    swap: {
      label: "Swap rule",
      choices: [{ value: "on", label: "On" }, { value: "off", label: "Off" }],
      default: "on",
    },
  },
  moveLabels: { [KEEP]: "Roll" },
  colorSchemes,
  pieceStyles,
  pieceLabels: "Stack heights",

  createBoard: cachedBoards((o) => `${o.shape}/${o.size}`, buildBoard),
  initialState(board, { swap }) {
    return {
      board,
      stacks: Array.from({ length: board.size }, () => []),   // bottom to top
      tops: new Uint8Array(board.size),                         // owner of each top checker
      turn: BLACK,
      phase: "roll",          // "roll" (chance, one ply per die), "move", or "ready" (White's swap decision)
      dice: [0, 0],           // the dice of the turn in progress, 0 while unrolled
      last: null,             // the last move's cells
      turns: 0,               // turns completed
      swapRule: swap === "on",
      winner: 0,
    };
  },
  clone(s) {
    return {
      ...s,
      stacks: s.stacks.map((st) => st.slice()),
      tops: s.tops.slice(),
      dice: s.dice.slice(),
      last: s.last && s.last.slice(),
    };
  },
  toMove(s) {
    return s.phase === "roll" ? CHANCE : s.turn;
  },
  currentPlayer(s) {
    return s.turn;
  },
  chances() {
    return rollOutcomes(DIE);
  },
  legalMoves(s) {
    if (s.winner) return [];
    if (s.phase === "roll") return rollOutcomes(DIE).map((o) => o.move);
    if (s.phase === "ready") return [KEEP];
    const h = sowHeight(s);
    const out = [];
    for (let id = 0; id < s.stacks.length; id++) {
      if (!h) {
        if (!s.stacks[id].length) out.push([id]);
      } else if (s.stacks[id].length === h && s.tops[id] === s.turn) {
        for (const path of sowPaths(s.board, id, h)) out.push(path);
      }
    }
    return out;
  },
  applyMove: apply,
  // The swap: every checker changes colour (the board and goals are
  // symmetric), and the other player rolls next.
  swapColours(s) {
    for (let id = 0; id < s.stacks.length; id++) {
      s.stacks[id] = s.stacks[id].map((p) => 3 - p);
      if (s.tops[id]) s.tops[id] = 3 - s.tops[id];
    }
    s.turn = 3 - s.turn;
    s.phase = "roll";
  },
  outcome(s) {
    return s.winner ? { winner: s.winner } : null;
  },

  // Random rollouts without move lists: a sow is a random walk that never
  // steps straight back (every cell has at least two neighbours).
  playout(s, rng) {
    const { board, stacks } = s;
    const pick = (list) => list[Math.floor(rng() * list.length)];
    while (!s.winner) {
      // Keep any die already rolled; never swap.
      const die = () => 1 + Math.floor(rng() * DIE);
      if (s.phase !== "move") s.dice = [s.dice[0] || die(), die()];
      const h = sowHeight(s);
      const origins = [];
      for (let id = 0; id < stacks.length; id++) {
        if (h ? stacks[id].length === h && s.tops[id] === s.turn : !stacks[id].length) origins.push(id);
      }
      const origin = pick(origins);
      if (!h) {
        place(s, origin);
      } else {
        const path = [origin];
        let prev = -1;
        while (path.length <= h) {
          const cur = path[path.length - 1];
          const next = pick(board.neighbours[cur].filter((n) => n !== prev));
          path.push(next);
          prev = cur;
        }
        sow(s, path);
      }
      endTurn(s);
    }
    return s.winner;
  },

  chanceView(s) {
    if (s.winner || s.phase === "ready") return [];
    const result = s.dice[1] ? `difference ${difference(s)}` : null;
    return [dicePanel(s.dice.map((v) => v || null), { title: "Dice", owner: s.turn, active: s.phase === "roll", result })];
  },
  piecesOf(s, style) {
    const out = [];
    s.stacks.forEach((stack, id) => {
      if (stack.length) out.push(...(STACK_DRAWERS[style] || shadedStack)(id, stack));
    });
    // Flat on the board: no drop shadows.
    return out.map((p) => ({ ...p, shadow: false }));
  },
  // Outlines on the cells of the last move, and dots on the stacks open to
  // the roll when it must be sown.
  markers(s) {
    const out = [];
    if (s.last) for (const id of new Set(s.last)) out.push({ id, kind: "square" });
    if (!s.winner && s.phase === "move") {
      const h = sowHeight(s);
      // The dot goes under a short pile, clear of the height on its cap.
      const y = h > 1 && h < 5 ? cappedPile(h) / 2 + 0.13 : 0;
      if (h) for (let id = 0; id < s.stacks.length; id++) {
        if (s.stacks[id].length === h && s.tops[id] === s.turn) out.push({ id, kind: "target", y });
      }
    }
    return out;
  },
  // The second die also gives the difference: "rolled 2, difference 3".
  moveText(s, move) {
    if (move === KEEP) return "no swap";
    if (typeof move !== "string" || s.phase !== "roll" || !s.dice[0]) return null;
    const b = rolledValue(move);
    return `rolled ${b}, difference ${Math.abs(s.dice[0] - b)}`;
  },
  boardDecor(board) {
    if (board.shape === "triangle") return [];
    return sideSegments(board).map((segments, i) => ({ segments, stroke: SIDE_COLOURS[i], halo: "#0e0f13", width: 0.07, outside: true }));
  },
  scoreSummary(s, player) {
    return { sub: PLAYERS[player].name, title: `${PLAYERS[player].name} connects all three sides` };
  },
  turnHint(s) {
    return s.winner ? "" : hint(s);
  },
}, {
  // Offered at White's decision before the first roll.
  offer: (s) => s.phase === "ready",
});

export const internals = { connector, sowHeight, sowPaths, sideSegments };
