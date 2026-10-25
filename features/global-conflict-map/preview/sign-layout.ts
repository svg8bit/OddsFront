// Where the geopolitical signs of a place sit: one tidy row right under the place's name (a country
// anchor is the exact point where the map writes the country's name), or under its conflict dot when
// the place has one. The offsets are fixed pixels, so the row stays put at every zoom and every sign
// stays where the user saw it.

export const SIGN_SIZE = 16;
const GAP = 4;

/** Pixel offsets from the place's anchor for `count` signs, left to right. */
export function signRowOffsets(count: number, dotRadius = 0): [number, number][] {
  // Below the name (about 7 px of text under the anchor), or below the dot when there is one.
  const y = Math.round(dotRadius > 0 ? dotRadius + 5 + SIGN_SIZE / 2 : 10 + SIGN_SIZE / 2);
  return Array.from({ length: count }, (_, index) => [Math.round((index - (count - 1) / 2) * (SIGN_SIZE + GAP)), y]);
}
