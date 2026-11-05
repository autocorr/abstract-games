// The swap (pie) rule for any two-player game. Pure: no DOM.
//
//   export default withSwap({ ...game });
//
// Player numbers in the Game contract are colours: they own pieces, take
// turns and win. Swapping changes none of that. The position stays exactly
// as it is, and the two people (seats) trade colours. Seat 1 starts as
// player 1 and seat 2 as player 2; seat(state, player) says which seat plays
// a colour now, and the shell and the AI use it to decide who is human and
// whom to credit with a win.
//
// By default the swap is offered once, at player 2's first decision in their
// own turn (after player 1's opening; see defaultOffer), as the string move "swap". The other
// side then moves on as usual: after White swaps on move 2, White is still
// to move, now played by the seat that opened as Black. `offer(state)` can
// narrow when the swap is available; it is still offered at most once.
//
// The wrapper adds two fields to the state: `swapped` (seats are crossed)
// and `swapClosed` (the offer has been taken or declined).

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
  const offered = (s) => !s.swapClosed && !game.outcome(s) && game.toMove(s) !== CHANCE && offer(s);
  return {
    ...game,
    swap: true,
    moveLabels: { [SWAP]: "Swap sides", ...(game.moveLabels || {}) },

    initialState(board, opts) {
      return Object.assign(game.initialState(board, opts), { swapped: false, swapClosed: false });
    },
    clone(s) {
      return Object.assign(game.clone(s), { swapped: s.swapped, swapClosed: s.swapClosed });
    },
    legalMoves(s) {
      const moves = game.legalMoves(s);
      return offered(s) ? [...moves, SWAP] : moves;
    },
    applyMove(s, move) {
      if (offered(s)) s.swapClosed = true;
      if (move === SWAP) {
        s.swapped = !s.swapped;
        return null;
      }
      return game.applyMove(s, move);
    },
    seat(s, player) {
      return s.swapped ? 3 - player : player;
    },
    swapOffered: offered,
    turnHint(s, scheme) {
      const hint = game.turnHint ? game.turnHint(s, scheme) : "";
      return offered(s) ? `${hint} Or swap sides and take over ${game.players[1].name}.`.trim() : hint;
    },
    // Custom playouts never swap; they run on the inner game.
    ...(game.playout ? { playout: (s, rng) => game.playout(s, rng) } : {}),
  };
}
