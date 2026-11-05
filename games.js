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
  {
    id: "depletion",
    title: "Depletion",
    board: "Hex rhombus in colored regions",
    blurb: "Connect your sides as in Hex, but a marble drawn from a bag decides which colored region you must play in. Each color comes up once before the bag is refilled.",
    path: "games/depletion/",
    module: "games/depletion/game.js",
  },
  {
    id: "determinant",
    title: "Determinant",
    board: "Square grid of points",
    blurb: "Connect your edges with orthogonal chains. A cross-cut sends you to the bag, and the color drawn decides who recolors stones until no cross-cut is left.",
    path: "games/determinant/",
    module: "games/determinant/game.js",
  },
  {
    id: "cliques",
    title: "Cliques",
    board: "Hexagon of hexagons",
    blurb: "Place a stone and pull one of yours to its group. Each cluster of touching stones goes to the player with the largest group in it, and ties can be claimed. A minimum number of clusters must always remain.",
    path: "games/cliques/",
    module: "games/cliques/game.js",
  },
  {
    id: "liquefaction",
    title: "Liquefaction",
    board: "Chessboard in four colors",
    blurb: "Chess without Queens. Each turn a marble drawn from a bag names a square color your King may not stand on, and the square you move to decides which marble goes back in.",
    path: "games/liquefaction/",
    module: "games/liquefaction/game.js",
  },
  {
    id: "nucleation",
    title: "Nucleation",
    board: "Hexagon of hexagons",
    blurb: "Roll a die and place a stone so that its group grows to the number rolled, or the nearest size below it you can make. Only a six grows a group past six. When the board is full, the larger groups win.",
    path: "games/nucleation/",
    module: "games/nucleation/game.js",
  },
  {
    id: "bivalent",
    title: "Bivalent",
    board: "Square grid of points",
    blurb: "Draw gray to place your stone, red to place a neutral one. Lines of four score for you, lines of three for your opponent, and red stones count for whoever is moving.",
    path: "games/bivalent/",
    module: "games/bivalent/game.js",
  },
];
