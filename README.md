# Abstract Games

Playable web versions of original abstract strategy board games, hosted on
GitHub Pages at <https://autocorr.github.io/abstract-games/>.

## Games

- [Filament](games/filament/): a placement game on the Cairo pentagonal
  tiling where majorities fill empty cells and the player with fewer groups
  wins.
- [Depletion](games/depletion/): Hex on a board of colored regions, where a
  marble drawn from a bag decides which region you must play in.
- [Determinant](games/determinant/): a square-grid connection game where
  diagonal cross-cuts are settled by a marble draw, and the winner of the
  draw recolors stones until no cross-cut remains.
- [Cliques](games/cliques/): a hex-hex majority game where each cluster of
  touching stones goes to the player with its largest group, placements may
  pull a friendly stone along a line, and tied clusters can be claimed.

## Running locally

The site is plain static files using native ES modules, so there is no build
step. Browsers refuse to load modules from `file://` URLs, so serve the
directory over HTTP instead:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Tests

The rules engines are pure modules with no DOM access and are tested with
Node's built-in test runner (Node 20+, no dependencies):

```sh
npm test        # or: node --test test/*.test.js
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the code is organised and how
to add a new game.

## License

[MIT](LICENSE)
