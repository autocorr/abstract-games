// Registry of games shown on the landing page and checked by the conformance
// tests. Paths are relative to the site root.

export const games = [
  {
    id: "filament",
    title: "Filament",
    board: "Cairo pentagonal tiling",
    blurb: "Place stones on pentagons. An empty cell where most neighbors share a color fills with the other color, and fills can cascade. When the board is full, the player with fewer groups wins.",
    path: "games/filament/",
    module: "games/filament/game.js",
  },
];
