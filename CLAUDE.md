# CLAUDE.md

Static site of abstract strategy games: plain HTML + native ES modules, no build step. See `ARCHITECTURE.md`.

## Tooling

- `npm test` runs the Node test suite (`node --test`); CI runs only this, then deploys the repo to GitHub Pages.
- `npm run serve` serves the site at http://localhost:8000.
- Python is dev-only tooling (e.g. Playwright) in the hidden `.tools/` uv project, which Pages does not publish:
  `uv run --project .tools python .tools/scripts/screenshot.py [path] [out.png]`
- Never add Python to the site or to CI (installs are slow).
- Content blockers block scripts with tracker-like names (EasyPrivacy blocks
  `/log-view.js`), which blanks a page. Check new file names with
  `uv run --project .tools python .tools/scripts/check_blocklists.py`.

## Git

- Implement a new game on its own branch (e.g. `game/<id>`), not on `main`,
  which CI deploys. Make logical commits as you go (e.g. rules decisions,
  shared-code changes, the game itself) rather than one commit at the end.
