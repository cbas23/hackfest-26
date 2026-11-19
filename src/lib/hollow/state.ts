/**
 * The Hollow's shared state: what is wrong in the city right now. Unlike the map (tunnels,
 * rooms, facilities, residents), it changes over time and every viewer sees the same: it
 * lives in Convex (`convex/`), is edited from the control center (`/control`) and is read by
 * the main map through `#lib/live`.
 *
 * - Points: a centre and a radius that make power, water or air bad for every housing block
 *   inside. A block is either good or bad for each kind; there is no history to resolve.
 * - Blocked tunnels: short stretches of tunnel that can't be passed.
 * - Sickness: the dials behind the lung-sickness hotspots (`sickness.ts`).
 *
 * All of it is fictional. These are plain types so `#lib/hollow` doesn't depend on Convex;
 * `id` is the Convex document id (or a local id for the offline starter scenario).
 */

/** A service a point can put out of order. */
export type PointKind = 'power' | 'water' | 'air';
export const POINT_KINDS: PointKind[] = ['power', 'water', 'air'];

/** How each kind is named and coloured (colours are CSS variables, see `layout.css`). */
export const POINT_INFO: Record<
	PointKind,
	{ label: string; good: string; bad: string; color: string }
> = {
	power: { label: 'Power', good: 'Powered', bad: 'No power', color: 'var(--map-power-bad)' },
	water: { label: 'Water', good: 'Good water', bad: 'Bad water', color: 'var(--map-water-bad)' },
	air: { label: 'Air', good: 'Good air', bad: 'Bad air', color: 'var(--map-air-bad)' }
};

export interface Tile {
	x: number;
	y: number;
}

/** A bad spot for one kind: every housing block whose centre is inside the circle. */
export interface StatePoint {
	id: string;
	kind: PointKind;
	/** Level index, 0 (L1) to 6 (L7). */
	level: number;
	x: number;
	y: number;
	/** In tiles. */
	radius: number;
	/** Optional words for the residents it touches. */
	note?: string;
}

/** A short stretch of tunnel (2–5 tiles) that can't be passed. */
export interface BlockedTunnel {
	id: string;
	level: number;
	tiles: Tile[];
	reason: string;
}

/** Where lung sickness is: the hotspots' seed plus a few dials. */
export interface SicknessSettings {
	seed: number;
	/** Hotspots on L1; each level down has `hotspotsDrop` fewer (at least one). */
	hotspots: number;
	hotspotsDrop: number;
	/** Multiplier on hotspot radius. */
	spread: number;
	/** Multiplier on how sick a hotspot's centre is. */
	intensity: number;
	/** Background sick share on L1. */
	background: number;
	/** Share of hotspot size, heat and background each level down keeps (1: same on every level). */
	depthFalloff: number;
}

/** The whole shared state. Each list is replaced (not mutated) when it changes. */
export interface HollowState {
	points: StatePoint[];
	blockedTunnels: BlockedTunnel[];
	sickness: SicknessSettings;
}

export const POINT_RADIUS = { min: 2, max: 60 } as const;
export const BLOCKED_TILES = { min: 2, max: 5 } as const;
