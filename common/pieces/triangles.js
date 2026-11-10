// Triangle pieces pointing the way each side moves: White's up, Black's
// down, outlined as the Cburnett pieces are (1.5 units on a 45-unit square,
// drawn a full cell wide like them). Data URLs, for piecesOf images. Pure:
// no DOM.

function triangle(up) {
  const points = up ? "22.5,9.5 37.5,35.5 7.5,35.5" : "22.5,35.5 37.5,9.5 7.5,9.5";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="45" height="45" viewBox="0 0 45 45">` +
    `<polygon points="${points}" fill="${up ? "#fff" : "#000"}" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

export const WHITE_TRIANGLE = triangle(true);
export const BLACK_TRIANGLE = triangle(false);
