# Abstract Games

Playable web versions of original abstract strategy board games, hosted on
GitHub Pages at <https://autocorr.github.io/abstract-games/>.

## Games

- [Filament](games/filament/)
- [Depletion](games/depletion/)
- [Determinant](games/determinant/)
- [Cliques](games/cliques/)
- [Liquefaction](games/liquefaction/)
- [Nucleation](games/nucleation/)
- [Bivalent](games/bivalent/)
- [Wavefunction Collapse](games/wavefunction-collapse/)
- [Zone Y](games/zone-y/)
- [Tunneling](games/tunneling/)
- [Broadcast](games/broadcast/)
- [Shaolin King](games/shaolin-king/)
- [Lottery Chess](games/lottery-chess/)
- [Grounded Chess](games/grounded-chess/)
- [Successive Chess](games/successive-chess/)
- [Hemisphere](games/hemisphere/)
- [Buoyancy](games/buoyancy-draw/)
- [Roost](games/roost/)

## Running locally

The site is plain static files using native ES modules, with no build step.
Browsers won't load modules from `file://` URLs, so serve the directory over
HTTP instead:

```sh
npm run serve   # or: python3 -m http.server 8000
# then open http://localhost:8000/
```

## Tests

The rules engines are pure modules with no DOM access, tested with Node's
built-in test runner (Node 20+, no dependencies):

```sh
npm test        # or: node --test test/*.test.js
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the code is organized and how
to add a new game.

## License

[MIT](LICENSE)

The chess piece images are by Colin M.L. Burnett ("Cburnett") from Wikimedia
Commons, used under the BSD license (some games recolor them); see
[common/pieces/cburnett/README.md](common/pieces/cburnett/README.md).

The Inter font is by Rasmus Andersson and the Inter Project Authors, used
under the SIL Open Font License; see
[common/fonts/LICENSE.txt](common/fonts/LICENSE.txt).

Grounded Chess's color palettes are based on Okabe and Ito's color-blind-safe
palette.

Wavefunction Collapse's board colors are from Lichess.
