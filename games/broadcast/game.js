// Broadcast: a dice game of sowing stacks to hold three corners of the board.
// Pure: no DOM.
//
// Board: a triangle of hexagons, whose three corner cells decide the game, or
// a hexagon of hexagons, where every other corner does (west, north-east and
// south-east). The board starts empty and Black moves first.
//
// Checkers stack. Each cell holds a stack, listed bottom to top; whoever has
// the top checker controls the cell, and a player "caps" the stacks they
// control.
//
// A turn: roll two dice (two chance plies, "roll:N"; see common/dice.js), then
// one move by the roller, with k the difference of the dice:
//   - k = 0: place a new checker on a vacant cell ([id]).
//   - k > 0: sow a stack they cap whose height is exactly k, leaving a new
//     checker of theirs on its cell. The stack is lifted and dropped one
//     checker per cell along a path of as many steps as checkers ([origin, c1,
//     ..., ck]), from the bottom of the stack to the top, so the cap lands
//     last, on top of the path's end. Each step goes to a neighbour (vacant or
//     occupied); the path may revisit cells, including its origin, but never
//     steps straight back to the cell it just left.
//   - k > 0 and no stack of k to sow: cap one of their stacks with a new
//     checker ([id]); if they cap no stack at all, place on a vacant cell.
// A stack of six or more can never be sown.
//
// No cell ever empties, so the board only fills. The game ends when, once the
// dice are rolled, the player to move has no legal move: a double with no
// vacant cell (or, on a full board, a player capping nothing). The board is
// then full, so all three scoring corners are capped, and whoever caps two
// or three of them wins.
//
// Swap (pie rule, common/swap.js, optional): after Black's first turn, White
// may swap instead of rolling: Black's opening checker becomes White's and
// Black rolls next. White's first turn opens with a decision ply ("keep" or
// "swap") before the roll, so the swap is decided without knowing the dice.

import { triangleBoard, hexHexBoard, DIRS6 } from "../../common/board/hex.js";
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
const UNSOWABLE = DIE;   // the largest difference is DIE - 1
const SIZES = [3, 4, 5, 6, 7, 8, 9, 10];   // hexagon 3-6
const sizeAllowed = (size, { shape }) => shape !== "hexagon" || size <= 6;

// The scoring corners are darker (a stack's shading covers them once filled).
const colorSchemes = {
  brown: { name: "Brown", cellFill: (c) => (c.tags.scoring ? "#d9a05b" : "#f0d9b5") },
  blue: { name: "Blue", cellFill: (c) => (c.tags.scoring ? "#8fb3cf" : "#dee3e6") },
};

// Stacks are drawn as piles of level bars, bottom checker lowest, centred on
// the cell and kept within it (sizes in cells; a cell is a little over 1.15
// tall). "shaded" (the default): every bar alike, on a cell shaded for the
// player on top; "capped": the top checker is a wider, taller bar; "plain":
// every bar alike, thinning as the pile grows. Shaded and capped give the
// height of a stack too tall to sow. None casts a shadow.
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
  if (stack.length >= UNSOWABLE) top.label = String(stack.length);
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
  if (n < UNSOWABLE) return [tile, ...plainStack(id, stack)];
  // Room for the height on the right: the pile moves left and narrows.
  const bars = plainStack(id, stack, { x: -0.1, width: 0.5 });
  const top = bars[n - 1];
  top.label = String(n);
  top.bar = { ...top.bar, labelX: 0.33, labelY: 0, labelSize: 0.24 };
  return [tile, ...bars];
}

const STACK_DRAWERS = { shaded: shadedStack, capped: cappedStack, plain: plainStack };

// The hex-hex corners that score: those in directions NE, W and SE (DIRS6).
const HEX_SCORING = [1, 3, 5];

function buildBoard({ shape, size }) {
  let board, corners;
  if (shape === "hexagon") {
    board = hexHexBoard(size);
    const m = size - 1;
    corners = HEX_SCORING.map((d) => board.cells.find((c) => c.coord.q === m * DIRS6[d][0] && c.coord.r === m * DIRS6[d][1]));
  } else {
    board = triangleBoard(size);
    corners = board.cells.filter((c) => c.tags.edges.length === 2);
  }
  for (const c of corners) c.tags.scoring = true;
  board.corners = corners.map((c) => c.id);
  return board;
}

// Corner marks (optional decor): a line just off each scoring corner's outer
// edges, those facing within 60 degrees of straight out from the board's
// centre, with the run's two end edges kept only on their half nearer the
// corner. On a triangle it is a chevron round the corner's point; on a
// hexagon, an open trapezoid round the corner's flat side.
const MARK_GAP = 0.16, MARK_WIDTH = 0.07;

function cornerMarks(board) {
  const n = board.cells.length;
  const ox = board.cells.reduce((a, c) => a + c.x, 0) / n;
  const oy = board.cells.reduce((a, c) => a + c.y, 0) / n;
  const segments = [];
  for (const id of board.corners) {
    const c = board.cells[id];
    const ux = c.x - ox, uy = c.y - oy, ul = Math.hypot(ux, uy);
    // The cell scaled about its centre so its edges stand MARK_GAP further out
    // (the inradius of a unit hexagon is sqrt(3) / 2).
    const k = 1 + MARK_GAP / (Math.sqrt(3) / 2);
    const v = c.poly.map(([x, y]) => [c.x + (x - c.x) * k, c.y + (y - c.y) * k]);
    const out = (e) => {
      const [a, b] = [c.poly[e], c.poly[(e + 1) % 6]];
      const mx = (a[0] + b[0]) / 2 - c.x, my = (a[1] + b[1]) / 2 - c.y;
      return (mx * ux + my * uy) / (Math.hypot(mx, my) * ul) > 0.49;   // within 60 degrees
    };
    // The outward edges run consecutively round the cell: start after a gap.
    const first = [0, 1, 2, 3, 4, 5].find((e) => out(e) && !out((e + 5) % 6));
    const run = [];
    for (let e = first; out(e); e = (e + 1) % 6) run.push([v[e], v[(e + 1) % 6]]);
    const half = ([a, b], keepEnd) => {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      return keepEnd ? [m, b] : [a, m];
    };
    run[0] = half(run[0], true);
    run[run.length - 1] = half(run[run.length - 1], false);
    segments.push(...run);
  }
  return segments;
}

// ---- what the roll allows --------------------------------------------------

const difference = (s) => Math.abs(s.dice[0] - s.dice[1]);
const caps = (s, id, player = s.turn) => s.stacks[id].length > 0 && s.tops[id] === player;

// The mover's options for the roll: { kind: "place" | "sow" | "cap", ids }:
// vacant cells to place on, stacks to sow, or stacks to cap. No ids: no move.
function turnOptions(s) {
  const k = difference(s);
  const vacant = [], mine = [], sowable = [];
  for (let id = 0; id < s.stacks.length; id++) {
    if (!s.stacks[id].length) vacant.push(id);
    else if (caps(s, id)) {
      mine.push(id);
      if (s.stacks[id].length === k) sowable.push(id);
    }
  }
  if (k && sowable.length) return { kind: "sow", ids: sowable };
  if (k && mine.length) return { kind: "cap", ids: mine };
  return { kind: "place", ids: vacant };
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

const cornersOf = (s, player) => s.board.corners.filter((id) => caps(s, id, player)).length;

// ---- moves -----------------------------------------------------------------

// Once both dice are rolled: with no legal move the game is over.
function checkStuck(s) {
  if (turnOptions(s).ids.length) return;
  const black = cornersOf(s, BLACK), white = cornersOf(s, WHITE);
  s.over = true;
  s.winner = black > white ? BLACK : white > black ? WHITE : 0;
}

function endTurn(s) {
  s.turns++;
  s.dice = [0, 0];
  s.phase = "roll";
  s.turn = 3 - s.turn;
  // White's first turn opens with the swap decision when the rule is on.
  if (s.swapRule && s.turns === 1) s.phase = "ready";
}

// A new checker for the mover: placed on a vacant cell or capping a stack.
function put(s, id) {
  s.stacks[id].push(s.turn);
  s.tops[id] = s.turn;
}

// Lift the stack, leave a new checker on its cell, then drop the lifted ones.
function sow(s, path) {
  const { stacks, tops } = s;
  const lifted = stacks[path[0]];
  stacks[path[0]] = [s.turn];
  tops[path[0]] = s.turn;
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
    if (s.dice[1]) {
      s.phase = "move";
      checkStuck(s);
    }
    return null;
  }
  const mover = s.turn;
  if (move.length === 1) put(s, move[0]);
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
  const { kind } = turnOptions(s);
  if (!k) return `${rolled}: place a checker on a vacant cell.`;
  if (kind === "sow") return `${rolled}: sow a stack of ${k}, leaving a checker behind.`;
  if (kind === "cap") return `${rolled}, but caps no stack of ${k}: cap one of your stacks.`;
  return `${rolled}, but caps no stack: place a checker on a vacant cell.`;
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
    size: { label: "Board side", choices: SIZES, default: 7, allowed: sizeAllowed },
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
  optionalDecor: "Corner marks",

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
      over: false,            // set when the player to move has no legal move
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
    if (s.over) return [];
    if (s.phase === "roll") return rollOutcomes(DIE).map((o) => o.move);
    if (s.phase === "ready") return [KEEP];
    const { kind, ids } = turnOptions(s);
    if (kind === "sow") return ids.flatMap((id) => sowPaths(s.board, id, s.stacks[id].length));
    return ids.map((id) => [id]);
  },
  applyMove: apply,
  // The swap: every checker changes colour (the board is symmetric), and the
  // other player rolls next.
  swapColours(s) {
    for (let id = 0; id < s.stacks.length; id++) {
      s.stacks[id] = s.stacks[id].map((p) => 3 - p);
      if (s.tops[id]) s.tops[id] = 3 - s.tops[id];
    }
    s.turn = 3 - s.turn;
    s.phase = "roll";
  },
  outcome(s) {
    return s.over ? { winner: s.winner } : null;
  },

  // Random rollouts without move lists: a sow is a random walk that never
  // steps straight back (every cell has at least two neighbours).
  playout(s, rng) {
    const { board, stacks } = s;
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const die = () => 1 + Math.floor(rng() * DIE);
    while (!s.over) {
      // Keep any die already rolled; never swap.
      if (s.phase !== "move") {
        s.dice = [s.dice[0] || die(), die()];
        s.phase = "move";
        checkStuck(s);
        if (s.over) break;
      }
      const { kind, ids } = turnOptions(s);
      const id = pick(ids);
      if (kind === "sow") {
        const path = [id];
        let prev = -1;
        while (path.length <= stacks[id].length) {
          const cur = path[path.length - 1];
          path.push(pick(board.neighbours[cur].filter((n) => n !== prev)));
          prev = cur;
        }
        sow(s, path);
      } else {
        put(s, id);
      }
      endTurn(s);
    }
    return s.winner;
  },

  // The dice stay up at the end, showing the roll that left no move.
  chanceView(s) {
    if (s.phase === "ready") return [];
    const result = s.dice[1] ? `difference ${difference(s)}` : null;
    return [dicePanel(s.dice.map((v) => v || null), { title: "Dice", owner: s.turn, active: !s.over && s.phase === "roll", result })];
  },
  boardDecor(board) {
    return [{ segments: cornerMarks(board), stroke: "#111", width: MARK_WIDTH, optional: true }];
  },
  piecesOf(s, style) {
    const out = [];
    s.stacks.forEach((stack, id) => {
      if (stack.length) out.push(...(STACK_DRAWERS[style] || shadedStack)(id, stack));
    });
    // Flat on the board: no drop shadows.
    return out.map((p) => ({ ...p, shadow: false }));
  },
  // Outlines on the cells of the last move, and dots on the stacks the roll
  // lets the mover sow or cap.
  markers(s) {
    const out = [];
    if (s.last) for (const id of new Set(s.last)) out.push({ id, kind: "square" });
    if (!s.over && s.phase === "move") {
      const { kind, ids } = turnOptions(s);
      if (kind !== "place") {
        for (const id of ids) {
          // The dot goes under a short pile, clear of the bars.
          const h = s.stacks[id].length;
          out.push({ id, kind: "target", y: h > 1 && h < 5 ? cappedPile(h) / 2 + 0.13 : 0 });
        }
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
  scoreSummary(s, player) {
    const n = cornersOf(s, player);
    return { main: String(n), sub: n === 1 ? "corner" : "corners", title: `${PLAYERS[player].name} caps ${n} of the 3 corners` };
  },
  outcomeLines(s) {
    const name = PLAYERS[s.turn].name;
    const full = s.stacks.every((st) => st.length);
    const why = full && !difference(s) ? `The board is full and ${name} rolled a double.` : `${name} has no legal move.`;
    return [why, ...[BLACK, WHITE].map((p) => `${PLAYERS[p].name} caps ${cornersOf(s, p)} of the 3 corners.`)];
  },
  turnHint(s) {
    return s.over ? "" : hint(s);
  },
}, {
  // Offered at White's decision before the first roll.
  offer: (s) => s.phase === "ready",
});

export const internals = { turnOptions, sowPaths, cornersOf, cornerMarks };
