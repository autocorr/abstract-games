// Runaway (work in progress): chickens move and leave eggs behind, which
// hatch into chickens that move in turn. Pure: no DOM.
//
// Hex-hex board. Each player starts with chickens on corners: one each on
// opposite corners, or three each on alternating corners. White moves first.
//
// A turn moves one chicken [from, to]:
//   - It may land on an empty cell nobody owns, claiming it: with Step
//     movement a neighbouring cell, with Slide any distance in one of the
//     six directions over empty cells.
//   - Or it may capture an opposing chicken on a neighbouring cell, claiming
//     that cell. (Captures are not made at range: on a hex-hex board every
//     pair of adjacent or opposite corners shares a line, so a sliding
//     capture would take a chicken on the first move.) Eggs (of either
//     player) cannot be captured and block slides; an owned empty cell (left
//     by a capture) can be passed over but not landed on.
//   - A plain move lays an egg of the mover's on the cell left behind, which
//     stays theirs. A capture lays no egg.
//   - An egg is laid showing the hatch time (3 by default). At the start of
//     each of its owner's turns it counts down by one, and at 0 it hatches
//     into a chicken that can move that turn.
// A player with no move passes ("pass"). The game ends when neither player
// has a move or an egg. A player left with no chicken and no egg loses at
// once; otherwise the player owning more cells wins (equal: a draw).
//
// Termination: with U the unowned cells and P the pieces on the board,
// 2U + P falls by one on every move (a plain move claims a cell and adds an
// egg; a capture removes a chicken and adds nothing), and passes are bounded
// by the eggs' countdowns.

import { hexHexBoard } from "../../common/board/hex.js";
import { cachedBoards } from "../../common/engine.js";
import { withSwap } from "../../common/swap.js";
import { WHITE_TRIANGLE, BLACK_TRIANGLE } from "../../common/pieces/triangles.js";

const WHITE = 1, BLACK = 2;
const PLAYERS = {
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff" },
};
const PASS = "pass";
const SIZES = [4, 5, 6, 7];
const IMAGES = { [WHITE]: WHITE_TRIANGLE, [BLACK]: BLACK_TRIANGLE };
// Owned cells are shaded as tiles in their owner's tone over the sand board.
const TERRITORY = { [WHITE]: "#fff4de", [BLACK]: "#b08a5c" };
const EGG_SIZE = 0.62;

const other = (p) => 3 - p;

// Corner cells in order round the board: [m,0], [m,-m], [0,-m], [-m,0], [-m,m], [0,m].
function corners(board) {
  const m = board.side - 1;
  return [[m, 0], [m, -m], [0, -m], [-m, 0], [-m, m], [0, m]].map(([q, r]) => board.at(q, r));
}

function buildBoard(side) {
  const board = hexHexBoard(side);
  board.corners = corners(board);
  return board;
}

// ---- moves ---------------------------------------------------------------


// The moves [from, to] of `p`'s chickens.
function generateMoves(s, p) {
  const { board, who, egg } = s;
  const out = [];
  const slide = s.slide;
  for (let from = 0; from < who.length; from++) {
    if (who[from] !== p || egg[from]) continue;
    for (let d = 0; d < 6; d++) {
      let id = board.step(from, d);
      if (id < 0) continue;
      if (who[id]) {
        if (who[id] !== p && !egg[id]) out.push([from, id]);   // a capture
        continue;
      }
      while (id >= 0 && !who[id]) {
        if (!s.owner[id]) out.push([from, id]);
        if (!slide) break;
        id = board.step(id, d);
      }
    }
  }
  return out;
}

const hasEggs = (s, p) => s.egg.some((e, id) => e && s.who[id] === p);
const hasPieces = (s, p) => s.who.some((w) => w === p);

// Hand the turn to `p`: their eggs count down and hatch at 0.
function startTurn(s, p) {
  s.turn = p;
  for (let id = 0; id < s.egg.length; id++) {
    if (s.egg[id] && s.who[id] === p) s.egg[id]--;
  }
  settle(s);
}

// Work out the moves of the player to move, a pass, or the end of the game.
function settle(s) {
  const p = s.turn;
  s.moves = generateMoves(s, p);
  if (s.moves.length) return;
  if (hasEggs(s, p) || hasEggs(s, other(p)) || generateMoves(s, other(p)).length) {
    s.moves = [PASS];
    return;
  }
  s.moves = [];
  finish(s);
}

function finish(s, annihilated = 0) {
  s.over = true;
  if (annihilated) {
    s.winner = other(annihilated);
    s.reason = "annihilated";
    return;
  }
  const [w, b] = [territory(s, WHITE), territory(s, BLACK)];
  s.winner = w > b ? WHITE : b > w ? BLACK : 0;
  s.reason = "territory";
}

function territory(s, p) {
  let n = 0;
  for (const o of s.owner) if (o === p) n++;
  return n;
}

function apply(s, move) {
  const p = s.turn;
  let info = { capture: false };
  if (move === PASS) {
    s.last = null;
  } else {
    const [from, to] = move;
    info.capture = s.who[to] === other(p);
    s.who[to] = p;
    s.egg[to] = 0;
    s.owner[to] = p;
    if (info.capture) {
      s.who[from] = 0;
    } else {
      s.egg[from] = s.hatch;   // who[from] and owner[from] stay p
    }
    s.last = [from, to];
    if (info.capture && !hasPieces(s, other(p))) {
      s.moves = [];
      finish(s, other(p));
      return info;
    }
  }
  startTurn(s, other(p));
  return info;
}

// ---- game ----------------------------------------------------------------

const ON_OFF = [{ value: "on", label: "On" }, { value: "off", label: "Off" }];

export default withSwap({
  id: "runaway",
  title: "Runaway",
  url: import.meta.url,
  players: PLAYERS,
  options: {
    size: { label: "Board side", choices: SIZES, default: 5 },
    start: {
      label: "Chickens each",
      choices: [{ value: 1, label: "1" }, { value: 3, label: "3" }],
      default: 3,
    },
    movement: {
      label: "Movement",
      choices: [{ value: "slide", label: "Slide" }, { value: "step", label: "Step" }],
      default: "slide",
    },
    hatch: { label: "Hatch after", choices: [2, 3, 4], default: 3 },
    swap: { label: "Swap rule", choices: ON_OFF, default: "on" },
  },
  moveLabels: { [PASS]: "Pass" },
  colorSchemes: { sand: { name: "Sand", cellFill: () => "#ffd890" } },

  createBoard: cachedBoards((o) => o.size, ({ size }) => buildBoard(size)),
  initialState(board, { start, movement, hatch, swap }) {
    const n = board.size;
    const s = {
      board,
      who: new Uint8Array(n),     // the player whose chicken or egg is on a cell
      egg: new Uint8Array(n),     // an egg's countdown (0: a chicken, or empty)
      owner: new Uint8Array(n),   // the cell's owner, 0 for none
      turn: WHITE,
      moves: null,
      last: null,
      slide: movement === "slide",
      hatch,
      swapRule: swap === "on",
      over: false,
      winner: null,
      reason: null,
    };
    const picks = start === 1 ? [0, 3] : [0, 1, 2, 3, 4, 5];
    picks.forEach((k, i) => {
      const id = board.corners[k];
      s.who[id] = s.owner[id] = i % 2 ? BLACK : WHITE;
    });
    startTurn(s, WHITE);
    return s;
  },
  clone(s) {
    return { ...s, who: s.who.slice(), egg: s.egg.slice(), owner: s.owner.slice(), moves: s.moves && s.moves.slice() };
  },
  toMove(s) {
    return s.turn;
  },
  legalMoves(s) {
    if (s.over) return [];
    return s.moves;
  },
  applyMove: apply,
  swapColours(s) {
    for (let id = 0; id < s.who.length; id++) {
      if (s.who[id]) s.who[id] = other(s.who[id]);
      if (s.owner[id]) s.owner[id] = other(s.owner[id]);
    }
    s.turn = other(s.turn);
    settle(s);
  },
  outcome(s) {
    return s.over ? { winner: s.winner } : null;
  },

  // Territory as tiles, then chickens (triangles) and eggs (discs showing
  // their countdown).
  piecesOf(s) {
    const out = [];
    for (let id = 0; id < s.owner.length; id++) {
      if (s.owner[id]) out.push({ id, player: null, fill: TERRITORY[s.owner[id]], tile: true });
    }
    for (let id = 0; id < s.who.length; id++) {
      const p = s.who[id];
      if (!p) continue;
      if (s.egg[id]) out.push({ id, player: p, size: EGG_SIZE, label: String(s.egg[id]) });
      else out.push({ id, player: p, image: IMAGES[p] });
    }
    return out;
  },
  markers(s) {
    return s.last ? s.last.map((id) => ({ id, kind: "square" })) : [];
  },
  moveText(s, move, info) {
    if (!Array.isArray(move)) return null;
    const name = (id) => s.board.cells[id].tags.name;
    return `${name(move[0])}${info.capture ? "×" : "–"}${name(move[1])}`;
  },
  turnHint(s) {
    if (s.over) return "";
    const name = PLAYERS[s.turn].name;
    if (s.moves[0] === PASS) return `${name} has no move and must pass.`;
    return `${name} to move a chicken.`;
  },
  scoreSummary(s, p) {
    let chickens = 0, eggs = 0;
    for (let id = 0; id < s.who.length; id++) {
      if (s.who[id] !== p) continue;
      if (s.egg[id]) eggs++; else chickens++;
    }
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    return { main: territory(s, p), sub: `${plural(chickens, "chicken")}, ${plural(eggs, "egg")}`, title: "Cells owned" };
  },
  outcomeLines(s) {
    if (s.reason === "annihilated") return [`${PLAYERS[other(s.winner)].name} has no chickens or eggs left.`];
    const [w, b] = [territory(s, WHITE), territory(s, BLACK)];
    return [`Cells owned: White ${w}, Black ${b}.`];
  },
}, {
  offer: (s) => s.swapRule && s.turn === BLACK,
});

export const internals = { generateMoves, settle, territory };
