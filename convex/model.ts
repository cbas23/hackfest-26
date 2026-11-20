/**
 * Shapes of the Hollow's shared state. All of it is fictional: the control center
 * (`/control`) writes it and the main map reads it. Map geometry (tunnels, rooms,
 * facilities, residents) stays in the browser; the state points into it by level and tile
 * coordinates.
 */
import { v } from 'convex/values';

/** What a point puts out of order (power, water or air), or a lung-sickness outbreak. */
export const pointKind = v.union(
	v.literal('power'),
	v.literal('water'),
	v.literal('air'),
	v.literal('sickness')
);

/**
 * A source of bad power, water or air, or a lung-sickness outbreak, at a tile. It pushes the
 * blocks it reaches towards bad, fading out to `radius`: walking distance along the tunnels
 * for power and water, straight-line distance for air and sickness (see
 * `src/lib/hollow/conditions.ts` and `sickness.ts`).
 */
export const point = v.object({
	kind: pointKind,
	level: v.number(),
	x: v.number(),
	y: v.number(),
	radius: v.number(),
	/** Its push at the centre, 0.1–1 (1 when unset). */
	strength: v.optional(v.number()),
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

/** The Hollow has seven levels, L1 (0) to L7 (6). */
export const LEVEL_COUNT = 7;
export const POINT_RADIUS = { min: 2, max: 60 } as const;
export const POINT_STRENGTH = { min: 0.1, max: 1 } as const;
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

export function checkStrength(strength: number | undefined) {
	if (strength !== undefined && !(strength >= POINT_STRENGTH.min && strength <= POINT_STRENGTH.max))
		fail(`strength must be ${POINT_STRENGTH.min}–${POINT_STRENGTH.max}`);
}

export function checkTiles(tiles: { x: number; y: number }[]) {
	if (tiles.length < BLOCKED_TILES.min || tiles.length > BLOCKED_TILES.max)
		fail(`a blocked tunnel covers ${BLOCKED_TILES.min}–${BLOCKED_TILES.max} tiles`);
	if (!tiles.every((t) => Number.isInteger(t.x) && Number.isInteger(t.y)))
		fail('tiles must be whole tile coordinates');
}
