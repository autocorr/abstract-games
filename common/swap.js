// The swap (pie) rule for any two-player game. Pure: no DOM.
//
//   export default withSwap({ ...game, swapColours(state) { ... } });
//
// Swapping takes over the opponent's opening without anyone changing
// colour, as in Hex: the colours of the whole position are exchanged (and
// the board reflected, where the players' goals differ), and the player who
// was to move becomes the other one. After White swaps on move 2, the
// opening stone is White's and Black moves next. This is the same game as
// the two people trading sides, so the swap stays fair; players simply keep
// their colours, and so do their human/AI settings.
//
// The game supplies swapColours(state), which mutates the state into its
// colour-exchanged mirror image: stones, the player to move, and anything
// else owned by a colour (claims, bags of coloured marbles, ...). A game that
// offers the swap at a ply of its own (e.g. a decision before a die roll)
// also moves on from that ply there.
//
// By default the swap is offered once, at player 2's first decision in their
// own turn (after player 1's opening; see defaultOffer), as the string move
// "swap". `offer(state)` can narrow when it is available; it is still
// offered at most once. The wrapper adds `swapClosed` to the state (the
// offer has been taken or declined).

import { CHANCE } from "./engine.js";

export const SWAP = "swap";

// Player 2 deciding in their own turn: game.currentPlayer, when defined,
// names the turn's owner, which may differ from the player deciding now
// (e.g. an opponent resolving an event mid-turn).
function defaultOffer(game, s) {
  const owner = game.currentPlayer ? game.currentPlayer(s) : game.toMove(s);
  return game.toMove(s) === 2 && owner === 2;
}

export function withSwap(game, { offer = (s) => defaultOffer(game, s) } = {}) {
  if (typeof game.swapColours !== "function") throw new Error(`${game.id}: withSwap needs game.swapColours(state)`);
  const offered = (s) => !s.swapClosed && !game.outcome(s) && game.toMove(s) !== CHANCE && offer(s);
  const [first, second] = [game.players[1].name, game.players[2].name];
  return {
    ...game,
    swap: true,
    moveLabels: { [SWAP]: "Swap", ...(game.moveLabels || {}) },

    initialState(board, opts) {
      return Object.assign(game.initialState(board, opts), { swapClosed: false });
    },
    clone(s) {
      return Object.assign(game.clone(s), { swapClosed: s.swapClosed });
    },
    legalMoves(s) {
      const moves = game.legalMoves(s);
      return offered(s) ? [...moves, SWAP] : moves;
    },
    applyMove(s, move) {
      if (offered(s)) s.swapClosed = true;
      if (move === SWAP) {
        game.swapColours(s);
        return null;
      }
      return game.applyMove(s, move);
    },
    swapOffered: offered,
    turnHint(s, scheme) {
      const hint = game.turnHint ? game.turnHint(s, scheme) : "";
      return offered(s)
        ? `${hint} Or swap: ${first}'s opening becomes ${second}'s, and ${first} moves next.`.trim()
        : hint;
    },
    // Custom playouts never swap; they run on the inner game.
    ...(game.playout ? { playout: (s, rng) => game.playout(s, rng) } : {}),
  };
}
