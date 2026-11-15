/**
 * Compact storage for pre-generated floors, so the Hollow loads without running the
 * tunnel generator (~4 s for all seven floors at 500×400). Regenerate with
 * `bun run bake:hollow` after changing the generator, `FLOOR_CONFIG`, levels or seed.
 */
import type { GateSpec, Room, TileType, TunnelMap } from '#lib/tunnels/generate.js';

/** One character per tile type. */
const TILE_CODE: Record<TileType, string> = {
	void: '.',
	rock: '#',
	road: '=',
	room: 'r',
	gate: 'g',
	farm: 'f',
	plant: 'p'
};
const CODE_TILE = Object.fromEntries(
	Object.entries(TILE_CODE).map(([t, c]) => [c, t as TileType])
) as Record<string, TileType>;

/** Room as a tuple: kind, x, y, w, h, door x/y, access x/y, then exit x/y and specIndex (-1 if none). */
type BakedRoom = [
	string,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number
];

export interface BakedFloor {
	seed: number;
	/** Whole grid, row-major, run-length encoded as `<count><code>` runs. */
	grid: string;
	rooms: BakedRoom[];
}

export interface BakedHollow {
	seed: number;
	width: number;
	height: number;
	gateSpecs: GateSpec[];
	floors: BakedFloor[];
}

export function encodeFloor(map: TunnelMap): BakedFloor {
	let grid = '';
	let prev = '';
	let run = 0;
	for (const row of map.grid)
		for (const t of row) {
			const c = TILE_CODE[t];
			if (c === prev) run++;
			else {
				if (run) grid += run + prev;
				prev = c;
				run = 1;
			}
		}
	if (run) grid += run + prev;
	const rooms = map.rooms.map((r): BakedRoom => [
		r.kind,
		r.x,
		r.y,
		r.w,
		r.h,
		r.door.x,
		r.door.y,
		r.access.x,
		r.access.y,
		r.exit?.x ?? -1,
		r.exit?.y ?? -1,
		r.specIndex ?? -1
	]);
	return { seed: map.seed, grid, rooms };
}

export function decodeFloor(hollow: BakedHollow, index: number): TunnelMap {
	const { width, height } = hollow;
	const { seed, grid: encoded, rooms: baked } = hollow.floors[index];
	const flat: TileType[] = new Array(width * height);
	let i = 0;
	let n = 0;
	for (let k = 0; k < encoded.length; k++) {
		const ch = encoded.charCodeAt(k);
		if (ch >= 48 && ch <= 57) n = n * 10 + ch - 48;
		else {
			flat.fill(CODE_TILE[encoded[k]], i, i + n);
			i += n;
			n = 0;
		}
	}
	const grid = Array.from({ length: height }, (_, y) => flat.slice(y * width, (y + 1) * width));
	const roomAt = Array.from({ length: height }, () => new Array<number>(width).fill(-1));
	const rooms = baked.map(([kind, x, y, w, h, dx, dy, ax, ay, ex, ey, spec], id): Room => {
		const room: Room = {
			id,
			kind: kind as Room['kind'],
			x,
			y,
			w,
			h,
			door: { x: dx, y: dy },
			access: { x: ax, y: ay }
		};
		if (ex >= 0) room.exit = { x: ex, y: ey };
		if (spec >= 0) room.specIndex = spec;
		for (let ty = y; ty < y + h; ty++) roomAt[ty].fill(id, x, x + w);
		return room;
	});
	let roadCount = 0;
	for (const t of flat) if (t === 'road') roadCount++;
	return { width, height, seed, grid, roomAt, rooms, roadCount };
}
