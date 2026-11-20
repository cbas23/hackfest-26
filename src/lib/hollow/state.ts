/**
 * The Hollow's shared state: what is wrong in the city right now. Unlike the map (tunnels,
 * rooms, facilities, residents), it changes over time and every viewer sees the same: it
 * lives in Convex (`convex/`), is edited from the control center (`/control`) and is read by
 * the main map through `#lib/live`.
 *
 * - Points: sources of bad power, water or air, and lung-sickness outbreaks. Each pushes the
 *   blocks it reaches towards bad, fading out to its reach: along the tunnels for power and
 *   water, over an area for air and sickness (`conditions.ts`, `sickness.ts`). There is no
 *   history to resolve.
 * - Blocked tunnels: short stretches of tunnel that can't be passed.
 *
 * All of it is fictional. These are plain types so `#lib/hollow` doesn't depend on Convex;
 * `id` is the Convex document id (or a local id for the offline starter scenario).
 */

/** A service a point can put out of order (graded in `conditions.ts`). */
export type PointKind = 'power' | 'water' | 'air';
export const POINT_KINDS: PointKind[] = ['power', 'water', 'air'];

/** Every kind of point: the services plus lung-sickness outbreaks (`sickness.ts`). */
export type SourceKind = PointKind | 'sickness';
export const SOURCE_KINDS: SourceKind[] = [...POINT_KINDS, 'sickness'];

/** How a kind's points spread: along the tunnels, or over an area. */
export type PointSpread = 'tunnels' | 'area';

/** How each kind is named, coloured and spread (colours are CSS variables, see `layout.css`). */
export const POINT_INFO: Record<
	SourceKind,
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
	air: { label: 'Air', point: 'Bad air', spread: 'area', color: 'var(--map-air-4)' },
	sickness: {
		label: 'Sickness',
		point: 'Outbreak',
		spread: 'area',
		color: 'var(--map-sick-4)'
	}
};

export interface Tile {
	x: number;
	y: number;
}

/** A source of bad power, water or air, or a lung-sickness outbreak, at a tile. */
export interface StatePoint {
	id: string;
	kind: SourceKind;
	/** Level index, 0 (L1) to 6 (L7). */
	level: number;
	x: number;
	y: number;
	/**
	 * How far it reaches, in tiles: walking distance along the tunnels for power and water,
	 * straight-line distance for air and sickness.
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

/** The whole shared state. Each list is replaced (not mutated) when it changes. */
export interface HollowState {
	points: StatePoint[];
	blockedTunnels: BlockedTunnel[];
}

export const POINT_RADIUS = { min: 2, max: 60 } as const;
export const POINT_STRENGTH = { min: 0.1, max: 1 } as const;
export const BLOCKED_TILES = { min: 2, max: 5 } as const;
