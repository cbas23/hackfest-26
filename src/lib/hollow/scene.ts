import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { Point, Room } from '#lib/tunnels/generate.js';
import { FACILITY_INFO, FLOOR_CONFIG, LEVELS, SHAFTS, SHAFT_COLORS } from './data.js';
import type { Floor } from './world.js';

const W = FLOOR_CONFIG.width;
const H = FLOOR_CONFIG.height;
/** Height of a tunnel, in blocks (one tile = one block). The top block is a half block. */
const TUNNEL_H = 1.5;
/** Base height of a habitation block, in blocks; bigger blocks stand taller. */
const ROOM_BASE_H = 2;
/** Shaft landings are open well-tubes rising out of the level. */
const SHAFT_H = 7;
const TRAVEL = 10;

/** Height the route ribbon rides at: on top of the (solid) tunnels. */
const ROUTE_Y = TUNNEL_H;
/** Opacity of a place where it stands in front of a tunnel. */
const GHOST_OPACITY = 0.28;

/**
 * Which rooms the map draws besides tunnels. Everything is drawn now: habitation blocks,
 * farms, geothermal plants, shaft landings and civic facilities. Kept as one switch so a
 * kind can be hidden again in one place (it also controls picking, outlines and pins).
 */
export function isDrawn(_floor: Floor, r: Room | null | undefined): boolean {
	return !!r;
}

/** Tile space → world space: tile (0,0) is the north-west corner of the floor. */
const wx = (x: number) => x - W / 2;
const wz = (y: number) => y - H / 2;

export interface Pick {
	tile: Point;
	room: Room | null;
}

export interface Pin {
	el: HTMLElement;
	/** Tile coordinates (centre of the marker). */
	x: number;
	y: number;
	/** Height above the floor. */
	h?: number;
}

export interface SceneOptions {
	onHover(pick: Pick | null): void;
	onClick(pick: Pick | null): void;
	onView?(info: { distance: number; heading: number }): void;
}

export interface HollowScene {
	/** Show one floor; `dir` > 0 arrives from above (going deeper), < 0 from below. */
	showFloor(floor: Floor, dir: number): void;
	setHover(room: Room | null): void;
	setSelection(room: Room | null): void;
	/** Route polylines for the shown floor, plus the slice for the active step. */
	setRoute(paths: Point[][], active: Point[] | null): void;
	setPins(pins: Pin[]): void;
	flyTo(x: number, y: number, opts?: { distance?: number; heading?: Point; tilt?: number }): void;
	fitBounds(minX: number, minY: number, maxX: number, maxY: number): void;
	zoomBy(factor: number): void;
	resetNorth(): void;
	setPan(x: number, y: number): void;
	dispose(): void;
}

// ── Palette: muted, map-like ────────────────────────────────────────────────
function mix(a: string, b: string, t: number) {
	return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

/** Calm navigation palette; deeper floors only drift slightly warmer. */
function paletteFor(index: number) {
	const warm = LEVELS[index].heat * 0.22;
	return {
		road: mix('#c3cdee', '#d2c6c0', warm),
		tunnelWall: mix('#a3aed6', '#b4a69f', warm),
		placeWall: mix('#7a81af', '#827598', warm),
		placeRoof: mix('#5f6694', '#695c7e', warm),
		blockWallDark: mix('#4a4e72', '#4f465d', warm),
		blockRoofDark: mix('#383c5c', '#3d3549', warm),
		door: new THREE.Color('#e6ecff'),
		farmRoof: new THREE.Color('#1f6b67'),
		farmWall: new THREE.Color('#2a7d76'),
		crop: new THREE.Color('#38a897'),
		plantRoof: mix('#3c4060', '#43373f', warm),
		plantWall: mix('#575c80', '#5f5160', warm),
		plantCore: new THREE.Color('#ff9a52'),
		shaftRoof: new THREE.Color('#141a2b'),
		shaftWall: new THREE.Color('#3b4a74')
	};
}

// ── Geometry accumulator ────────────────────────────────────────────────────
type V3 = [number, number, number];
type Dir = 'n' | 's' | 'w' | 'e';

class Builder {
	private pos: number[] = [];
	private nor: number[] = [];
	private col: number[] = [];

	/**
	 * Counter-clockwise quad (front face toward `n`); `flip` turns it to face the other way.
	 * `color` is one colour or one per corner (a, b, c, d).
	 */
	private quad(
		a: V3,
		b: V3,
		c: V3,
		d: V3,
		n: V3,
		color: THREE.Color | THREE.Color[],
		flip = false
	) {
		const cs = Array.isArray(color) ? color : [color, color, color, color];
		const order = flip ? [3, 2, 1, 3, 1, 0] : [0, 1, 2, 0, 2, 3];
		const pts = [a, b, c, d];
		for (const i of order) {
			const p = pts[i];
			this.pos.push(p[0], p[1], p[2]);
			if (flip) this.nor.push(-n[0], -n[1], -n[2]);
			else this.nor.push(n[0], n[1], n[2]);
			this.col.push(cs[i].r, cs[i].g, cs[i].b);
		}
	}

	/** Horizontal face at height y, facing up (or down when `flip`). */
	top(x0: number, z0: number, x1: number, z1: number, y: number, c: THREE.Color, flip = false) {
		this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], c, flip);
	}

	/**
	 * Vertical face on side `dir` of the cell [x0,x1]×[z0,z1]. Faces outward by default;
	 * `inward` makes it face into the cell, which is how air pockets are drawn.
	 */
	side(
		dir: Dir,
		x0: number,
		z0: number,
		x1: number,
		z1: number,
		y0: number,
		y1: number,
		c: THREE.Color,
		inward = false,
		bottom = c
	) {
		// Every variant lists its corners bottom, top, top, bottom.
		const cs = [bottom, c, c, bottom];
		if (dir === 'n')
			this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], cs, inward);
		else if (dir === 's')
			this.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1], cs, inward);
		else if (dir === 'w')
			this.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0], cs, inward);
		else this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], cs, inward);
	}

	/** A solid object standing in the air (crops, machinery). */
	box(
		x0: number,
		z0: number,
		x1: number,
		z1: number,
		y0: number,
		y1: number,
		wall: THREE.Color,
		roof = wall
	) {
		for (const d of ['n', 's', 'w', 'e'] as const) this.side(d, x0, z0, x1, z1, y0, y1, wall);
		this.top(x0, z0, x1, z1, y1, roof);
	}

	build() {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
		g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
		g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
		return g;
	}
}

const hash01 = (n: number) => {
	let h = Math.imul(n + 0x9e3779b9, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
};

/** Per-block brightness jitter, so faces read as individual blocks. */
const shade = (c: THREE.Color, seed: number, amount = 0.1) =>
	c.clone().multiplyScalar(1 - amount / 2 + hash01(seed) * amount);

/** Ceiling height of a chamber, in whole blocks. */
export function roomHeight(floor: Floor, r: Room) {
	if (r.kind === 'gate') return SHAFT_H;
	if (r.kind === 'farm') return 3;
	if (r.kind === 'plant') return 4;
	if (floor.facilities.has(r.id)) return 3;
	const big = Math.min(r.w, r.h) >= 3 ? 1 : 0;
	return ROOM_BASE_H + big + (hash01(r.id + floor.index * 7919) > 0.75 ? 1 : 0);
}

const SIDES: [Dir, number, number][] = [
	['n', 0, -1],
	['s', 0, 1],
	['w', -1, 0],
	['e', 1, 0]
];

interface FloorMesh {
	group: THREE.Group;
	materials: THREE.Material[];
	opacity: number;
	y: number;
	targetY: number;
	targetOpacity: number;
}

/** Simple fixtures on a facility's roof that say what it is at a glance. */
function facilityProps(
	kind: keyof typeof FACILITY_INFO,
	r: Room,
	x0: number,
	z0: number,
	y: number,
	solid: Builder,
	glow: Builder
) {
	const accent = new THREE.Color(FACILITY_INFO[kind].color);
	const dim = accent.clone().multiplyScalar(0.55);
	const cx = x0 + r.w / 2;
	const cz = z0 + r.h / 2;
	if (kind === 'air') {
		// Rows of vent grilles around a fan housing.
		const alongX = r.w >= r.h;
		const n = alongX ? r.h : r.w;
		for (let i = 0; i < n - 1; i++) {
			const o = i + 0.75;
			if (alongX) glow.top(x0 + 0.6, z0 + o, x0 + r.w - 0.6, z0 + o + 0.3, y + 0.03, dim);
			else glow.top(x0 + o, z0 + 0.6, x0 + o + 0.3, z0 + r.h - 0.6, y + 0.03, dim);
		}
		solid.box(
			cx - 0.6,
			cz - 0.6,
			cx + 0.6,
			cz + 0.6,
			y,
			y + 1.2,
			accent.clone().multiplyScalar(0.7)
		);
	} else if (kind === 'water') {
		// A tank open at the top.
		glow.top(x0 + 0.4, z0 + 0.4, x0 + r.w - 0.4, z0 + r.h - 0.4, y + 0.03, dim);
		glow.top(x0 + 0.8, z0 + 0.8, x0 + r.w - 0.8, z0 + r.h - 0.8, y + 0.05, accent);
	} else if (kind === 'clinic') {
		const pale = new THREE.Color('#f5f7ff');
		glow.top(cx - 0.3, cz - 1.1, cx + 0.3, cz + 1.1, y + 0.03, pale);
		glow.top(cx - 1.1, cz - 0.3, cx + 1.1, cz + 0.3, y + 0.03, pale);
		glow.top(cx - 0.2, cz - 1, cx + 0.2, cz + 1, y + 0.05, accent);
		glow.top(cx - 1, cz - 0.2, cx + 1, cz + 0.2, y + 0.05, accent);
	} else if (kind === 'market') {
		// Stall awnings.
		for (let ty = 0; ty + 1 < r.h; ty += 2)
			for (let tx = 0; tx + 1 < r.w; tx += 2) {
				const sx = x0 + tx + 0.55;
				const sz = z0 + ty + 0.55;
				solid.box(sx, sz, sx + 0.9, sz + 0.9, y, y + 0.5, dim, accent);
			}
	} else {
		// Directorate: a dais with a beacon.
		solid.box(cx - 1.2, cz - 1.2, cx + 1.2, cz + 1.2, y, y + 0.4, dim, dim);
		glow.box(cx - 0.35, cz - 0.35, cx + 0.35, cz + 0.35, y + 0.4, y + 2.2, accent);
	}
}

/**
 * Everything is drawn as solid volumes of air, built from 1×1 blocks: tunnels as a
 * continuous network of pipes, rooms (housing, farms, plants, shafts, facilities) as blocks.
 * Rock is not drawn.
 *
 * Tunnels go into their own mesh, which marks the stencil buffer wherever a tunnel is
 * on screen. Places are drawn twice against that mark: opaque where there is no tunnel
 * behind them, and see-through where they stand in front of one, so a place never hides
 * the network.
 */
function buildFloor(floor: Floor): FloorMesh {
	const { map } = floor;
	const { grid, roomAt, rooms } = map;
	const c = paletteFor(floor.index);
	const tunnels = new Builder();
	const places = new Builder();
	const glow = new Builder();

	const roomOf = (x: number, y: number) => rooms[roomAt[y]?.[x] ?? -1];
	const isRoad = (x: number, y: number) => grid[y]?.[x] === 'road';
	/** Tunnels and drawn places are air; everything else counts as solid rock. */
	const isAir = (x: number, y: number) => {
		const t = grid[y]?.[x] ?? 'void';
		return t === 'road' || (t !== 'void' && t !== 'rock' && isDrawn(floor, roomOf(x, y)));
	};

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
			const col = shade(base, seed + d.charCodeAt(0) * 13 + k);
			const lo = col.clone().multiplyScalar(floorShade + (1 - floorShade) * (k / h));
			const hi = col.clone().multiplyScalar(floorShade + (1 - floorShade) * (top / h));
			b.side(d, x0, z0, x0 + 1, z0 + 1, k, top, hi, false, lo);
		}
	};

	// ── Tunnels ─────────────────────────────────────────────────────────────
	for (let y = 0; y < map.height; y++) {
		for (let x = 0; x < map.width; x++) {
			if (!isRoad(x, y)) continue;
			const x0 = wx(x);
			const z0 = wz(y);
			const seed = (y * W + x) * 7 + floor.index * 1_000_003;
			// Faces against other air are skipped: the network reads as one solid, and
			// nothing ends up coplanar with a place's wall.
			for (const [d, dx, dy] of SIDES)
				if (!isAir(x + dx, y + dy))
					wallColumn(tunnels, d, x0, z0, TUNNEL_H, c.tunnelWall, seed, 0.8);
			tunnels.top(x0, z0, x0 + 1, z0 + 1, TUNNEL_H, shade(c.road, seed, 0.06));
			tunnels.top(x0, z0, x0 + 1, z0 + 1, 0, c.tunnelWall.clone().multiplyScalar(0.6), true);
		}
	}

	// ── Places ──────────────────────────────────────────────────────────────
	for (const r of rooms) {
		if (!isDrawn(floor, r)) continue;
		const h = roomHeight(floor, r);
		const facility = floor.facilities.get(r.id);
		const shaft = r.kind === 'gate' ? floor.shaftGates.indexOf(r) : -1;
		let wall: THREE.Color;
		let roof: THREE.Color;
		if (facility) {
			const accent = new THREE.Color(FACILITY_INFO[facility.kind].color);
			wall = c.placeWall.clone().lerp(accent, 0.3);
			roof = c.placeRoof.clone().lerp(accent, 0.4);
		} else if (r.kind === 'farm') {
			wall = c.farmWall;
			roof = c.farmRoof;
		} else if (r.kind === 'plant') {
			wall = c.plantWall;
			roof = c.plantRoof;
		} else if (r.kind === 'room') {
			// Habitation: muted; blocks in blackout go darker.
			const lit = floor.lit[r.id];
			wall = lit ? c.placeWall : c.blockWallDark;
			roof = lit ? c.placeRoof : c.blockRoofDark;
		} else {
			const status = shaft >= 0 ? SHAFT_COLORS[SHAFTS[shaft].status] : '#5eead4';
			wall = c.shaftWall.clone().lerp(new THREE.Color(status), 0.35);
			roof = wall.clone().multiplyScalar(1.15);
		}

		for (let y = r.y; y < r.y + r.h; y++)
			for (let x = r.x; x < r.x + r.w; x++) {
				const x0 = wx(x);
				const z0 = wz(y);
				const seed = (y * W + x) * 7 + floor.index * 1_000_003;
				for (const [d, dx, dy] of SIDES)
					if (roomAt[y + dy]?.[x + dx] !== r.id) wallColumn(places, d, x0, z0, h, wall, seed, 0.7);
				places.top(x0, z0, x0 + 1, z0 + 1, h, shade(roof, seed, 0.08));
			}

		const x0 = wx(r.x);
		const z0 = wz(r.y);
		if (facility) facilityProps(facility.kind, r, x0, z0, h, places, glow);
		else if (r.kind === 'farm') {
			// Crops under grow-lamps, on the roof so they read from above.
			for (let ty = 1; ty < r.h - 1; ty += 2)
				for (let tx = 1; tx < r.w - 1; tx += 2) {
					const s = 0.3 + hash01(r.id * 977 + ty * 31 + tx) * 0.12;
					const cx = x0 + tx + 0.5;
					const cz = z0 + ty + 0.5;
					places.box(
						cx - s,
						cz - s,
						cx + s,
						cz + s,
						h,
						h + 0.3 + s,
						shade(c.crop, r.id + tx * 17 + ty)
					);
				}
		} else if (r.kind === 'gate') {
			// The well opening at the top of the shaft.
			glow.top(x0 + 0.7, z0 + 0.7, x0 + r.w - 0.7, z0 + r.h - 0.7, h + 0.03, c.shaftRoof);
		} else if (r.kind === 'plant') {
			const cx = x0 + r.w / 2;
			const cz = z0 + r.h / 2;
			glow.box(cx - 1, cz - 1, cx + 1, cz + 1, h, h + 0.6, c.plantCore);
			for (const [sx, sz] of [
				[-1, -1],
				[1, -1],
				[-1, 1],
				[1, 1]
			])
				places.box(
					cx + sx * 2.2 - 0.4,
					cz + sz * 2.2 - 0.4,
					cx + sx * 2.2 + 0.4,
					cz + sz * 2.2 + 0.4,
					h,
					h + 1.5,
					c.plantWall
				);
		}

		// Door: a pale opening on the wall face toward its one tunnel.
		const dx = r.access.x - r.door.x;
		const dz = r.access.y - r.door.y;
		const mx = wx(r.door.x) + 0.5 + dx * 0.52;
		const mz = wz(r.door.y) + 0.5 + dz * 0.52;
		const side: Dir = dx > 0 ? 'e' : dx < 0 ? 'w' : dz > 0 ? 's' : 'n';
		const hw = 0.32;
		if (dx !== 0) glow.side(side, mx - 0.5, mz - hw, mx + 0.5, mz + hw, 0, 1.4, c.door);
		else glow.side(side, mx - hw, mz - 0.5, mx + hw, mz + 0.5, 0, 1.4, c.door);
	}

	// ── Materials ───────────────────────────────────────────────────────────
	const tunnelMat = new THREE.MeshLambertMaterial({
		vertexColors: true,
		stencilWrite: true,
		stencilRef: 1,
		stencilFunc: THREE.AlwaysStencilFunc,
		stencilZPass: THREE.ReplaceStencilOp
	});
	/** Opaque wherever no tunnel is behind; see-through wherever one is. */
	const pair = (make: (p: THREE.MeshBasicMaterialParameters) => THREE.Material) => {
		const opaque = make({
			vertexColors: true,
			stencilWrite: true,
			stencilRef: 1,
			stencilFunc: THREE.NotEqualStencilFunc
		});
		const ghost = make({
			vertexColors: true,
			transparent: true,
			opacity: GHOST_OPACITY,
			depthWrite: false,
			stencilWrite: true,
			stencilRef: 1,
			stencilFunc: THREE.EqualStencilFunc
		});
		ghost.userData.baseOpacity = GHOST_OPACITY;
		return [opaque, ghost] as const;
	};
	const [placeMat, placeGhost] = pair((p) => new THREE.MeshLambertMaterial(p));
	const [glowMat, glowGhost] = pair((p) => new THREE.MeshBasicMaterial(p));

	const group = new THREE.Group();
	const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number) => {
		const m = new THREE.Mesh(geo, mat);
		m.renderOrder = order;
		group.add(m);
	};
	const placeGeo = places.build();
	const glowGeo = glow.build();
	mesh(tunnels.build(), tunnelMat, 1);
	mesh(placeGeo, placeMat, 2);
	mesh(glowGeo, glowMat, 2);
	mesh(placeGeo, placeGhost, 3);
	mesh(glowGeo, glowGhost, 3);
	return {
		group,
		materials: [tunnelMat, placeMat, placeGhost, glowMat, glowGhost],
		opacity: 0,
		y: 0,
		targetY: 0,
		targetOpacity: 1
	};
}

// ── Route ribbon ────────────────────────────────────────────────────────────
function corners(path: Point[]) {
	if (path.length < 3) return path;
	const out = [path[0]];
	for (let i = 1; i < path.length - 1; i++) {
		const a = path[i - 1];
		const b = path[i];
		const c = path[i + 1];
		if (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y) out.push(b);
	}
	out.push(path[path.length - 1]);
	return out;
}

function ribbon(paths: Point[][], width: number, y: number, color: THREE.Color) {
	const b = new Builder();
	const h = width / 2;
	for (const path of paths) {
		const pts = corners(path);
		if (pts.length === 1) {
			const p = pts[0];
			b.top(wx(p.x) + 0.5 - h, wz(p.y) + 0.5 - h, wx(p.x) + 0.5 + h, wz(p.y) + 0.5 + h, y, color);
		}
		for (let i = 1; i < pts.length; i++) {
			const a = pts[i - 1];
			const c = pts[i];
			const x0 = wx(Math.min(a.x, c.x)) + 0.5 - h;
			const x1 = wx(Math.max(a.x, c.x)) + 0.5 + h;
			const z0 = wz(Math.min(a.y, c.y)) + 0.5 - h;
			const z1 = wz(Math.max(a.y, c.y)) + 0.5 + h;
			b.top(x0, z0, x1, z1, y, color);
		}
	}
	return b;
}

function disposeTree(root: THREE.Object3D) {
	root.traverse((o) => {
		const m = o as THREE.Mesh;
		m.geometry?.dispose();
		const mat = m.material;
		if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
		else mat?.dispose();
	});
}

export function createHollowScene(container: HTMLElement, opts: SceneOptions): HollowScene {
	const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setClearColor('#121726');
	container.appendChild(renderer.domElement);
	renderer.domElement.style.display = 'block';
	renderer.domElement.style.touchAction = 'none';

	const scene = new THREE.Scene();
	scene.fog = new THREE.Fog('#121726', 260, 720);
	scene.add(new THREE.HemisphereLight('#dfe6ff', '#28304a', 2.2));
	const sun = new THREE.DirectionalLight('#ffffff', 1.6);
	sun.position.set(-0.45, 1, 0.3);
	scene.add(sun);

	const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 3000);
	const controls = new MapControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.12;
	controls.zoomToCursor = true;
	controls.minDistance = 10;
	controls.maxDistance = 520;
	controls.maxPolarAngle = Math.PI * 0.42;
	camera.position.set(0, 160, 150);
	controls.target.set(0, 0, 0);

	// ── Floors ──────────────────────────────────────────────────────────────
	const meshes = new Map<number, FloorMesh>();
	let current: Floor | null = null;
	const applyFade = (fm: FloorMesh) => {
		const fading = fm.opacity < 0.999;
		for (const m of fm.materials) {
			const base = (m.userData.baseOpacity as number | undefined) ?? 1;
			m.transparent = fading || base < 1;
			m.depthWrite = !m.transparent;
			m.opacity = base * fm.opacity;
		}
		fm.group.visible = fm.opacity > 0.001;
		fm.group.position.y = fm.y;
	};

	// ── Route ───────────────────────────────────────────────────────────────
	const routeGroup = new THREE.Group();
	scene.add(routeGroup);
	const routeMesh = (b: Builder, opacity: number, onTop: boolean, order: number) => {
		const mat = new THREE.MeshBasicMaterial({
			vertexColors: true,
			transparent: opacity < 1 || onTop,
			opacity,
			depthTest: !onTop,
			depthWrite: false
		});
		const m = new THREE.Mesh(b.build(), mat);
		m.renderOrder = order;
		return m;
	};

	// ── Highlights ──────────────────────────────────────────────────────────
	const unitBox = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
	const makeOutline = (color: string, opacity: number) => {
		const o = new THREE.LineSegments(
			unitBox,
			new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false })
		);
		o.renderOrder = 20;
		o.visible = false;
		scene.add(o);
		return o;
	};
	const hoverBox = makeOutline('#e2e8f0', 0.55);
	const selectBox = makeOutline('#ffffff', 1);
	const placeOutline = (o: THREE.LineSegments, r: Room | null) => {
		if (!r || !current || !isDrawn(current, r)) return void (o.visible = false);
		const h = roomHeight(current, r) + 0.1;
		o.scale.set(r.w + 0.15, h, r.h + 0.15);
		o.position.set(wx(r.x) + r.w / 2, h / 2, wz(r.y) + r.h / 2);
		o.visible = true;
	};

	// ── Picking ─────────────────────────────────────────────────────────────
	const raycaster = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
	const hit = new THREE.Vector3();
	const box = new THREE.Box3();
	function pick(e: PointerEvent): Pick | null {
		if (!current) return null;
		const rect = renderer.domElement.getBoundingClientRect();
		ndc.set(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-((e.clientY - rect.top) / rect.height) * 2 + 1
		);
		raycaster.setFromCamera(ndc, camera);
		const { map } = current;
		const origin = raycaster.ray.origin;
		// Buildings stand above the floor, so test their boxes before the ground behind them.
		let room: Room | null = null;
		let nearest = Infinity;
		for (const r of map.rooms) {
			if (!isDrawn(current, r)) continue;
			box.min.set(wx(r.x), 0, wz(r.y));
			box.max.set(wx(r.x) + r.w, roomHeight(current, r), wz(r.y) + r.h);
			if (!raycaster.ray.intersectBox(box, hit)) continue;
			const d = hit.distanceToSquared(origin);
			if (d < nearest) {
				nearest = d;
				room = r;
			}
		}
		if (!raycaster.ray.intersectPlane(ground, hit))
			return room ? { tile: { ...room.door }, room } : null;
		const x = Math.floor(hit.x + W / 2);
		const y = Math.floor(hit.z + H / 2);
		if (room && nearest < hit.distanceToSquared(origin)) return { tile: { x, y }, room };
		if ((map.grid[y]?.[x] ?? 'void') === 'void') return room ? { tile: { x, y }, room } : null;
		const under = map.rooms[map.roomAt[y][x]];
		return { tile: { x, y }, room: isDrawn(current, under) ? under : null };
	}

	let down: { x: number; y: number } | null = null;
	const el = renderer.domElement;
	const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
	const onMove = (e: PointerEvent) => {
		if (e.buttons === 0) opts.onHover(pick(e));
	};
	const onUp = (e: PointerEvent) => {
		if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) opts.onClick(pick(e));
		down = null;
	};
	const onLeave = () => opts.onHover(null);
	el.addEventListener('pointerdown', onDown);
	el.addEventListener('pointermove', onMove);
	el.addEventListener('pointerup', onUp);
	el.addEventListener('pointerleave', onLeave);

	// ── Camera motion ───────────────────────────────────────────────────────
	let fly: { x: number; z: number; dist: number; dir?: THREE.Vector3 } | null = null;
	const cancelFly = () => (fly = null);
	controls.addEventListener('start', cancelFly);
	const pan = { x: 0, y: 0 };

	const resize = () => {
		const w = container.clientWidth || 1;
		const h = container.clientHeight || 1;
		renderer.setSize(w, h);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	const observer = new ResizeObserver(resize);
	observer.observe(container);
	resize();

	// ── Pins ────────────────────────────────────────────────────────────────
	let pins: Pin[] = [];
	const v = new THREE.Vector3();
	const placePin = (p: Pin) => {
		v.set(wx(p.x), p.h ?? 1, wz(p.y)).project(camera);
		const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
		p.el.style.visibility = visible ? 'visible' : 'hidden';
		if (!visible) return;
		const sx = (v.x * 0.5 + 0.5) * container.clientWidth;
		const sy = (-v.y * 0.5 + 0.5) * container.clientHeight;
		p.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
		p.el.style.zIndex = String(Math.round((1 - v.z) * 1e5));
	};

	// ── Frame loop ──────────────────────────────────────────────────────────
	const offset = new THREE.Vector3();
	const right = new THREE.Vector3();
	const forward = new THREE.Vector3();
	let raf = 0;
	let last = performance.now();
	let lastInfo = '';
	const frame = (t: number) => {
		raf = requestAnimationFrame(frame);
		const dt = Math.min(50, t - last);
		last = t;
		const k = 1 - Math.exp(-dt / 140);

		offset.copy(camera.position).sub(controls.target);
		if (pan.x || pan.y) {
			fly = null;
			right.setFromMatrixColumn(camera.matrix, 0).setY(0).normalize();
			forward.set(-right.z, 0, right.x);
			const speed = offset.length() * 0.0012 * dt;
			controls.target.addScaledVector(right, pan.x * speed).addScaledVector(forward, pan.y * speed);
			camera.position.copy(controls.target).add(offset);
		}
		if (fly) {
			controls.target.x += (fly.x - controls.target.x) * k;
			controls.target.z += (fly.z - controls.target.z) * k;
			const dist = offset.length();
			const next = dist * Math.pow(fly.dist / dist, k);
			offset.normalize();
			if (fly.dir) offset.lerp(fly.dir, k).normalize();
			camera.position.copy(controls.target).addScaledVector(offset, next);
			if (
				Math.abs(fly.x - controls.target.x) < 0.03 &&
				Math.abs(fly.z - controls.target.z) < 0.03 &&
				Math.abs(fly.dist / next - 1) < 0.002 &&
				(!fly.dir || offset.angleTo(fly.dir) < 0.005)
			)
				fly = null;
		}
		controls.target.x = THREE.MathUtils.clamp(controls.target.x, -W / 2, W / 2);
		controls.target.z = THREE.MathUtils.clamp(controls.target.z, -H / 2, H / 2);
		controls.target.y = 0;
		controls.update();

		// Elevator transition between floors.
		const kf = 1 - Math.exp(-dt / 170);
		for (const fm of meshes.values()) {
			if (fm.opacity === fm.targetOpacity && fm.y === fm.targetY) continue;
			fm.opacity += (fm.targetOpacity - fm.opacity) * kf;
			fm.y += (fm.targetY - fm.y) * kf;
			if (Math.abs(fm.targetOpacity - fm.opacity) < 0.004) fm.opacity = fm.targetOpacity;
			if (Math.abs(fm.targetY - fm.y) < 0.01) fm.y = fm.targetY;
			applyFade(fm);
		}

		for (const p of pins) placePin(p);
		renderer.render(scene, camera);

		offset.copy(camera.position).sub(controls.target);
		const distance = Math.round(offset.length());
		const heading = Math.round(THREE.MathUtils.radToDeg(Math.atan2(-offset.x, offset.z)));
		const info = `${distance}:${heading}`;
		if (info !== lastInfo) {
			lastInfo = info;
			opts.onView?.({ distance, heading });
		}
	};
	raf = requestAnimationFrame(frame);

	/** Camera direction sitting behind `heading` (heading-up), tilted `tilt` rad above the floor. */
	const tiltDir = (heading: Point | undefined, tilt: number) => {
		const h = heading ?? { x: 0, y: -1 };
		const len = Math.hypot(h.x, h.y) || 1;
		const cosT = Math.cos(tilt);
		return new THREE.Vector3((-h.x / len) * cosT, Math.sin(tilt), (-h.y / len) * cosT);
	};

	return {
		showFloor(floor, dir) {
			let fm = meshes.get(floor.index);
			if (!fm) {
				fm = buildFloor(floor);
				meshes.set(floor.index, fm);
				scene.add(fm.group);
			}
			if (current?.index !== floor.index) {
				// New floor rises (or sinks) into place; the one you leave slides the other way.
				fm.y = -dir * TRAVEL;
				for (const [i, other] of meshes) {
					if (i === floor.index || other.targetOpacity === 0) continue;
					other.targetOpacity = 0;
					other.targetY = dir * TRAVEL;
				}
			}
			fm.targetY = 0;
			fm.targetOpacity = 1;
			if (dir === 0) {
				fm.y = 0;
				fm.opacity = 1;
			}
			applyFade(fm);
			current = floor;
		},
		setHover: (r) => placeOutline(hoverBox, r),
		setSelection: (r) => placeOutline(selectBox, r),
		setRoute(paths, active) {
			for (const c of [...routeGroup.children]) {
				routeGroup.remove(c);
				disposeTree(c);
			}
			if (!paths.length) return;
			const casing = new THREE.Color('#1667c9');
			const core = new THREE.Color('#38d8f2');
			// The solid pass sits on the tunnel floor; the see-through pass keeps it readable past the
			// tunnel walls, which hide most of the floor at map angles.
			routeGroup.add(routeMesh(ribbon(paths, 0.5, ROUTE_Y + 0.05, core), 0.8, true, 9));
			routeGroup.add(routeMesh(ribbon(paths, 0.86, ROUTE_Y + 0.07, casing), 1, false, 6));
			routeGroup.add(routeMesh(ribbon(paths, 0.56, ROUTE_Y + 0.09, core), 1, false, 7));
			if (active?.length)
				routeGroup.add(
					routeMesh(ribbon([active], 0.26, ROUTE_Y + 0.11, new THREE.Color('#ecfeff')), 1, false, 8)
				);
		},
		setPins(next) {
			pins = next;
			for (const p of pins) placePin(p);
		},
		flyTo(x, y, o = {}) {
			fly = {
				x: wx(x),
				z: wz(y),
				dist: o.distance ?? camera.position.distanceTo(controls.target),
				dir: o.heading || o.tilt !== undefined ? tiltDir(o.heading, o.tilt ?? 0.75) : undefined
			};
		},
		fitBounds(minX, minY, maxX, maxY) {
			const fov = THREE.MathUtils.degToRad(camera.fov);
			// Generous margin: side panels cover the edges of the viewport.
			const w = (maxX - minX) * 1.35 + 24;
			const h = (maxY - minY) * 1.2 + 20;
			// Width must fit the horizontal field of view; depth is foreshortened by the tilt.
			const span = Math.max(w / camera.aspect, h, 24);
			const dist = THREE.MathUtils.clamp(span / (2 * Math.tan(fov / 2)), 25, 480);
			fly = {
				x: wx((minX + maxX) / 2),
				z: wz((minY + maxY) / 2),
				dist,
				dir: tiltDir(undefined, 1.05)
			};
		},
		zoomBy(factor) {
			const dist = fly?.dist ?? camera.position.distanceTo(controls.target);
			fly = {
				x: fly?.x ?? controls.target.x,
				z: fly?.z ?? controls.target.z,
				dist: THREE.MathUtils.clamp(dist / factor, controls.minDistance, controls.maxDistance),
				dir: fly?.dir
			};
		},
		resetNorth() {
			offset.copy(camera.position).sub(controls.target);
			const tilt = Math.asin(THREE.MathUtils.clamp(offset.y / offset.length(), -1, 1));
			fly = {
				x: controls.target.x,
				z: controls.target.z,
				dist: offset.length(),
				dir: tiltDir(undefined, tilt)
			};
		},
		setPan(x, y) {
			pan.x = x;
			pan.y = y;
		},
		dispose() {
			cancelAnimationFrame(raf);
			observer.disconnect();
			controls.removeEventListener('start', cancelFly);
			controls.dispose();
			el.removeEventListener('pointerdown', onDown);
			el.removeEventListener('pointermove', onMove);
			el.removeEventListener('pointerup', onUp);
			el.removeEventListener('pointerleave', onLeave);
			disposeTree(scene);
			renderer.dispose();
			el.remove();
		}
	};
}
