/** Severity for what the UI flags (notices, the sickness steps). Colours are CSS variables. */
export type Status = 'normal' | 'warning' | 'high' | 'critical';

/** `color` is a CSS `var()` (see `layout.css`). */
export const STATUS_INFO: Record<Status, { label: string; color: string; rank: number }> = {
	normal: { label: 'Normal', color: 'var(--status-normal)', rank: 0 },
	warning: { label: 'Warning', color: 'var(--status-warning)', rank: 1 },
	high: { label: 'High risk', color: 'var(--status-high)', rank: 2 },
	critical: { label: 'Critical', color: 'var(--status-critical)', rank: 3 }
};
