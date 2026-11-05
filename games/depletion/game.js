// Depletion: Hex on a rhombus divided into coloured regions. Each turn a
// marble drawn from a bag says which region you must play in. Pure: no DOM.
//
// The bag holds one marble per region colour. Drawn marbles are set aside
// until the bag is empty, then all go back in. If the drawn region is full,
// the player must pass. Black connects the N and S edges of the rhombus, White
// the W and E edges. The board is drawn as a diamond with its long diagonal
// horizontal; on a portrait screen the shell turns it into an upright
// parallelogram with Black's edges vertical and parallel (see `rotatable`).
// Each player's edges are marked in their colour.

import { rhombusBoard, rhombusSides } from "../../common/board/hex.js";
import { goalMasks, connectsSides } from "../../common/board/graph.js";
import { makeBag, cloneBag, drawOutcomes, drawMarble, lastDrawn, isEmpty, returnDrawn, bagPanel } from "../../common/bag.js";
import { CHANCE, cachedBoards } from "../../common/engine.js";
import { LAYOUTS, makeRegions } from "./regions.js";

// Marble colours in the order regions use them.
const COLOURS = [
  { key: "R", name: "Red", fill: "#d64545" },
  { key: "B", name: "Blue", fill: "#3d7dd8" },
  { key: "Y", name: "Yellow", fill: "#e8b923" },
  { key: "G", name: "Green", fill: "#3fa34d" },
  { key: "P", name: "Purple", fill: "#9257c9" },
];
const COLOUR_INDEX = Object.fromEntries(COLOURS.map((c, i) => [c.key, i]));

const PLAYERS = {
  1: { name: "Black", fill: "#202329", mark: "#ffffff", sides: ["N", "S"], goal: "the two edges marked in black" },
  2: { name: "White", fill: "#f2f2f0", mark: "#0e0f13", sides: ["W", "E"], goal: "the two edges marked in white" },
};

const SIZES = Array.from({ length: 13 }, (_, i) => 7 + i);

// Blend a #rrggbb colour towards `base` by `t` (0 = colour, 1 = base).
function mix(hex, base, t) {
  const c = (h, i) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return "#" + [0, 1, 2].map((i) =>
    Math.round(c(hex, i) * (1 - t) + c(base, i) * t).toString(16).padStart(2, "0")).join("");
}
const tint = (t) => (cell) => mix(COLOURS[cell.tags.region].fill, "#f3ecdd", t);

function buildBoard({ size, colours, layout }) {
  const board = rhombusBoard(size, { rotate: -30 });
  const region = makeRegions(board, colours, layout);
  board.regionCells = Array.from({ length: colours }, () => []);
  for (const c of board.cells) {
    c.tags.region = region[c.id];
    board.regionCells[region[c.id]].push(c.id);
  }
  board.goal = goalMasks(board, PLAYERS);
  return board;
}

const colourOf = (state) => COLOURS[COLOUR_INDEX[lastDrawn(state.bag)]];

export default {
  id: "depletion",
  title: "Depletion",
  url: import.meta.url,
  players: PLAYERS,
  // On portrait screens the shell may turn the diamond by -60 degrees: the
  // rhombus then stands as a parallelogram with Black's N and S edges
  // vertical (N on the left) and White's W and E edges slanting top and
  // bottom.
  rotatable: -60,
  marbles: Object.fromEntries(COLOURS.map((c) => [c.key, { name: c.name, fill: c.fill }])),
  options: {
    size: { label: "Board size", choices: SIZES, default: 11 },
    colours: { label: "Colours", choices: [3, 4, 5], default: 3 },
    layout: { label: "Regions", choices: LAYOUTS, default: "pinwheel" },
  },
  colorSchemes: {
    pastel: { name: "Pastel", cellFill: tint(0.62) },
    vivid: { name: "Vivid", cellFill: tint(0.3) },
  },

  createBoard: cachedBoards((o) => `${o.size}/${o.colours}/${o.layout}`, buildBoard),
  initialState(board, opts) {
    const counts = Object.fromEntries(COLOURS.slice(0, opts.colours).map((c) => [c.key, 1]));
    return { board, cells: new Uint8Array(board.size), turn: 1, phase: "draw", bag: makeBag(counts), winner: null };
  },
  clone(s) {
    return { ...s, cells: s.cells.slice(), bag: cloneBag(s.bag) };
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
    if (s.winner) return [];
    if (s.phase === "draw") return drawOutcomes(s.bag).map((o) => o.move);
    const out = [];
    for (const id of s.board.regionCells[COLOUR_INDEX[lastDrawn(s.bag)]]) if (!s.cells[id]) out.push([id]);
    return out.length ? out : ["pass"];
  },
  applyMove(s, move) {
    if (s.phase === "draw") {
      drawMarble(s.bag, move);
      s.phase = "move";
      return null;
    }
    if (move !== "pass") {
      const id = move[0];
      s.cells[id] = s.turn;
      if (connectsSides(s.board, s.cells, id, s.board.goal[s.turn])) s.winner = s.turn;
    }
    s.turn = 3 - s.turn;
    s.phase = "draw";
    if (isEmpty(s.bag)) returnDrawn(s.bag);
    return null;
  },
  outcome(s) {
    return s.winner ? { winner: s.winner } : null;
  },

  chanceView(s) {
    return [bagPanel(s.bag, { active: s.phase === "draw" && !s.winner })];
  },
  turnHint(s) {
    if (s.winner) return "";
    const name = PLAYERS[s.turn].name;
    if (s.phase === "draw") return `${name} draws a marble…`;
    const colour = colourOf(s);
    return this.legalMoves(s)[0] === "pass"
      ? `${name} drew ${colour.name.toLowerCase()}, but that region is full: pass.`
      : `${name} drew ${colour.name.toLowerCase()}: play in the ${colour.name.toLowerCase()} region.`;
  },
  moveLabel(s, move) {
    return move === "pass" ? `Pass (${colourOf(s).name.toLowerCase()} region is full)` : null;
  },
  scoreSummary(s, player) {
    return { sub: PLAYERS[player].name, title: `${PLAYERS[player].name} connects ${PLAYERS[player].goal}` };
  },
  boardDecor(board) {
    const sides = rhombusSides(board);
    return [
      { segments: [...sides.N, ...sides.S], stroke: PLAYERS[1].fill, halo: "#c4c8cf", width: 0.16 },
      { segments: [...sides.W, ...sides.E], stroke: PLAYERS[2].fill, halo: "#0e0f13", width: 0.16 },
    ];
  },
};
