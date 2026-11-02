// Seedable pseudo-random number generators.
//
// Every function that consumes randomness takes an `rng` argument (a function
// returning a float in [0, 1)), defaulting to Math.random. Tests pass a seeded
// generator from here so that playouts are reproducible.

// mulberry32: a small, fast 32-bit generator with good statistical quality for
// game playouts. Returns a function producing floats in [0, 1).
export function seededRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uniform integer in [0, n).
export function randInt(rng, n) {
  return Math.floor(rng() * n);
}

// In-place Fisher-Yates shuffle; returns the array.
export function shuffle(array, rng = Math.random) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}
