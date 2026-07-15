const PALETTE = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#639922', '#378ADD', '#888780', '#D4A72C'];

export function colorFor(index: number) {
  return PALETTE[index % PALETTE.length];
}

/** Blends a hex color toward white by `fraction` (0 = unchanged, 1 = white).
 * Used to fade older periods in the category-bundle chart while keeping
 * each category's own hue recognizable, rather than using opacity (which
 * would also fade the bar against the dark background, not just relative
 * to its own full-strength version). */
export function lightenHex(hex: string, fraction: number): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lerp = (c: number) => Math.round(c + (255 - c) * clamped);
  const toHex = (c: number) => c.toString(16).padStart(2, '0');
  return `#${toHex(lerp(r))}${toHex(lerp(g))}${toHex(lerp(b))}`;
}
