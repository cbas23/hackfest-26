/**
 * The Hollow's shared state: what is wrong in the city right now. Unlike the map (tunnels,
 * rooms, facilities, residents), it changes over time and every viewer sees the same: it
 * lives in Convex (`convex/`), is edited from the control center (`/control`) and is read by
 * the main map through `#lib/live`.
 *
 * - Points: sources of bad power, water or air. Each pushes the blocks it reaches towards
 *   bad, fading out to its reach: along the tunnels for power and water, over an area for
 *   air (`conditions.ts`). There is no history to resolve.
 * - Blocked tunnels: short stretches of tunnel that can't be passed.
 * - Sickness: the dials behind the lung-sickness hotspots (`sickness.ts`).
 *
 * All of it is fictional. These are plain types so `#lib/hollow` doesn't depend on Convex;
 * `id` is the Convex document id (or a local id for the offline starter scenario).
 */

/** A service a point can put out of order. */
export type PointKind = 'power' | 'water' | 'air';
export const POINT_KINDS: PointKind[] = ['power', 'water', 'air'];

/** How a kind's points spread: along the tunnels, or over an area. */
export type PointSpread = 'tunnels' | 'area';

/** How each kind is named, coloured and spread (colours are CSS variables, see `layout.css`). */
export const POINT_INFO: Record<
	PointKind,
	{
		label: string;
		/** What a point of this kind is, e.g. "Power fault". */
		point: string;
		spread: PointSpread;
		color: string;
	}
> = {
	power: { label: 'Power', point: 'Power fault', spread: 'tunnels', color: 'var(--map-power-4)' },
	water: { label: 'Water', point: 'Contamination', spread: 'tunnels', color: 'var(--map-water-4)' },
	air: { label: 'Air', point: 'Bad air', spread: 'area', color: 'var(--map-air-4)' }
};

export interface Tile {
	x: number;
	y: number;
}

/** A source of bad power, water or air, at a tile. */
export interface StatePoint {
	id: string;
	kind: PointKind;
	/** Level index, 0 (L1) to 6 (L7). */
	level: number;
	x: number;
	y: number;
	/**
	 * How far it reaches, in tiles: walking distance along the tunnels for power and water,
	 * straight-line distance for air.
	 */
	radius: number;
	/** Its push at the centre, 0–1 (1 when unset). */
	strength?: number;
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
export const POINT_STRENGTH = { min: 0.1, max: 1 } as const;
export const BLOCKED_TILES = { min: 2, max: 5 } as const;
