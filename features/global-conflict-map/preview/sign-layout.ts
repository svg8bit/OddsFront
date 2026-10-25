// Where each geopolitical sign sits around its place at the current camera: close to it, but never on
// top of a conflict dot or another sign. Computed when the camera settles (load, move end, resize);
// while the map moves, signs keep these offsets. Pure, so it is testable without a map.

export type ScreenDot = { x: number; y: number; radius: number };
export type ScreenRect = { left: number; top: number; right: number; bottom: number };
export type SignToPlace = { id: string; x: number; y: number; size: number; weight: number; /** Radius of the conflict dot at the same place, 0 when there is none. */ dotRadius: number };

// Below the place first (country names sit on it), then the sides, then above.
const ANGLES = [90, 55, 125, 20, 160, 0, 180, -40, -140, -90].map((degrees) => (degrees * Math.PI) / 180);

function circleHitsRect(x: number, y: number, radius: number, rect: ScreenRect) {
  const nearestX = Math.max(rect.left, Math.min(x, rect.right));
  const nearestY = Math.max(rect.top, Math.min(y, rect.bottom));
  return Math.hypot(x - nearestX, y - nearestY) < radius + 1;
}

/** Offsets (px from the place's anchor) for every sign, heaviest signs first. */
export function placeSigns(signs: readonly SignToPlace[], dots: readonly ScreenDot[], labels: readonly ScreenRect[] = []): Map<string, [number, number]> {
  const placed: ScreenDot[] = [];
  const offsets = new Map<string, [number, number]>();
  // Country names stay readable: a sign never covers a label, a conflict dot or another sign.
  const blocked = (x: number, y: number, radius: number) =>
    dots.some((dot) => Math.hypot(dot.x - x, dot.y - y) < dot.radius + radius + 2) ||
    placed.some((other) => Math.hypot(other.x - x, other.y - y) < other.radius + radius + 2) ||
    labels.some((label) => circleHitsRect(x, y, radius, label));
  for (const sign of signs.toSorted((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))) {
    const radius = sign.size / 2;
    const besideDot = sign.dotRadius > 0;
    const base = besideDot ? sign.dotRadius + radius + 5 : 0;
    let chosen: [number, number] | null = null;
    // Try the place itself (when no dot is there), then rings of growing radius around it.
    if (!besideDot && !blocked(sign.x, sign.y, radius)) chosen = [0, 0];
    for (let ring = 0; !chosen && ring < 6; ring += 1) {
      const distance = Math.max(base, radius + 4) + ring * (radius + 4);
      for (const angle of ANGLES) {
        const dx = Math.round(Math.cos(angle) * distance);
        const dy = Math.round(Math.sin(angle) * distance);
        if (!blocked(sign.x + dx, sign.y + dy, radius)) { chosen = [dx, dy]; break; }
      }
    }
    // Nowhere free: the first spot of the outer ring is still better than covering the dot.
    chosen ??= [0, Math.round(Math.max(base, radius + 4) + 5 * (radius + 4))];
    offsets.set(sign.id, chosen);
    placed.push({ x: sign.x + chosen[0], y: sign.y + chosen[1], radius });
  }
  return offsets;
}

export type ZoomTier = "far" | "mid" | "near";
export const zoomTier = (zoom: number): ZoomTier => (zoom < 2.4 ? "far" : zoom < 3.6 ? "mid" : "near");
export const SIGN_SIZE: Record<ZoomTier, number> = { far: 14, mid: 18, near: 21 };

/** Signs shown at a zoom: the big markets everywhere, the smaller ones once the user zooms in. */
export function signVisible(volume: number, tier: ZoomTier) {
  return tier === "near" || (tier === "mid" ? volume >= 150_000 : volume >= 1_000_000);
}

/** Screen boxes of the country names the map shows, from their anchor, text and size (padded). */
export function labelRect(x: number, y: number, text: string, fontSize: number): ScreenRect {
  const maxLine = 7 * fontSize;
  const longest = Math.max(...text.split(/\s+/).map((word) => word.length), 1);
  const width = Math.min(Math.max(text.length * fontSize * 0.58, longest * fontSize * 0.58), maxLine);
  const lines = Math.max(1, Math.ceil((text.length * fontSize * 0.58) / maxLine));
  const height = lines * fontSize * 1.2;
  return { left: x - width / 2 - 3, right: x + width / 2 + 3, top: y - height / 2 - 2, bottom: y + height / 2 + 2 };
}
