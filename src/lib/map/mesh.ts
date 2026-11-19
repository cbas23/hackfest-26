/**
 * Layer mesh building as a pure function of plain, cloneable data, so it can run in a
 * worker (see `mesher.ts`) and keep the main thread free while a level is built.
 */
import * as THREE from 'three';
import type { Point } from '#lib/tunnels/generate.js';
import { Builder, SIDES, type Dir, type MeshArrays } from './geometry.js';

export type { MeshArrays };

/** A colour as linear [r, g, b], exactly as `THREE.Color` holds it. */
export type RGB = [number, number, number];

export type PlainProp =
	| {
			type: 'box';
			x0: number;
			y0: number;
			x1: number;
			y1: number;
			z0: number;
			z1: number;
			wall: RGB;
			roof: RGB;
			glow: boolean;
	  }
	| {
			type: 'quad';
			x0: number;
			y0: number;
			x1: number;
			y1: number;
			z: number;
			color: RGB;
			glow: boolean;
	  };

/** One room to draw, with its look already resolved. */
export interface PlainRoom {
	id: number;
	x: number;
	y: number;
	w: number;
	h: number;
	door: Point;
	access: Point;
	wall: RGB;
	roof: RGB;
	height: number;
	doorColor: RGB | null;
	props: PlainProp[];
	part: string;
	sink: number;
}

/** A map's tile grid, flattened. It never changes, so the worker keeps it by `id`. */
export interface FlatGrid {
	id: number;
	width: number;
	/** 1 where the tile is tunnel (row-major). */
	road: Uint8Array;
	/** Room id per tile, -1 if none (row-major). */
	roomAt: Int32Array;
}

export interface MeshInput {
	grid: FlatGrid;
	rooms: PlainRoom[];
	origin: Point;
	seed: number;
	jitter: number;
	tunnel: {
		top: RGB;
		wall: RGB;
		under: RGB;
		height: number;
		/** Tiles (row-major index) drawn in their own colour. */
		paint: { tile: number; top: RGB }[];
	} | null;
}

export interface MeshOutput {
	tunnels: MeshArrays | null;
	parts: { part: string; solid: MeshArrays | null; glow: MeshArrays | null }[];
}

const DOOR_HALF_WIDTH = 0.32;
const DOOR_HEIGHT = 1.4;

export const toRGB = (c: THREE.Color): RGB => [c.r, c.g, c.b];
const fromRGB = (c: RGB) => new THREE.Color(c[0], c[1], c[2]);

/**
 * Shading baked into the colours, as if lit from high in the north-west. The meshes render
 * unlit, so it never depends on the scene lights or goes black from any angle: tops at full
 * colour, each wall by the way it faces (lit walls bright, walls facing away in shadow) and
 * darker toward its base, undersides darkest.
 */
export const SIDE_SHADE: Record<Dir, number> = { n: 0.9, w: 0.8, e: 0.6, s: 0.5 };
/** A wall's base, relative to its top edge. */
export const WALL_BASE_FALLOFF = 0.8;
export const UNDERSIDE_SHADE = 0.45;
const shaded = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k);

export function buildMeshes(input: MeshInput): MeshOutput {
	// Every tunnel, room and fixture is one colour, shaded by face (see SIDE_SHADE).
	// Rendered unlit, so it reads much the same from above, from the side and from underneath.
	const { origin } = input;
	const { width, road, roomAt } = input.grid;
	const wx = (x: number) => x - origin.x;
	const wz = (y: number) => y - origin.y;
	const isRoad = (x: number, y: number) => x >= 0 && x < width && road[y * width + x] === 1;
	const roomOf = (x: number, y: number) =>
		x >= 0 && x < width && y >= 0 ? (roomAt[y * width + x] ?? -1) : -1;

	/** A wall face, floor to `h`, shaded by the way it faces and darker toward its base. */
	const wallColumn = (b: Builder, d: Dir, x0: number, z0: number, h: number, color: THREE.Color) =>
		b.side(
			d,
			x0,
			z0,
			x0 + 1,
			z0 + 1,
			0,
			h,
			shaded(color, SIDE_SHADE[d]),
			false,
			shaded(color, SIDE_SHADE[d] * WALL_BASE_FALLOFF)
		);

	// ── Tunnels ───────────────────────────────────────────────────────────────
	let tunnels: MeshArrays | null = null;
	if (input.tunnel) {
		const b = new Builder();
		const th = input.tunnel.height;
		const base = fromRGB(input.tunnel.top);
		const painted = new Map(input.tunnel.paint.map((p) => [p.tile, fromRGB(p.top)]));
		const height = road.length / width;
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				if (!isRoad(x, y)) continue;
				const x0 = wx(x);
				const z0 = wz(y);
				const color = painted.get(y * width + x) ?? base;
				// Only adjoining tunnel tiles share an open face. Walls stay beside rooms so the
				// tunnel owns its full silhouette (and stencil mask), even at a door.
				for (const [d, dx, dy] of SIDES)
					if (!isRoad(x + dx, y + dy)) wallColumn(b, d, x0, z0, th, color);
				b.top(x0, z0, x0 + 1, z0 + 1, th, color);
				b.top(x0, z0, x0 + 1, z0 + 1, 0, shaded(color, UNDERSIDE_SHADE), true);
			}
		if (!b.empty) tunnels = b.arrays();
	}

	// ── Rooms ─────────────────────────────────────────────────────────────────
	const builders = new Map<string, { solid: Builder; glow: Builder }>();
	for (const r of input.rooms) {
		let bs = builders.get(r.part);
		if (!bs) builders.set(r.part, (bs = { solid: new Builder(), glow: new Builder() }));
		const { solid, glow } = bs;
		solid.lift = glow.lift = -r.sink;
		const h = r.height;
		// The roof colour is the room's identity (data lenses paint it), so it covers every face.
		const color = fromRGB(r.roof);
		for (let y = r.y; y < r.y + r.h; y++)
			for (let x = r.x; x < r.x + r.w; x++) {
				const x0 = wx(x);
				const z0 = wz(y);
				for (const [d, dx, dy] of SIDES)
					if (roomOf(x + dx, y + dy) !== r.id) wallColumn(solid, d, x0, z0, h, color);
				solid.top(x0, z0, x0 + 1, z0 + 1, h, color);
				solid.top(x0, z0, x0 + 1, z0 + 1, 0, shaded(color, UNDERSIDE_SHADE), true);
			}

		const ox = wx(r.x);
		const oz = wz(r.y);
		for (const p of r.props) {
			const b = p.glow ? glow : solid;
			if (p.type === 'quad')
				b.top(ox + p.x0, oz + p.y0, ox + p.x1, oz + p.y1, p.z, fromRGB(p.color));
			else {
				const c = fromRGB(p.roof);
				const [x0, z0, x1, z1] = [ox + p.x0, oz + p.y0, ox + p.x1, oz + p.y1];
				for (const [d] of SIDES) b.side(d, x0, z0, x1, z1, p.z0, p.z1, shaded(c, SIDE_SHADE[d]));
				b.top(x0, z0, x1, z1, p.z1, c);
			}
		}

		if (r.doorColor) {
			// A pale opening on the wall face toward the room's one tunnel.
			const door = fromRGB(r.doorColor);
			const dx = r.access.x - r.door.x;
			const dz = r.access.y - r.door.y;
			const mx = wx(r.door.x) + 0.5 + dx * 0.52;
			const mz = wz(r.door.y) + 0.5 + dz * 0.52;
			const side: Dir = dx > 0 ? 'e' : dx < 0 ? 'w' : dz > 0 ? 's' : 'n';
			const hw = DOOR_HALF_WIDTH;
			if (dx !== 0) glow.side(side, mx - 0.5, mz - hw, mx + 0.5, mz + hw, 0, DOOR_HEIGHT, door);
			else glow.side(side, mx - hw, mz - 0.5, mx + hw, mz + 0.5, 0, DOOR_HEIGHT, door);
		}
		solid.lift = glow.lift = 0;
	}

	return {
		tunnels,
		parts: [...builders].map(([part, { solid, glow }]) => ({
			part,
			solid: solid.empty ? null : solid.arrays(),
			glow: glow.empty ? null : glow.arrays()
		}))
	};
}

/** The buffers in an output, to transfer (not copy) them out of a worker. */
export function transferables(out: MeshOutput): ArrayBuffer[] {
	const all = [out.tunnels, ...out.parts.flatMap((p) => [p.solid, p.glow])];
	return all.flatMap((a) =>
		a ? [a.position, a.normal, a.color, a.index].map((t) => t.buffer as ArrayBuffer) : []
	);
}
