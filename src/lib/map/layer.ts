import * as THREE from 'three';
import type { Point, Room, TunnelMap } from '#lib/tunnels/generate.js';
import { Builder, SIDES, disposeTree, hash01, shade, toColor, type Dir } from './geometry.js';

export type Color = THREE.ColorRepresentation;

/** Maps tile coordinates to world space. Tile (0,0) is the north-west corner; `origin` sits at world 0. */
export class Space {
	origin: Point = { x: 0, y: 0 };
	wx = (x: number) => x - this.origin.x;
	wz = (y: number) => y - this.origin.y;
	tx = (wx: number) => wx + this.origin.x;
	ty = (wz: number) => wz + this.origin.y;
}

// ── Style ────────────────────────────────────────────────────────────────────

export interface TunnelLook {
	/** Roof of the tunnel (what you see from above). */
	top: Color;
	wall: Color;
	/** Underside, seen when looking up at a stacked layer. Defaults to a darkened wall. */
	underside?: Color;
	/** Height in blocks (default 1.5). */
	height?: number;
}

/**
 * Extra geometry on a room, in room-local tiles: (0,0) is the room's north-west corner,
 * (w,h) its far corner. `z` is height in blocks above the layer floor.
 * `glow` props are unlit (they keep their exact colour).
 */
export type Prop =
	| {
			type: 'box';
			x0: number;
			y0: number;
			x1: number;
			y1: number;
			z0: number;
			z1: number;
			wall: Color;
			roof?: Color;
			glow?: boolean;
	  }
	| {
			type: 'quad';
			x0: number;
			y0: number;
			x1: number;
			y1: number;
			z: number;
			color: Color;
			glow?: boolean;
	  };

export interface RoomLook {
	wall: Color;
	roof: Color;
	/** Height in whole blocks. */
	height: number;
	/** Door opening on the face toward the room's access tile; null hides it. */
	door?: Color | null;
	props?: Prop[];
	/** Named group this room is drawn into, so it can be shown/hidden separately. */
	part?: string;
	/** Whether pointer picking can land on it (default true). */
	pickable?: boolean;
	/** Blocks the room sits below the layer floor. Omit for a random, seeded depth. */
	sink?: number;
}

export interface LayerStyle {
	/** null hides the tunnels. */
	tunnel?: TunnelLook | null;
	/** How each room looks; null skips it (not drawn, not pickable). */
	room?: (room: Room) => RoomLook | null;
	/** Opacity of rooms where they stand in front of a tunnel; 0 turns see-through off. */
	ghostOpacity?: number;
	/** Seed for per-block brightness jitter. */
	seed?: number;
	/** Scales the brightness jitter (0 = flat colours, default 1). */
	jitter?: number;
	/** Chance (0..1) a room without an explicit `sink` is dug in below the floor (default 0.4). */
	sinkChance?: number;
	/** Deepest random sink, in whole blocks (default 2). */
	maxSink?: number;
}

export const DEFAULT_TUNNEL: TunnelLook = {
	top: '#c3cdee',
	wall: '#a3aed6',
	height: 1.5
};

export const defaultRoomLook = (r: Room): RoomLook => ({
	wall: '#7a81af',
	roof: '#5f6694',
	height: r.kind === 'gate' ? 4 : r.kind === 'room' ? 2 : 3,
	door: '#e6ecff'
});

// ── Layer ────────────────────────────────────────────────────────────────────

export interface MapLayer {
	readonly id: string;
	readonly map: TunnelMap;
	/** The layer's root object: meshes and layer-attached overlays live under it. */
	readonly object: THREE.Group;
	readonly y: number;
	readonly visible: boolean;
	/** Move (y, in blocks) or show/hide the layer, overlays and markers included. */
	set(t: { y?: number; visible?: boolean }): void;
	/** Rebuild the meshes with a new style. */
	setStyle(style: LayerStyle): void;
	/** Show or hide a named part (see RoomLook.part). */
	setPartVisible(part: string, visible: boolean): void;
	/** The resolved look of a room, or null when it isn't drawn. */
	lookOf(room: Room): RoomLook | null;
	/** Height of a room's roof above the layer floor in blocks (0 when not drawn). */
	heightOf(room: Room): number;
	/** How far below the layer floor a room's base sits, in blocks (0 when not drawn). */
	sinkOf(room: Room): number;
	readonly tunnelHeight: number;
}

/** Tunnel faces darken toward the floor by this factor; rooms by `ROOM_FLOOR_SHADE`. */
const TUNNEL_FLOOR_SHADE = 0.8;
const ROOM_FLOOR_SHADE = 0.7;
const DOOR_HALF_WIDTH = 0.32;
const DOOR_HEIGHT = 1.4;
const DEFAULT_GHOST = 0.28;

/** Opaque wherever no tunnel is behind; see-through wherever one is (via the stencil mark). */
function ghostedPair(
	make: (p: THREE.MeshBasicMaterialParameters) => THREE.Material,
	opacity: number
) {
	if (!opacity) return [make({ vertexColors: true })] as const;
	const opaque = make({
		vertexColors: true,
		stencilWrite: true,
		stencilRef: 1,
		stencilFunc: THREE.NotEqualStencilFunc
	});
	const ghost = make({
		vertexColors: true,
		transparent: true,
		opacity,
		depthWrite: false,
		stencilWrite: true,
		stencilRef: 1,
		stencilFunc: THREE.EqualStencilFunc
	});
	return [opaque, ghost] as const;
}

export class Layer implements MapLayer {
	readonly object = new THREE.Group();
	private body = new THREE.Group();
	private parts = new Map<string, THREE.Object3D[]>();
	private hiddenParts = new Set<string>();
	private looks: (RoomLook | null)[] = [];
	private sinks: number[] = [];
	tunnelHeight = 1.5;

	constructor(
		readonly id: string,
		readonly map: TunnelMap,
		private style: LayerStyle,
		private space: Space
	) {
		this.object.name = `layer:${id}`;
		this.object.add(this.body);
		this.build();
	}

	get y() {
		return this.object.position.y;
	}
	get visible() {
		return this.object.visible;
	}

	set(t: { y?: number; visible?: boolean }) {
		if (t.y !== undefined) this.object.position.y = t.y;
		if (t.visible !== undefined) this.object.visible = t.visible;
	}

	setStyle(style: LayerStyle) {
		this.style = style;
		this.build();
	}

	setPartVisible(part: string, visible: boolean) {
		if (visible) this.hiddenParts.delete(part);
		else this.hiddenParts.add(part);
		for (const o of this.parts.get(part) ?? []) o.visible = visible;
	}

	lookOf(room: Room) {
		return this.looks[room.id] ?? null;
	}

	heightOf(room: Room) {
		const look = this.looks[room.id];
		return look ? look.height - this.sinkOf(room) : 0;
	}

	sinkOf(room: Room) {
		return this.sinks[room.id] ?? 0;
	}

	dispose() {
		disposeTree(this.object);
		this.object.removeFromParent();
	}

	private build() {
		disposeTree(this.body);
		this.body.clear();
		this.parts.clear();

		const { map, style, space } = this;
		const { grid, roomAt, rooms } = map;
		const { wx, wz } = space;
		const seed0 = style.seed ?? 0;
		const j = style.jitter ?? 1;
		const tile = (x: number, y: number) => (y * map.width + x) * 7 + seed0;

		/** A run of 1-block-high wall faces, darker toward the bottom. */
		const wallColumn = (
			b: Builder,
			d: Dir,
			x0: number,
			z0: number,
			h: number,
			base: THREE.Color,
			seed: number,
			floorShade: number
		) => {
			for (let k = 0; k < h; k++) {
				const top = Math.min(k + 1, h);
				const col = shade(base, seed + d.charCodeAt(0) * 13 + k, 0.1 * j);
				const lo = col.clone().multiplyScalar(floorShade + (1 - floorShade) * (k / h));
				const hi = col.clone().multiplyScalar(floorShade + (1 - floorShade) * (top / h));
				b.side(d, x0, z0, x0 + 1, z0 + 1, k, top, hi, false, lo);
			}
		};

		// ── Tunnels ─────────────────────────────────────────────────────────────
		const tunnels = new Builder();
		const tunnel = style.tunnel === undefined ? DEFAULT_TUNNEL : style.tunnel;
		if (tunnel) {
			const th = tunnel.height ?? 1.5;
			this.tunnelHeight = th;
			const top = toColor(tunnel.top);
			const wall = toColor(tunnel.wall);
			const under = tunnel.underside ? toColor(tunnel.underside) : wall.clone().multiplyScalar(0.6);
			const isRoad = (x: number, y: number) => grid[y]?.[x] === 'road';
			for (let y = 0; y < map.height; y++)
				for (let x = 0; x < map.width; x++) {
					if (!isRoad(x, y)) continue;
					const x0 = wx(x);
					const z0 = wz(y);
					const seed = tile(x, y);
					// Only adjoining tunnel tiles share an open face. Walls stay beside rooms so the
					// tunnel owns its full silhouette (and stencil mask), even at a door.
					for (const [d, dx, dy] of SIDES)
						if (!isRoad(x + dx, y + dy))
							wallColumn(tunnels, d, x0, z0, th, wall, seed, TUNNEL_FLOOR_SHADE);
					tunnels.top(x0, z0, x0 + 1, z0 + 1, th, shade(top, seed, 0.06 * j));
					tunnels.top(x0, z0, x0 + 1, z0 + 1, 0, under, true);
				}
		} else this.tunnelHeight = 0;

		// ── Rooms ───────────────────────────────────────────────────────────────
		const builders = new Map<string, { solid: Builder; glow: Builder }>();
		const into = (part: string) => {
			let b = builders.get(part);
			if (!b) builders.set(part, (b = { solid: new Builder(), glow: new Builder() }));
			return b;
		};
		const lookFn = style.room ?? defaultRoomLook;
		this.looks = rooms.map(() => null);
		this.sinks = rooms.map(() => 0);
		const sinkChance = style.sinkChance ?? 0.4;
		const maxSink = Math.max(1, style.maxSink ?? 2);
		for (const r of rooms) {
			const look = lookFn(r);
			this.looks[r.id] = look;
			if (!look) continue;
			// Rooms are dug out of the rock, so some sit lower than the tunnel floor.
			// Gates stay level: they are the shafts and exits that link floors.
			let sink = look.sink;
			if (sink === undefined) {
				const roll = hash01(r.id * 7919 + seed0 * 31 + 1);
				sink =
					r.kind !== 'gate' && roll < sinkChance
						? 1 + Math.floor((roll / sinkChance) * maxSink)
						: 0;
			}
			this.sinks[r.id] = sink;
			const { solid, glow } = into(look.part ?? '');
			solid.lift = glow.lift = -sink;
			const h = look.height;
			const wall = toColor(look.wall);
			const roof = toColor(look.roof);
			for (let y = r.y; y < r.y + r.h; y++)
				for (let x = r.x; x < r.x + r.w; x++) {
					const x0 = wx(x);
					const z0 = wz(y);
					const seed = tile(x, y);
					for (const [d, dx, dy] of SIDES)
						if (roomAt[y + dy]?.[x + dx] !== r.id)
							wallColumn(solid, d, x0, z0, h, wall, seed, ROOM_FLOOR_SHADE);
					solid.top(x0, z0, x0 + 1, z0 + 1, h, shade(roof, seed, 0.08 * j));
				}

			const ox = wx(r.x);
			const oz = wz(r.y);
			for (const p of look.props ?? []) {
				const b = p.glow ? glow : solid;
				if (p.type === 'quad')
					b.top(ox + p.x0, oz + p.y0, ox + p.x1, oz + p.y1, p.z, toColor(p.color));
				else
					b.box(
						ox + p.x0,
						oz + p.y0,
						ox + p.x1,
						oz + p.y1,
						p.z0,
						p.z1,
						toColor(p.wall),
						toColor(p.roof ?? p.wall)
					);
			}

			if (look.door !== null) {
				// A pale opening on the wall face toward the room's one tunnel.
				const door = toColor(look.door ?? '#e6ecff');
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

		// ── Meshes ──────────────────────────────────────────────────────────────
		// Tunnels mark the stencil buffer wherever they are on screen; rooms are drawn twice
		// against that mark, opaque where no tunnel is behind and see-through where one is,
		// so a room never hides the network.
		const ghost = style.ghostOpacity ?? DEFAULT_GHOST;
		const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number) => {
			const m = new THREE.Mesh(geo, mat);
			m.renderOrder = order;
			this.body.add(m);
			return m;
		};
		if (!tunnels.empty)
			mesh(
				tunnels.build(),
				new THREE.MeshLambertMaterial({
					vertexColors: true,
					stencilWrite: true,
					stencilRef: 1,
					stencilFunc: THREE.AlwaysStencilFunc,
					stencilZPass: THREE.ReplaceStencilOp
				}),
				1
			);
		const solidMats = ghostedPair((p) => new THREE.MeshLambertMaterial(p), ghost);
		const glowMats = ghostedPair((p) => new THREE.MeshBasicMaterial(p), ghost);
		for (const [part, { solid, glow }] of builders) {
			const objs: THREE.Object3D[] = [];
			for (const [b, mats] of [
				[solid, solidMats],
				[glow, glowMats]
			] as const) {
				if (b.empty) continue;
				const geo = b.build();
				mats.forEach((m, i) => objs.push(mesh(geo, m, 2 + i)));
			}
			const visible = !this.hiddenParts.has(part);
			for (const o of objs) o.visible = visible;
			this.parts.set(part, objs);
		}
	}
}
