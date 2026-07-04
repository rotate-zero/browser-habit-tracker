const PALETTE = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#639922', '#378ADD', '#888780'];

export function colorFor(index: number) {
  return PALETTE[index % PALETTE.length];
}
