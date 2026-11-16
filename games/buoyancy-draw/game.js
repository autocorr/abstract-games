// Buoyancy: stacks moved with actions won by drawing marbles from a bag.
// Pure: no DOM.
//
// Board: a 6x6 chessboard turned clockwise by 45 degrees, a diamond with a1
// on the left, f1 at the bottom, f6 on the right and a6 at the top. White
// plays from the bottom and moves first: White's two edges are the lower
// ones (rank 1 and the f file), Black's the upper ones (the a file and rank
// 6); the side corners a1 and f6 lie on both
// players' edges. Each player's 15 checkers start one per cell on the five
// rows of cells nearest their bottom or top corner; their house, where men
// from reserve are placed, is the nearest three of those rows (6 cells). The
// middle row starts empty.
//
// Checkers stack. Each cell holds a stack, listed bottom to top; whoever has
// the top checker controls it. A stack holding any of the opponent's checkers
// carries captured men and moves backwards (towards its controller's edges);
// any other stack, a single checker, moves forwards. A step is diagonal on
// screen (orthogonal on the chessboard), so a stack has two steps open to it.
//
// The bag: one shared bag, by default 15 white and 5 black marbles (both
// counts are options). A turn starts by drawing marbles one at a time (chance
// plies, "draw:W" / "draw:B"; see common/bag.js) until a black one comes out.
// Drawn marbles stay out, so the bag runs down over the turns; once it is
// empty every marble goes back in and drawing goes on.
//
// Each white marble drawn is one action, and the player must take them all:
// the turn ends once none is left, or early only when no action is
// possible. An action is one of:
//   - a step: [from, to], a stack the player controls one step onto a cell
//     that is vacant or the opponent's (capping it), not their own;
//   - bearing off: [from], a stack carrying captured men steps off the board
//     past one of its controller's edges (on screen, click it twice). The
//     opponent's checkers in it are captured (they go to the controller's
//     score), and the controller's own go to their reserve;
//   - a surrender: [from], a single checker steps off past the opponent's
//     edge, allowed only when it has no forward step open on the board; the
//     opponent captures it;
//   - a placement: [id], a man from the player's reserve onto a cell of their
//     house that is vacant or holds an opposing stack (capping it). With
//     every house cell their own, the men wait.
// A [from] move starts on the player's own stack and a placement on a cell
// they do not control, so the two never collide.
//
// A player loses when all 15 of their checkers are captured, or as soon as
// they control no stack and have no man in reserve: every man they have left
// lies under the opponent's caps. When neither player has any action
// possible, the game is a draw (in practice never).

import { makeBoard } from "../../common/board/graph.js";
import { CHANCE, cachedBoards } from "../../common/engine.js";
import { makeBag, cloneBag, drawOutcomes, drawMarble, drawnColour, returnDrawn, bagSize, bagPanel } from "../../common/bag.js";
import { stackDrawer, stackStyles, STACK_SHADES } from "../../common/stacks.js";

// White plays from the bottom and moves first.
const WHITE = 1, BLACK = 2;
const PLAYERS = {
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff" },
};
const MARBLES = {
  W: { name: "white", fill: "#f2f2f0" },
  B: { name: "black", fill: "#202329" },
};
const N = 6;            // the chessboard's side
const CHECKERS = 15;    // each player's
const START_ROWS = 5;   // rows of single checkers at the start
const HOUSE_ROWS = 3;   // rows of the house, where men from reserve are placed
const OFF = -1;         // a step past an edge

const colorSchemes = {
  brown: { name: "Brown", cellFill: (c) => (c.tags.dark ? "#b58863" : "#f0d9b5") },
  blue: { name: "Blue", cellFill: (c) => (c.tags.dark ? "#8ca2ad" : "#dee3e6") },
};

// Stacks are drawn as Broadcast draws them (common/stacks.js), a little
// smaller to fit a diamond, with heights from five checkers up; the cell
// shades follow the colours, White being player 1 here.
const piles = stackDrawer({ scale: 0.85, labelFrom: 5, shades: { [WHITE]: STACK_SHADES[2], [BLACK]: STACK_SHADES[1] } });

// ---- the board -------------------------------------------------------------

// Steps as (file, rank) changes and on screen: up-right (rank + 1), up-left
// (file - 1), down-right (file + 1), down-left (rank - 1).
const STEPS = [[0, 1], [-1, 0], [1, 0], [0, -1]];
// Forward and backward steps by player: White moves up, Black down.
const FORWARD = { [WHITE]: [0, 1], [BLACK]: [2, 3] };
const BACKWARD = { [WHITE]: [2, 3], [BLACK]: [0, 1] };

// Half a square's diagonal: column and height units on screen.
const K = Math.SQRT1_2;

const inside = (f, r) => f >= 0 && f < N && r >= 0 && r < N;

// Square (file f, rank r), id r * N + f: column f + r, height r - f.
function buildBoard() {
  const specs = [];
  for (let r = 0; r < N; r++) {
    for (let f = 0; f < N; f++) {
      const y = r - f;
      const X = (f + r) * K, Y = -y * K;
      const side = (rows) => (y <= -(N - rows) ? WHITE : y >= N - rows ? BLACK : 0);
      const house = side(HOUSE_ROWS), start = side(START_ROWS);
      specs.push({
        x: X, y: Y,
        poly: [[X, Y - K], [X + K, Y], [X, Y + K], [X - K, Y]],
        coord: { file: f, rank: r, start },
        tags: { name: `${String.fromCharCode(97 + f)}${r + 1}`, dark: (f + r) % 2 === 0, house },
      });
    }
  }
  const board = makeBoard(specs);
  board.size = board.cells.length;
  board.steps = board.cells.map(({ coord: { file, rank } }) =>
    STEPS.map(([df, dr]) => (inside(file + df, rank + dr) ? (rank + dr) * N + file + df : OFF)));
  board.house = { [WHITE]: [], [BLACK]: [] };
  board.start = { [WHITE]: [], [BLACK]: [] };
  for (const c of board.cells) {
    if (c.tags.house) board.house[c.tags.house].push(c.id);
    if (c.coord.start) board.start[c.coord.start].push(c.id);
  }
  return board;
}

// ---- the rules -------------------------------------------------------------

const other = (p) => 3 - p;

// Whether the stack holds checkers of the player other than `owner`.
const carries = (stack, owner) => stack.some((p) => p !== owner);

// Moves of the stack on `id`: [id, to] onto open squares, and [id] off the
// board as the rules allow (bearing off always; surrendering only when
// blocked).
function stackMoves(s, id) {
  const { board, tops } = s;
  const p = tops[id];
  const homeward = carries(s.stacks[id], p);
  const out = [];
  let edge = false;
  for (const d of (homeward ? BACKWARD : FORWARD)[p]) {
    const to = board.steps[id][d];
    if (to === OFF) edge = true;
    else if (tops[to] !== p) out.push([id, to]);
  }
  if (edge && (homeward || !out.length)) out.push([id]);
  return out;
}

// Cells of the player's house a man from reserve may be placed on: vacant,
// or holding an opposing stack.
const entries = (s, player) => s.board.house[player].filter((id) => s.tops[id] !== player);

// Every action open to the player: stack moves, then placements.
function actions(s, player) {
  const out = [];
  for (let id = 0; id < s.board.size; id++) if (s.tops[id] === player) out.push(...stackMoves(s, id));
  if (s.reserve[player]) for (const id of entries(s, player)) out.push([id]);
  return out;
}

const canAct = (s, player) => actions(s, player).length > 0;

const controls = (s, player) => s.tops.includes(player);

function finish(s, winner, reason) {
  s.over = true;
  s.winner = winner;
  s.reason = reason;
}

// Move a stack one step, or off the board. Returns what left the board:
// { scored, saved } (a stack borne off) or { lost } (a single surrendered),
// or {}.
function step(s, [from, to]) {
  const p = s.turn;
  const moving = s.stacks[from];
  s.stacks[from] = [];
  s.tops[from] = 0;
  if (to !== undefined) {
    s.stacks[to] = s.stacks[to].length ? s.stacks[to].concat(moving) : moving;
    s.tops[to] = p;
    return {};
  }
  if (!carries(moving, p)) {
    s.score[other(p)] += moving.length;
    return { lost: moving.length };
  }
  const saved = moving.filter((q) => q === p).length;
  s.score[p] += moving.length - saved;
  s.reserve[p] += saved;
  return { scored: moving.length - saved, saved };
}

// A man from reserve onto `id`, capping any stack there.
function place(s, id) {
  s.reserve[s.turn]--;
  s.stacks[id] = s.stacks[id].concat([s.turn]);
  s.tops[id] = s.turn;
}

// The game ends once a player has lost all 15 men, or controls no stack
// with none in reserve.
function checkEnd(s) {
  const p = s.turn, q = other(p);
  if (s.score[p] >= CHECKERS) finish(s, p, "captured");
  else if (s.score[q] >= CHECKERS) finish(s, q, "captured");
  else if (!controls(s, q) && !s.reserve[q]) finish(s, p, "buried");
  else if (!controls(s, p) && !s.reserve[p]) finish(s, q, "buried");
}

// Next player's turn, starting with a draw. When neither player has any
// action possible, the game is drawn.
function endTurn(s) {
  s.turns++;
  s.actions = 0;
  s.drew = 0;
  s.phase = "draw";
  const next = other(s.turn);
  if (!canAct(s, next) && !canAct(s, s.turn)) {
    s.turn = next;
    finish(s, 0, "blocked");
    return;
  }
  s.turn = next;
}

// After a draw or an action: keep drawing, act, or end the turn.
function advance(s) {
  if (s.over || s.phase === "draw") return;
  if (!s.actions || !canAct(s, s.turn)) endTurn(s);
}

function apply(s, move) {
  const p = s.turn;
  if (s.phase === "draw") {
    const colour = drawMarble(s.bag, move);
    const refilled = !bagSize(s.bag);
    if (refilled) returnDrawn(s.bag);
    if (colour === "W") {
      s.actions++;
      s.drew++;
    } else {
      s.phase = "act";
      advance(s);
    }
    return { refilled };
  }
  s.last = move.slice();
  let info = { player: p };
  s.actions--;
  if (move.length === 1 && s.tops[move[0]] !== p) {
    place(s, move[0]);
    info.placed = true;
  } else info = { ...info, ...step(s, move) };
  checkEnd(s);
  advance(s);
  return info;
}

// ---- rollouts --------------------------------------------------------------

// Rollout settings: the share of random actions, the turns played before
// the position is scored, and the lead in men that gives about 3:1 odds.
// Tuned in self-play at 100 ms a move: this beats plain MCTS (random
// rollouts to the end) in 86% of games, and 6 turns at scale 3 in 70%.
// Without random actions it beat the latter as well but plain MCTS less
// often.
const tune = { random: 0.2, turns: 3, scale: 1.5 };

// White's lead in men: captured ones, and half of those held under caps.
function materialLead(s) {
  let lead = s.score[WHITE] - s.score[BLACK];
  for (let id = 0; id < s.board.size; id++) {
    const st = s.stacks[id];
    if (st.length < 2) continue;
    const top = s.tops[id];
    let held = 0;
    for (const q of st) if (q !== top) held++;
    lead += (top === WHITE ? 0.5 : -0.5) * held;
  }
  return lead;
}

// How much a rollout likes an action: bearing off (more for more captured),
// then capping (more for taller stacks), then placing, then stepping, and
// surrendering last.
function actionValue(s, m) {
  const p = s.turn;
  const [from, to] = m;
  if (m.length === 1) {
    if (s.tops[from] !== p) return s.tops[from] ? 60 + s.stacks[from].length : 20;   // placing
    const caught = s.stacks[from].length - s.stacks[from].filter((q) => q === p).length;
    return caught ? 100 + caught : -50;   // bearing off, or surrendering
  }
  return s.tops[to] ? 50 + s.stacks[to].length : 0;
}

function greedyAction(s, moves, rng) {
  let best = -Infinity, ties = 0, choice = null;
  for (const m of moves) {
    const v = actionValue(s, m);
    if (v > best) { best = v; ties = 1; choice = m; }
    else if (v === best && rng() * ++ties < 1) choice = m;
  }
  return choice;
}

// ---- text ------------------------------------------------------------------

const name = (p) => PLAYERS[p].name;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function hint(s) {
  const who = name(s.turn);
  if (s.phase === "draw") {
    return `${who} draws marbles until a black one: ${plural(s.drew, "white")} so far…`;
  }
  const can = [];
  const moves = actions(s, s.turn);
  if (moves.some((m) => s.tops[m[0]] === s.turn)) can.push("move a stack");
  if (s.reserve[s.turn] && moves.some((m) => s.tops[m[0]] !== s.turn)) can.push(`place a man from your reserve (${s.reserve[s.turn]})`);
  const off = moves.some((m) => m.length === 1 && s.tops[m[0]] === s.turn) ? " Click a stack twice to step it off the board." : "";
  return `${who}: ${plural(s.actions, "action")} left: ${can.join(", or ")}.${off}`;
}

export default {
  id: "buoyancy-draw",
  title: "Buoyancy",
  url: import.meta.url,
  players: PLAYERS,
  options: {
    whites: { label: "White marbles", choices: [5, 10, 15, 20, 30], default: 15 },
    blacks: { label: "Black marbles", choices: [1, 3, 5, 8, 10], default: 5 },
  },
  colorSchemes,
  marbles: MARBLES,
  pieceStyles: stackStyles,
  pieceLabels: "Stack heights",

  createBoard: cachedBoards(() => "board", buildBoard),
  initialState(board, opts) {
    const stacks = Array.from({ length: board.size }, () => []);
    const tops = new Uint8Array(board.size);
    for (const p of [WHITE, BLACK]) {
      for (const id of board.start[p]) {
        stacks[id] = [p];
        tops[id] = p;
      }
    }
    return {
      board,
      stacks,                 // bottom to top
      tops,                   // owner of each top checker, 0 for vacant
      bag: makeBag({ W: opts.whites, B: opts.blacks }),
      turn: WHITE,
      phase: "draw",          // "draw" (chance, one ply per marble), "act"
      drew: 0,                // white marbles drawn this turn
      actions: 0,             // actions left this turn
      reserve: [0, 0, 0],     // men borne home and waiting to be placed, by player
      score: [0, 0, 0],       // the opponent's checkers captured, by player
      last: null,             // the last action's cells
      turns: 0,
      over: false,
      winner: 0,
      reason: null,           // "captured", "buried" or "blocked", once over ("estimated": an AI rollout cut short)
    };
  },
  clone(s) {
    return {
      ...s,
      stacks: s.stacks.map((st) => st.slice()),
      tops: s.tops.slice(),
      bag: cloneBag(s.bag),
      reserve: s.reserve.slice(),
      score: s.score.slice(),
      last: s.last && s.last.slice(),
    };
  },
  toMove(s) {
    return s.phase === "draw" ? CHANCE : s.turn;
  },
  currentPlayer(s) {
    return s.turn;
  },
  chances(s) {
    return drawOutcomes(s.bag);
  },
  legalMoves(s) {
    if (s.over) return [];
    if (s.phase === "draw") return drawOutcomes(s.bag).map((o) => o.move);
    return actions(s, s.turn);
  },
  applyMove: apply,
  outcome(s) {
    return s.over ? { winner: s.winner } : null;
  },

  // Rollouts for the AI. Random play is very weak here (a greedy player
  // beats it almost every game), and whole games are mostly luck of the
  // draw, so rollouts play greedily (bear off the richest stack, else cap
  // the tallest, else place, else step; surrender last) for a few turns and
  // then score the position (see tune).
  playout(s, rng) {
    const stop = tune.turns ? s.turns + tune.turns : Infinity;
    while (!s.over) {
      if (s.turns >= stop) {
        // Score the position: captures, and men held under caps at half
        // value; the winner is drawn by how far ahead White is. The rollout's
        // copy of the game is ended with that winner (the search discards it).
        const lead = materialLead(s);
        finish(s, rng() < 1 / (1 + Math.exp(-lead / tune.scale)) ? WHITE : BLACK, "estimated");
        break;
      }
      if (s.phase === "draw") {
        const n = bagSize(s.bag);
        apply(s, rng() * n < s.bag.counts.W ? "draw:W" : "draw:B");
        continue;
      }
      const moves = actions(s, s.turn);
      apply(s, rng() < tune.random ? moves[Math.floor(rng() * moves.length)] : greedyAction(s, moves, rng));
    }
    return s.winner;
  },

  chanceView(s) {
    return [{ ...bagPanel(s.bag, { title: "Bag", active: !s.over && s.phase === "draw" }), owner: s.turn }];
  },
  piecesOf(s, style) {
    return piles.piecesOf(s.stacks, style);
  },
  // Outlines on the cells of the last action, and dots on the stacks that
  // can move and the cells open to a man from reserve.
  markers(s) {
    const out = [];
    if (s.last) for (const id of s.last) out.push({ id, kind: "square" });
    if (s.over || s.phase !== "act") return out;
    for (const id of new Set(actions(s, s.turn).map(([from]) => from))) {
      const h = s.stacks[id].length;
      out.push({ id, kind: "target", y: h > 1 && h < 5 ? piles.cappedPile(h) / 2 + 0.11 : 0 });
    }
    return out;
  },
  moveText(s, move, info) {
    const cell = (id) => s.board.cells[id].tags.name;
    if (typeof move === "string") {
      const colour = drawnColour(move);
      const refill = info && info.refilled ? " (bag refilled)" : "";
      return colour === "W" ? `drew white${refill}` : `drew black: ${plural(s.drew, "action")}${refill}`;
    }
    if (move.length === 2) return `${cell(move[0])}–${cell(move[1])}`;
    if (s.tops[move[0]] !== s.turn) return `placed ${cell(move[0])}`;
    const what = !info ? "" : info.lost ? ", surrendered"
      : info.scored != null ? `: ${info.scored} captured, ${plural(info.saved, "man", "men")} to reserve` : "";
    return `${cell(move[0])} off${what}`;
  },
  scoreSummary(s, player) {
    const n = s.score[player], r = s.reserve[player];
    return {
      main: String(n),
      sub: r ? `captured · ${r} in reserve` : "captured",
      title: `${name(player)} has captured ${n} of ${name(other(player))}'s ${CHECKERS} checkers` +
        (r ? `, and has ${plural(r, "man", "men")} in reserve` : ""),
    };
  },
  outcomeLines(s, outcome) {
    const w = outcome.winner;
    const scores = [WHITE, BLACK].map((p) => `${name(p)} captured ${s.score[p]}.`);
    if (s.reason === "captured") return [`${name(w)} captured all ${CHECKERS} of ${name(other(w))}'s checkers.`];
    if (s.reason === "buried") return [`${name(other(w))} controls no stack and has no man in reserve: every man they have left is under ${name(w)}'s caps.`, ...scores];
    return ["Neither player has any action possible.", ...scores];
  },
  turnHint(s) {
    return s.over ? "" : hint(s);
  },
};

export const internals = { actions, stackMoves, entries, canAct, materialLead, tune };
