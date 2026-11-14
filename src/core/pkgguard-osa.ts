/*
 * Adapted to TypeScript from pkgguard, built by Blvkware (https://blvkware.dev),
 * pkgguard/scoring.py, commit 53dadd7ad16dcc99e5e19e135447f2ffb02e1df3.
 * Licensed under Apache-2.0; see THIRD_PARTY_NOTICES.md and licenses/pkgguard-Apache-2.0.txt.
 * Modified: translated Python to TypeScript and iterate Unicode code points.
 * Reference baseline only; the production scorer uses unrestricted distance.
 */
export function optimalStringAlignmentDistance(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  const d = Array.from({ length: x.length + 1 }, () => Array<number>(y.length + 1).fill(0));
  for (let i = 0; i <= x.length; i++) d[i][0] = i;
  for (let j = 0; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[x.length][y.length];
}
