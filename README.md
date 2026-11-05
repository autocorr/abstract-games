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
