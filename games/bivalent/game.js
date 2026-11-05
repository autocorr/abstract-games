// Bivalent: score lines of four, avoid lines of three. Pure: no DOM.
//
// 7x7 Go-style points board, White first. A turn is a marble draw (a chance
// ply, "draw:G" or "draw:R"; see common/bag.js) and then one stone placed on
// an empty point ([id]):
//
//   - Gray: place a stone of your colour; the marble goes back in the bag.
//   - Red: place a neutral red stone; the marble is set aside.
//
// Scoring, after the placement: red stones count as the mover's colour. In
// each of the 4 directions, take the maximal run of the mover's stones and
// red stones through the placed stone and through every red stone on the
// board. A run of exactly 4 scores 1 for the mover, exactly 3 scores 1 for
// the opponent, and 5 or more scores nothing. Every red stone in a run of 3
// or 4 becomes the mover's colour, and its marble goes back in the bag.
//
// Red stones are rescored every turn because they change sides: a red stone
// that completes the opponent's three scores against them on their turn,
// wherever they play. No line scores twice: a scoring red stone converts at
// once, and a run without red stones only changes when a stone is placed in
// it. Conversion makes no new lines, since the stone already counted as the
// mover's colour.
//
// The game ends when the board is full. The komi goes to one player (Black
// when positive, White when negative); the higher total wins, and equal
// totals (whole-number komi only) are a draw. Self-play trials (MCTS, 2,000
// and 10,000 iterations a move) found Black, the second player, ahead by
// about 1 point, so the default gives White 1.5.
// See docs/bag-of-tricks/rules.md.

import { squareBoard } from "../../common/board/square.js";
import { ray } from "../../common/board/graph.js";
import { makeBag, cloneBag, drawOutcomes, drawMarble, drawnColour, returnDrawn, discardDrawn, addMarbles, bagPanel } from "../../common/bag.js";
import { CHANCE, cachedBoards } from "../../common/engine.js";

const WHITE = 1, BLACK = 2, RED = 3;
const PLAYERS = {
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff" },
};
const RED_STONE = { fill: "#d2453b", mark: "#ffffff" };
const MARBLES = {
  G: { name: "Gray", fill: "#9aa0a6" },
  R: { name: "Red", fill: RED_STONE.fill },
};
const START_BAG = { G: 5, R: 5 };
const SIZE = 7;
const LINE_DIRS = [0, 1, 2, 3];   // E, NE, N, NW; each run is scanned both ways

// Komi in half points: positive for Black, negative for White.
const KOMI = Array.from({ length: 13 }, (_, i) => (i - 6) / 2);
const DEFAULT_KOMI = -1.5;
const komiLabel = (k) => (k > 0 ? `Black +${k}` : k < 0 ? `White +${-k}` : "None");
const komiOf = (s, player) => Math.max(0, player === BLACK ? s.komi : -s.komi);
const total = (s, player) => s.score[player] + komiOf(s, player);

function buildBoard() {
  const m = (SIZE - 1) / 2;
  return squareBoard({ cols: SIZE, style: "points", stars: [[2, 2], [2, SIZE - 3], [SIZE - 3, 2], [SIZE - 3, SIZE - 3], [m, m]] });
}

// ---- scoring -------------------------------------------------------------

// The maximal run through `id` along direction d of cells where own() holds,
// in order from the far end opposite d.
function runThrough(board, id, d, own) {
  return [...ray(board, id, d + 4, own).reverse(), id, ...ray(board, id, d, own)];
}

// Lines the mover scores now: runs of 3 or 4 through the placed stone or a
// red stone, red counting as the mover's. -> [{ cells, scorer }]
function scoringLines(s, placed) {
  const { board, cells, turn } = s;
  const own = (id) => cells[id] === turn || cells[id] === RED;
  const sources = [placed];
  for (let id = 0; id < cells.length; id++) if (cells[id] === RED && id !== placed) sources.push(id);
  const seen = new Set(), lines = [];
  for (const src of sources) {
    for (const d of LINE_DIRS) {
      const run = runThrough(board, src, d, own);
      const key = d * cells.length + run[0];
      if (seen.has(key)) continue;
      seen.add(key);
      if (run.length === 4) lines.push({ cells: run, scorer: turn });
      else if (run.length === 3) lines.push({ cells: run, scorer: 3 - turn });
    }
  }
  return lines;
}

// ---- moves ---------------------------------------------------------------

function place(s, id) {
  const colour = s.colour;
  s.cells[id] = colour === "R" ? RED : s.turn;
  if (colour === "G") returnDrawn(s.bag, 1);   // a red marble stays set aside
  s.empty--;

  const lines = scoringLines(s, id);
  const points = { [WHITE]: 0, [BLACK]: 0 };
  const converted = [];
  for (const line of lines) {
    points[line.scorer]++;
    for (const c of line.cells) {
      if (s.cells[c] !== RED) continue;
      s.cells[c] = s.turn;
      converted.push(c);
      discardDrawn(s.bag, "R");
      addMarbles(s.bag, "R");
    }
  }
  s.score[WHITE] += points[WHITE];
  s.score[BLACK] += points[BLACK];
  s.last = { placed: id, lines: lines.map((l) => l.cells) };
  s.colour = null;
  if (s.empty === 0) {
    const white = total(s, WHITE), black = total(s, BLACK);
    s.over = true;
    s.winner = white > black ? WHITE : black > white ? BLACK : 0;
  } else {
    s.turn = 3 - s.turn;
  }
  return { colour, points, converted, lines: lines.length };
}

function apply(s, move) {
  if (s.colour === null) {
    s.colour = drawnColour(move);
    drawMarble(s.bag, move);
    return null;
  }
  return place(s, move[0]);
}

// ---- text ----------------------------------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function pointsText(points) {
  const parts = [WHITE, BLACK].filter((p) => points[p]).map((p) => `${PLAYERS[p].name} +${points[p]}`);
  return parts.join(", ");
}

// "7 points + 1.5 komi = 8.5", or "7 points" without komi.
function totalText(s, player) {
  const k = komiOf(s, player);
  return k ? `${plural(s.score[player], "point")} + ${k} komi = ${total(s, player)}` : plural(s.score[player], "point");
}

export default {
  id: "bivalent",
  title: "Bivalent",
  url: import.meta.url,
  players: PLAYERS,
  options: {
    komi: { label: "Komi", choices: KOMI.map((k) => ({ value: k, label: komiLabel(k) })), default: DEFAULT_KOMI },
  },
  marbles: MARBLES,

  createBoard: cachedBoards(() => SIZE, buildBoard),
  initialState(board, { komi }) {
    return {
      board,
      cells: new Uint8Array(board.size),   // 0 empty, WHITE, BLACK or RED
      turn: WHITE,
      colour: null,             // the marble drawn this turn ("G" / "R"), or null before the draw
      bag: makeBag(START_BAG),  // drawn: red marbles set aside, and this turn's marble
      score: { [WHITE]: 0, [BLACK]: 0 },
      komi,
      empty: board.size,
      last: null,               // { placed, lines: [[id, ...]] } of the last placement
      over: false,
      winner: null,
    };
  },
  clone(s) {
    return { ...s, cells: s.cells.slice(), bag: cloneBag(s.bag), score: { ...s.score } };
  },
  toMove(s) {
    return s.colour === null ? CHANCE : s.turn;
  },
  currentPlayer(s) {
    return s.turn;
  },
  chances(s) {
    return drawOutcomes(s.bag);
  },
  legalMoves(s) {
    if (s.over) return [];
    if (s.colour === null) return drawOutcomes(s.bag).map((o) => o.move);
    const out = [];
    for (let id = 0; id < s.cells.length; id++) if (!s.cells[id]) out.push([id]);
    return out;
  },
  applyMove: apply,
  outcome(s) {
    return s.over ? { winner: s.winner } : null;
  },

  // Rollouts without building move lists: draw, then a random empty point.
  playout(s, rng) {
    const empty = [];
    while (!s.over) {
      if (s.colour === null) {
        const r = s.bag.counts.R, n = r + s.bag.counts.G;
        apply(s, rng() * n < r ? "draw:R" : "draw:G");
      } else {
        empty.length = 0;
        for (let id = 0; id < s.cells.length; id++) if (!s.cells[id]) empty.push(id);
        place(s, empty[Math.floor(rng() * empty.length)]);
      }
    }
    return s.winner;
  },

  chanceView(s) {
    if (s.over) return [];
    return [bagPanel(s.bag, { active: s.colour === null })];
  },
  piecesOf(s) {
    const out = [];
    for (let id = 0; id < s.cells.length; id++) {
      const c = s.cells[id];
      if (c === RED) out.push({ id, player: null, ...RED_STONE });
      else if (c) out.push({ id, player: c });
    }
    return out;
  },
  // A ring on the last stone placed, outlines on the lines it scored.
  markers(s) {
    if (!s.last) return [];
    const out = [];
    for (const line of s.last.lines) for (const id of line) out.push({ id, kind: "square" });
    out.push({ id: s.last.placed, kind: "ring" });
    return out;
  },
  // "d4", "d4 red", with any points: "d4 red: White +1, Black +1".
  moveText(s, move, info) {
    if (!Array.isArray(move)) return null;
    const name = s.board.cells[move[0]].tags.name + (info.colour === "R" ? " red" : "");
    const pts = pointsText(info.points);
    return pts ? `${name}: ${pts}` : name;
  },
  turnHint(s) {
    if (s.over) return "";
    const name = PLAYERS[s.turn].name;
    if (s.colour === null) return `${name} draws a marble…`;
    const place = s.colour === "G" ? `${name} drew gray: place a ${name.toLowerCase()} stone.` : `${name} drew red: place a red stone.`;
    return s.colour === "R" || s.cells.includes(RED) ? `${place} Red stones count as ${name} this turn.` : place;
  },
  scoreSummary(s, player) {
    const name = PLAYERS[player].name;
    return { main: String(total(s, player)), sub: name, title: `${name}: ${totalText(s, player)}` };
  },
  outcomeLines(s) {
    return [WHITE, BLACK].map((p) => `${PLAYERS[p].name}: ${totalText(s, p)}`);
  },
};

export const internals = { scoringLines, WHITE, BLACK, RED };
