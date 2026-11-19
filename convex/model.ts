/**
 * Shapes of the Hollow's shared state. All of it is fictional: the control center
 * (`/control`) writes it and the main map reads it. Map geometry (tunnels, rooms,
 * facilities, residents) stays in the browser; the state points into it by level and tile
 * coordinates.
 */
import { v } from 'convex/values';

/** What a point puts out of order: power, water or air. */
export const pointKind = v.union(v.literal('power'), v.literal('water'), v.literal('air'));

/**
 * A bad spot for one kind of service: every housing block whose centre is inside the
 * circle has bad power, water or air. Outside every point of a kind, that kind is good.
 */
export const point = v.object({
	kind: pointKind,
	level: v.number(),
	x: v.number(),
	y: v.number(),
	radius: v.number(),
	/** Optional words for the residents it touches. */
	note: v.optional(v.string())
});

export const tile = v.object({ x: v.number(), y: v.number() });

/** A short stretch (2–5 tiles) of tunnel that can't be passed. */
export const blockedTunnel = v.object({
	level: v.number(),
	tiles: v.array(tile),
	reason: v.string()
});

/** Where lung sickness is: a seed for the hotspots plus a few dials. One document. */
export const sicknessSettings = v.object({
	seed: v.number(),
	/** Hotspots on L1; each level down has `hotspotsDrop` fewer (at least one). */
	hotspots: v.number(),
	hotspotsDrop: v.number(),
	/** Multiplier on hotspot radius. */
	spread: v.number(),
	/** Multiplier on how sick a hotspot's centre is. */
	intensity: v.number(),
	/** Background sick share on L1. */
	background: v.number(),
	/** Share of size, heat and background each level down keeps (1 = same everywhere). */
	depthFalloff: v.number()
});

/** The Hollow has seven levels, L1 (0) to L7 (6). */
export const LEVEL_COUNT = 7;
export const POINT_RADIUS = { min: 2, max: 60 } as const;
export const BLOCKED_TILES = { min: 2, max: 5 } as const;

const fail = (msg: string): never => {
	throw new Error(msg);
};

export function checkLevel(level: number) {
	if (!Number.isInteger(level) || level < 0 || level >= LEVEL_COUNT)
		fail(`level must be 0–${LEVEL_COUNT - 1}`);
}

export function checkRadius(radius: number) {
	if (!(radius >= POINT_RADIUS.min && radius <= POINT_RADIUS.max))
		fail(`radius must be ${POINT_RADIUS.min}–${POINT_RADIUS.max} tiles`);
}

export function checkTiles(tiles: { x: number; y: number }[]) {
	if (tiles.length < BLOCKED_TILES.min || tiles.length > BLOCKED_TILES.max)
		fail(`a blocked tunnel covers ${BLOCKED_TILES.min}–${BLOCKED_TILES.max} tiles`);
	if (!tiles.every((t) => Number.isInteger(t.x) && Number.isInteger(t.y)))
		fail('tiles must be whole tile coordinates');
}
