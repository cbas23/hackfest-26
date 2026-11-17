import * as THREE from 'three';
import type { Point, Room, TunnelMap } from '#lib/tunnels/generate.js';
import { disposeTree, hash01, toColor, toGeometry } from './geometry.js';
import {
	buildMeshes,
	toRGB,
	type FlatGrid,
	type MeshInput,
	type MeshOutput,
	type PlainProp,
	type PlainRoom
} from './mesh.js';
import { meshAsync } from './mesher.js';

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
	/** Whether a named part is currently shown. */
	partVisible(part: string): boolean;
	/**
	 * Draw these rooms a second time, fully opaque and in the transparent pass at `order`
	 * (default 8), so they cover overlays drawn before them even when those overlays ignore
	 * depth. Replaces the previous set; [] clears it. Raised rooms follow part visibility.
	 */
	raise(rooms: Room[], order?: number): void;
	/** Multiply the tunnels' colours by `color` (e.g. a grey to dim them); null resets. */
	setTunnelTint(color: Color | null): void;
	/** The resolved look of a room, or null when it isn't drawn. */
	lookOf(room: Room): RoomLook | null;
	/** Height of a room's roof above the layer floor in blocks (0 when not drawn). */
	heightOf(room: Room): number;
	/** How far below the layer floor a room's base sits, in blocks (0 when not drawn). */
	sinkOf(room: Room): number;
	readonly tunnelHeight: number;
	/**
	 * Meshes are built off the main thread, so they appear a moment after the layer is
	 * added or restyled (until then the previous look, or nothing, stays on screen). Looks,
	 * heights and picking are ready at once. Resolves when the latest build is on screen.
	 */
	readonly ready: Promise<void>;
}

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

const rgb = (c: Color) => toRGB(toColor(c));

/** Tile grids flattened for the mesher, once per map. */
const flatGrids = new WeakMap<TunnelMap, FlatGrid>();
let nextGridId = 0;
function flatten(map: TunnelMap): FlatGrid {
	let f = flatGrids.get(map);
	if (f) return f;
	const road = new Uint8Array(map.width * map.height);
	const roomAt = new Int32Array(map.width * map.height).fill(-1);
	for (let y = 0; y < map.height; y++)
		for (let x = 0; x < map.width; x++) {
			const i = y * map.width + x;
			if (map.grid[y]?.[x] === 'road') road[i] = 1;
			roomAt[i] = map.roomAt[y]?.[x] ?? -1;
		}
	flatGrids.set(map, (f = { id: nextGridId++, width: map.width, road, roomAt }));
	return f;
}

export class Layer implements MapLayer {
	readonly object = new THREE.Group();
	private body = new THREE.Group();
	private raisedBody = new THREE.Group();
	private raised: { rooms: Room[]; order: number } = { rooms: [], order: 8 };
	private parts = new Map<string, THREE.Object3D[]>();
	private tunnelMat: THREE.MeshLambertMaterial | null = null;
	private tunnelTint: Color | null = null;
	private raisedParts = new Map<string, THREE.Object3D[]>();
	private hiddenParts = new Set<string>();
	private looks: (RoomLook | null)[] = [];
	private sinks: number[] = [];
	/** Each room's look in mesher form, resolved with the looks. */
	private plain: (PlainRoom | null)[] = [];
	/** Bumped on every build, so a stale worker result is dropped. */
	private version = 0;
	private disposed = false;
	tunnelHeight = 1.5;
	ready: Promise<void> = Promise.resolve();

	constructor(
		readonly id: string,
		readonly map: TunnelMap,
		private style: LayerStyle,
		private space: Space,
		/** Compiles a new body's shaders before it goes on screen (e.g. `compileAsync`). */
		private prepare?: (object: THREE.Object3D) => Promise<unknown>
	) {
		this.object.name = `layer:${id}`;
		this.object.add(this.body, this.raisedBody);
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

	partVisible(part: string) {
		return !this.hiddenParts.has(part);
	}

	setPartVisible(part: string, visible: boolean) {
		if (visible) this.hiddenParts.delete(part);
		else this.hiddenParts.add(part);
		for (const o of this.parts.get(part) ?? []) o.visible = visible;
		for (const o of this.raisedParts.get(part) ?? []) o.visible = visible;
	}

	setTunnelTint(color: Color | null) {
		this.tunnelTint = color;
		this.tunnelMat?.color.set(color ?? 0xffffff);
	}

	raise(rooms: Room[], order = 8) {
		this.raised = { rooms, order };
		this.buildRaised();
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
		this.disposed = true;
		disposeTree(this.object);
		this.object.removeFromParent();
	}

	/** Mesher input for some rooms (and the tunnels, if asked). */
	private meshInput(rooms: PlainRoom[], withTunnels: boolean): MeshInput {
		const { style, map } = this;
		const tunnel = style.tunnel === undefined ? DEFAULT_TUNNEL : style.tunnel;
		const wall = tunnel && toColor(tunnel.wall);
		return {
			grid: flatten(map),
			rooms,
			origin: { ...this.space.origin },
			seed: style.seed ?? 0,
			jitter: style.jitter ?? 1,
			tunnel:
				withTunnels && tunnel && wall
					? {
							top: rgb(tunnel.top),
							wall: toRGB(wall),
							under: tunnel.underside
								? rgb(tunnel.underside)
								: toRGB(wall.clone().multiplyScalar(0.6)),
							height: tunnel.height ?? 1.5
						}
					: null
		};
	}

	/**
	 * Resolve every room's look and sink now (cheap, and what picking and overlays read),
	 * then build the meshes in the background and swap them in when they arrive.
	 */
	private build() {
		const { style, map } = this;
		const tunnel = style.tunnel === undefined ? DEFAULT_TUNNEL : style.tunnel;
		this.tunnelHeight = tunnel ? (tunnel.height ?? 1.5) : 0;
		const seed0 = style.seed ?? 0;
		const lookFn = style.room ?? defaultRoomLook;
		const sinkChance = style.sinkChance ?? 0.4;
		const maxSink = Math.max(1, style.maxSink ?? 2);
		this.looks = map.rooms.map(() => null);
		this.sinks = map.rooms.map(() => 0);
		this.plain = map.rooms.map(() => null);
		for (const r of map.rooms) {
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
			// Keep at least one block of the room level with the tunnel so the door stays connected.
			sink = Math.max(0, Math.min(sink, Math.floor(look.height) - 1));
			this.sinks[r.id] = sink;
			this.plain[r.id] = {
				id: r.id,
				x: r.x,
				y: r.y,
				w: r.w,
				h: r.h,
				door: r.door,
				access: r.access,
				wall: rgb(look.wall),
				roof: rgb(look.roof),
				height: look.height,
				doorColor: look.door === null ? null : rgb(look.door ?? '#e6ecff'),
				props: (look.props ?? []).map((p): PlainProp =>
					p.type === 'quad'
						? { ...p, color: rgb(p.color), glow: !!p.glow }
						: { ...p, wall: rgb(p.wall), roof: rgb(p.roof ?? p.wall), glow: !!p.glow }
				),
				part: look.part ?? '',
				sink
			};
		}

		const input = this.meshInput(
			this.plain.filter((p): p is PlainRoom => !!p),
			true
		);
		const ghost = style.ghostOpacity ?? DEFAULT_GHOST;
		const version = ++this.version;
		const stale = () => version !== this.version || this.disposed;
		this.ready = meshAsync(input).then(async (out) => {
			if (stale()) return;
			const next = this.makeBody(out, ghost);
			// Compile its shaders off the critical path, so the swap itself never stalls a frame.
			await this.prepare?.(next.body).catch(() => {});
			if (stale()) disposeTree(next.body);
			else this.swapBody(next);
		});
		this.buildRaised();
	}

	/** Swap freshly built meshes in for the current ones. */
	/** Meshes for freshly built geometry, not yet on screen. */
	private makeBody(out: MeshOutput, ghost: number) {
		const body = new THREE.Group();
		const parts = new Map<string, THREE.Object3D[]>();
		// Tunnels mark the stencil buffer wherever they are on screen; rooms are drawn twice
		// against that mark, opaque where no tunnel is behind and see-through where one is,
		// so a room never hides the network.
		const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number) => {
			const m = new THREE.Mesh(geo, mat);
			m.renderOrder = order;
			body.add(m);
			return m;
		};
		let tunnelMat: THREE.MeshLambertMaterial | null = null;
		if (out.tunnels) {
			tunnelMat = new THREE.MeshLambertMaterial({
				vertexColors: true,
				color: this.tunnelTint ?? 0xffffff,
				stencilWrite: true,
				stencilRef: 1,
				stencilFunc: THREE.AlwaysStencilFunc,
				stencilZPass: THREE.ReplaceStencilOp
			});
			mesh(toGeometry(out.tunnels), tunnelMat, 1);
		}
		const solidMats = ghostedPair((p) => new THREE.MeshLambertMaterial(p), ghost);
		const glowMats = ghostedPair((p) => new THREE.MeshBasicMaterial(p), ghost);
		for (const { part, solid, glow } of out.parts) {
			const objs: THREE.Object3D[] = [];
			for (const [arrays, mats] of [
				[solid, solidMats],
				[glow, glowMats]
			] as const) {
				if (!arrays) continue;
				const geo = toGeometry(arrays);
				mats.forEach((m, i) => objs.push(mesh(geo, m, 2 + i)));
			}
			parts.set(part, objs);
		}
		return { body, parts, tunnelMat };
	}

	/** Put a prepared body on screen in place of the current one. */
	private swapBody(next: ReturnType<Layer['makeBody']>) {
		disposeTree(this.body);
		this.object.remove(this.body);
		this.body = next.body;
		this.object.add(this.body);
		this.parts = next.parts;
		this.tunnelMat = next.tunnelMat;
		// The tint or hidden parts may have changed while it was being built.
		this.tunnelMat?.color.set(this.tunnelTint ?? 0xffffff);
		for (const [part, objs] of this.parts) {
			const visible = !this.hiddenParts.has(part);
			for (const o of objs) o.visible = visible;
		}
	}

	/** Raised rooms are few, so they are built right away on the main thread. */
	private buildRaised() {
		disposeTree(this.raisedBody);
		this.raisedBody.clear();
		this.raisedParts.clear();
		const rooms = this.raised.rooms.map((r) => this.plain[r.id]).filter((p): p is PlainRoom => !!p);
		if (!rooms.length) return;
		const out = buildMeshes(this.meshInput(rooms, false));
		// Transparent (at full opacity) so they sort after transparent overlays at a lower order.
		const params = { vertexColors: true, transparent: true, opacity: 1, depthWrite: true };
		for (const { part, solid, glow } of out.parts) {
			const objs: THREE.Object3D[] = [];
			for (const [arrays, make] of [
				[solid, () => new THREE.MeshLambertMaterial(params)],
				[glow, () => new THREE.MeshBasicMaterial(params)]
			] as const) {
				if (!arrays) continue;
				const m = new THREE.Mesh(toGeometry(arrays), make());
				m.renderOrder = this.raised.order;
				m.visible = !this.hiddenParts.has(part);
				this.raisedBody.add(m);
				objs.push(m);
			}
			this.raisedParts.set(part, objs);
		}
	}
}
