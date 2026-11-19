/**
 * Shapes shared by the event tables. Every event is fictional: the Hollow's control center
 * (`/control`) writes them and the main map reads them. Map geometry (tunnels, rooms,
 * facilities, residents) stays in the browser; events point into it by level, tile
 * coordinates and facility keys (`"<level>:<roomId>"`).
 */
import { v, type Infer } from 'convex/values';

export const severity = v.union(v.literal('warning'), v.literal('high'), v.literal('critical'));
export type Severity = Infer<typeof severity>;

export const airMetric = v.union(v.literal('co2'), v.literal('pm25'), v.literal('airflow'));
export const waterMetric = v.union(
	v.literal('turbidity'),
	v.literal('chlorine'),
	v.literal('output')
);

export const tile = v.object({ x: v.number(), y: v.number() });

/** Fields every event carries. `resolvedAt` is set once a crew fixed it. */
const base = {
	level: v.number(),
	note: v.optional(v.string()),
	resolvedAt: v.optional(v.number())
};

/** A power cut over a round area: every housing block whose centre is inside goes dark. */
export const blackout = v.object({
	...base,
	x: v.number(),
	y: v.number(),
	radius: v.number()
});

/** A ventilation facility reading badly on one metric. */
export const airEvent = v.object({
	...base,
	facility: v.string(),
	metric: airMetric,
	severity,
	/** Exact reading; when absent it sits in the middle of the severity's band. */
	value: v.optional(v.number())
});

/** A water facility failing: bad quality (turbidity, chlorine) or a supply cut (output). */
export const waterEvent = v.object({
	...base,
	facility: v.string(),
	metric: waterMetric,
	severity,
	value: v.optional(v.number())
});

/** A short stretch (2–5 tiles) of tunnel that can't be passed. */
export const blockedTunnel = v.object({
	...base,
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

export const BLOCKED_TILES = { min: 2, max: 5 } as const;

/** The Hollow has seven levels, L1 (0) to L7 (6). */
export const LEVEL_COUNT = 7;
export const BLACKOUT_RADIUS = { min: 2, max: 60 } as const;

const fail = (msg: string): never => {
	throw new Error(msg);
};

export function checkLevel(level: number) {
	if (!Number.isInteger(level) || level < 0 || level >= LEVEL_COUNT)
		fail(`level must be 0–${LEVEL_COUNT - 1}`);
}

export function checkRadius(radius: number) {
	if (!(radius >= BLACKOUT_RADIUS.min && radius <= BLACKOUT_RADIUS.max))
		fail(`radius must be ${BLACKOUT_RADIUS.min}–${BLACKOUT_RADIUS.max} tiles`);
}

/** Facility keys are `"<level>:<roomId>"`, and must sit on the event's level. */
export function checkFacility(level: number, facility: string) {
	const m = /^(\d+):(\d+)$/.exec(facility);
	if (!m || Number(m[1]) !== level) fail(`facility must be "<level>:<roomId>" on level ${level}`);
}

export function checkTiles(tiles: { x: number; y: number }[]) {
	if (tiles.length < BLOCKED_TILES.min || tiles.length > BLOCKED_TILES.max)
		fail(`a blocked tunnel covers ${BLOCKED_TILES.min}–${BLOCKED_TILES.max} tiles`);
	if (!tiles.every((t) => Number.isInteger(t.x) && Number.isInteger(t.y)))
		fail('tiles must be whole tile coordinates');
}
