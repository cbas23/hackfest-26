/** Number formats used across the Hollow UI (English, so the fictional data reads the same everywhere). */

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** With thousands separators: 12,400. */
export const formatCount = (n: number) => n.toLocaleString('en');

/** Short: 12.4K. */
export const formatCompact = (n: number) => compact.format(n);

/** A 0–1 share as a whole percentage: 42%. */
export const formatPercent = (share: number) => `${Math.round(share * 100)}%`;

/** Depth below the surface: −1,200 m. */
export const formatDepth = (metres: number) => `−${formatCount(metres)} m`;
