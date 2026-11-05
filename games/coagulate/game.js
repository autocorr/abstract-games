// Coagulate: push your luck with a d4 for stones, and grow the larger
// groups. Pure: no DOM.
//
// Hex-hex board, Black first. A turn starts with a roll of the d4 (a
// chance ply, "roll:N"; see common/dice.js), which always counts. Then the
// player either places a stone, which ends the rolling, or rolls again
// ("reroll", then a roll ply):
//
//   - a re-roll greater than the roll before it counts, and the player
//     chooses again;
//   - an equal or lower re-roll busts: the turn ends with no stones placed.
//
// Counting rolls rise strictly, so at most 4 count, and after a 4 there is
// no re-roll. The player places one stone per counting roll, one cell per
// ply ([id]); if the board fills first, the game ends there.
//
// When the board is full, the larger groups win (largest groups cascading,
// common/largest-groups.js). The board has an odd number of cells, so there
// are no draws.
//
// Swap (pie rule, common/swap.js, optional): after Black's first turn,
// White may swap instead of rolling: Black's stones become White's and Black
// rolls next. White's first turn opens with a decision ply ("keep" or
// "swap") before the roll, so the swap is decided without knowing the die.

import { hexHexBoard } from "../../common/board/hex.js";
import { CHANCE, cachedBoards } from "../../common/engine.js";
import { rollOutcomes, rolledValue, isRollMove, dicePanel } from "../../common/dice.js";
import { withSwap } from "../../common/swap.js";
import { analyzeGroups, cascadeWinner, largestGroupsHooks } from "../../common/largest-groups.js";

const BLACK = 1, WHITE = 2;
const PLAYERS = {
  [BLACK]: { name: "Black", fill: "#202329", mark: "#ffffff" },
  [WHITE]: { name: "White", fill: "#f2f2f0", mark: "#0e0f13" },
};

const SIZES = [4, 5, 6, 7];
const SIDES = 4;
const KEEP = "keep";
const REROLL = "reroll";

const last = (rolls) => rolls[rolls.length - 1];
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---- moves ---------------------------------------------------------------

function endTurn(s) {
  s.turn = 3 - s.turn;
  s.turns++;
  s.rolls = [];
  s.left = 0;
  s.placing = 0;
  // White's first turn opens with the swap decision when the rule is on.
  s.phase = s.swapRule && s.turns === 1 ? "ready" : "roll";
}

// A roll counts if it is the turn's first or beats the one before it;
// otherwise the turn ends empty-handed.
function roll(s, value) {
  if (s.rolls.length && value <= last(s.rolls)) {
    s.bust = { player: s.turn, rolls: [...s.rolls, value] };
    endTurn(s);
    return { bust: true };
  }
  s.rolls.push(value);
  s.left = Math.min(s.rolls.length, s.board.size - s.stones);
  s.phase = "place";
  return { bust: false };
}

// The turn's rolling is still open: no stone placed yet, and a re-roll
// could still beat the last roll.
const canReroll = (s) => s.phase === "place" && !s.placing && last(s.rolls) < SIDES;

function place(s, id) {
  if (!s.placing) {   // the turn's first stone
    s.marked = [];
    s.bust = null;
  }
  s.cells[id] = s.turn;
  s.stones++;
  s.left--;
  s.placing++;
  s.marked.push(id);
  if (s.stones === s.board.size) {
    s.over = true;
    s.phase = "over";
    s.winner = cascadeWinner(analyzeGroups(s.board, s.cells));
  } else if (s.left === 0) {
    endTurn(s);
  }
  return null;
}

function apply(s, move) {
  if (s.phase === "roll") return roll(s, rolledValue(move));
  if (s.phase === "ready") {   // KEEP; a swap goes through swapColours
    s.phase = "roll";
    return null;
  }
  if (move === REROLL) {
    s.phase = "roll";
    return null;
  }
  return place(s, move[0]);
}

function emptyCells(s) {
  const out = [];
  for (let id = 0; id < s.cells.length; id++) if (!s.cells[id]) out.push(id);
  return out;
}

// ---- text ----------------------------------------------------------------

// "1 in 2": the chance that a re-roll beats `value`.
function oddsText(value) {
  const wins = SIDES - value;
  return wins * 2 === SIDES ? "1 in 2" : `${wins} in ${SIDES}`;
}

const rollsText = (rolls) => rolls.join(", ");

export default withSwap({
  id: "coagulate",
  title: "Coagulate",
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
  moveLabels: { [KEEP]: "Roll", [REROLL]: "Roll again" },
  pieceLabels: "Group sizes",   // Setup can hide the numbers on the stones

  createBoard: cachedBoards((o) => o.size, ({ size }) => hexHexBoard(size)),
  initialState(board, { swap }) {
    return {
      board,
      cells: new Uint8Array(board.size),
      turn: BLACK,
      phase: "roll",          // "roll" (chance), "place", "ready" (White's swap decision) or "over"
      rolls: [],              // the turn's counting rolls
      left: 0,                // stones still to place this turn
      placing: 0,             // stones placed this turn
      stones: 0,
      turns: 0,               // turns completed
      marked: [],             // the stones placed in the latest turn that placed any
      bust: null,             // { player, rolls } of a bust not yet followed by a placement
      swapRule: swap === "on",
      over: false,
      winner: null,
    };
  },
  clone(s) {
    return { ...s, cells: s.cells.slice(), rolls: s.rolls.slice(), marked: s.marked.slice() };
  },
  toMove(s) {
    return s.phase === "roll" ? CHANCE : s.turn;
  },
  currentPlayer(s) {
    return s.turn;
  },
  chances() {
    return rollOutcomes(SIDES);
  },
  legalMoves(s) {
    if (s.over) return [];
    if (s.phase === "roll") return rollOutcomes(SIDES).map((o) => o.move);
    if (s.phase === "ready") return [KEEP];
    const moves = emptyCells(s).map((id) => [id]);
    return canReroll(s) ? [...moves, REROLL] : moves;
  },
  applyMove: apply,
  // The swap: every stone changes colour (the board is symmetric), and the
  // other player rolls next.
  swapColours(s) {
    for (let id = 0; id < s.cells.length; id++) if (s.cells[id]) s.cells[id] = 3 - s.cells[id];
    s.turn = 3 - s.turn;
    s.phase = "roll";
  },
  outcome(s) {
    return s.over ? { winner: s.winner } : null;
  },

  // Rollouts without building move lists: re-roll after a 1, and after a 2
  // half the time; place on random empty cells.
  playout(s, rng) {
    const empty = emptyCells(s);
    while (!s.over) {
      if (s.phase === "roll") {
        roll(s, 1 + Math.floor(rng() * SIDES));
      } else if (s.phase === "ready") {
        s.phase = "roll";
      } else {
        const top = last(s.rolls);
        if (canReroll(s) && (top === 1 || (top === 2 && rng() < 0.5))) {
          s.phase = "roll";
          continue;
        }
        const i = Math.floor(rng() * empty.length);
        const id = empty[i];
        empty[i] = empty[empty.length - 1];
        empty.pop();
        place(s, id);
      }
    }
    return s.winner;
  },

  // The turn's counting rolls, and a blank die while one is being rolled.
  chanceView(s) {
    if (s.over || s.phase === "ready") return [];
    const dice = s.phase === "roll" ? [...s.rolls, null] : s.rolls;
    return [dicePanel(dice, { title: "d4", owner: s.turn, active: s.phase === "roll" })];
  },
  ...largestGroupsHooks(PLAYERS),
  // Outlines round the stones of the latest turn that placed any (rings
  // would cover their labels).
  markers(s) {
    return s.marked.map((id) => ({ id, kind: "square" }));
  },
  moveText(s, move, info) {
    if (move === KEEP) return "no swap";
    if (move === REROLL) return "roll again";
    if (isRollMove(move) && info && info.bust) return `rolled ${rolledValue(move)}: bust`;
    return null;
  },
  turnHint(s) {
    if (s.over) return "";
    const name = PLAYERS[s.turn].name;
    const bust = s.bust ? `${PLAYERS[s.bust.player].name} busted (${rollsText(s.bust.rolls)}). ` : "";
    if (s.phase === "ready") return `${bust}${name}: roll to play on.`;
    if (s.phase === "roll") {
      return s.rolls.length
        ? `${name} rolls again, needing more than ${last(s.rolls)}…`
        : `${bust}${name} rolls the die…`;
    }
    const top = last(s.rolls);
    if (s.placing) return `${name}: place ${plural(s.left, "more stone")}.`;
    const placeText = `place ${plural(s.left, "stone")}`;
    if (!canReroll(s)) return `${bust}${name} rolled ${top}: ${placeText}.`;
    return `${bust}${name} rolled ${top}: ${placeText}, or roll again (beat ${top}: ${oddsText(top)}).`;
  },
}, {
  // Offered at White's decision before the first roll.
  offer: (s) => s.phase === "ready",
});
