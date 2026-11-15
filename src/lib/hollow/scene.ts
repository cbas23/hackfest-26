import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { Point, Room } from '#lib/tunnels/generate.js';
import { FLOOR_CONFIG, LEVELS } from './data.js';
import type { Floor } from './world.js';

const W = FLOOR_CONFIG.width;
const H = FLOOR_CONFIG.height;
/** Height of the rock the tunnels are cut into. Low enough to keep the route in view. */
const ROCK_H = 0.8;
const SLAB = 2.5;
const TRAVEL = 10;

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
		rockTop: mix('#232a3d', '#2e2524', warm),
		rockOuter: mix('#171c2a', '#1d1715', warm),
		tunnelWall: mix('#6c789e', '#80706c', warm),
		road: mix('#a3b0d6', '#b3a7a2', warm),
		blockWall: mix('#5a608c', '#64587a', warm),
		blockRoof: mix('#6e75a3', '#776b8e', warm),
		blockWallDark: mix('#3c4062', '#41394f', warm),
		blockRoofDark: mix('#474b70', '#4b4259', warm),
		door: new THREE.Color('#dfe6fb'),
		farm: new THREE.Color('#1f6b67'),
		farmTree: new THREE.Color('#2f9488'),
		plant: mix('#4b5070', '#4f4552', warm),
		plantVent: new THREE.Color('#e3965c'),
		landing: new THREE.Color('#2c3655')
	};
}

// ── Geometry accumulator ────────────────────────────────────────────────────
type V3 = [number, number, number];
type Dir = 'n' | 's' | 'w' | 'e';

class Builder {
	private pos: number[] = [];
	private nor: number[] = [];
	private col: number[] = [];

	private quad(a: V3, b: V3, c: V3, d: V3, n: V3, color: THREE.Color) {
		for (const p of [a, b, c, a, c, d]) {
			this.pos.push(p[0], p[1], p[2]);
			this.nor.push(n[0], n[1], n[2]);
			this.col.push(color.r, color.g, color.b);
		}
	}

	top(x0: number, z0: number, x1: number, z1: number, y: number, c: THREE.Color) {
		this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], c);
	}

	/** A vertical face on side `dir` of the cell [x0,x1]×[z0,z1], facing outward. */
	side(
		dir: Dir,
		x0: number,
		z0: number,
		x1: number,
		z1: number,
		y0: number,
		y1: number,
		c: THREE.Color
	) {
		if (dir === 'n')
			this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], c);
		else if (dir === 's')
			this.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1], c);
		else if (dir === 'w')
			this.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0], c);
		else this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], c);
	}

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

/** How far a room's roof stands above the tunnel floor. */
export function roomHeight(floor: Floor, r: Room) {
	if (r.kind === 'gate') return 0.25;
	if (r.kind === 'farm') return 0.35;
	if (r.kind === 'plant') return 1.8;
	return 1 + Math.min(r.w, r.h) * 0.16 + hash01(r.id + floor.index * 7919) * 0.8;
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

function buildFloor(floor: Floor): FloorMesh {
	const { map } = floor;
	const { grid } = map;
	const c = paletteFor(floor.index);
	const solid = new Builder();
	const at = (x: number, y: number) => grid[y]?.[x] ?? 'void';

	for (let y = 0; y < map.height; y++) {
		// Tops as row runs: rock mass at ROCK_H, tunnel floor at 0.
		let start = 0;
		let kind: 'void' | 'road' | 'rock' | 'room' = 'void';
		for (let x = 0; x <= map.width; x++) {
			const t = x < map.width ? grid[y][x] : 'void';
			const k = t === 'void' ? 'void' : t === 'road' ? 'road' : t === 'rock' ? 'rock' : 'room';
			if (k !== kind) {
				if (kind === 'road') solid.top(wx(start), wz(y), wx(x), wz(y + 1), 0, c.road);
				else if (kind === 'rock') solid.top(wx(start), wz(y), wx(x), wz(y + 1), ROCK_H, c.rockTop);
				kind = k;
				start = x;
			}
		}
		// Walls.
		for (let x = 0; x < map.width; x++) {
			const t = grid[y][x];
			if (t === 'void') continue;
			const x0 = wx(x);
			const z0 = wz(y);
			for (const [d, dx, dy] of SIDES) {
				const n = at(x + dx, y + dy);
				if (t === 'rock') {
					// Rock faces onto a tunnel or chamber: a pale tunnel wall.
					if (n === 'void') solid.side(d, x0, z0, x0 + 1, z0 + 1, -SLAB, ROCK_H, c.rockOuter);
					else if (n !== 'rock') solid.side(d, x0, z0, x0 + 1, z0 + 1, 0, ROCK_H, c.tunnelWall);
				} else if (n === 'void') {
					// Edge of the dig: the slab below, and a wall for tunnels running through open earth.
					solid.side(d, x0, z0, x0 + 1, z0 + 1, -SLAB, 0, c.rockOuter);
					if (t === 'road') solid.side(d, x0, z0, x0 + 1, z0 + 1, 0, ROCK_H, c.rockOuter);
				}
			}
		}
	}

	const inset = 0.1;
	for (const r of map.rooms) {
		const x0 = wx(r.x);
		const z0 = wz(r.y);
		const x1 = x0 + r.w;
		const z1 = z0 + r.h;
		const h = roomHeight(floor, r);
		if (r.kind === 'room') {
			const lit = floor.lit[r.id];
			solid.top(x0, z0, x1, z1, 0, lit ? c.blockWall : c.blockWallDark);
			solid.box(
				x0 + inset,
				z0 + inset,
				x1 - inset,
				z1 - inset,
				0,
				h,
				lit ? c.blockWall : c.blockWallDark,
				lit ? c.blockRoof : c.blockRoofDark
			);
		} else if (r.kind === 'farm') {
			solid.box(x0, z0, x1, z1, 0, h, c.farm);
			// Rows of lamp-grown crops, read like park trees.
			for (let ty = 1; ty < r.h - 1; ty += 2)
				for (let tx = 1; tx < r.w - 1; tx += 2) {
					const s = 0.3 + hash01(r.id * 977 + ty * 31 + tx) * 0.15;
					const cx = x0 + tx + 0.5;
					const cz = z0 + ty + 0.5;
					solid.box(cx - s, cz - s, cx + s, cz + s, h, h + 0.5, c.farmTree);
				}
		} else if (r.kind === 'plant') {
			solid.box(x0, z0, x1, z1, 0, h, c.plant);
			const cx = (x0 + x1) / 2;
			const cz = (z0 + z1) / 2;
			for (const s of [-1, 1]) {
				const vx = cx + s * 1.6;
				const vz = cz + s * 1.6;
				solid.box(vx - 0.6, vz - 0.6, vx + 0.6, vz + 0.6, h, h + 1.6, c.plant, c.plantVent);
			}
		} else {
			// Shaft landing: a low pad; its marker is an HTML pin.
			solid.box(x0, z0, x1, z1, 0, h, c.landing);
		}
		// Door: a pale sill on the one street it opens onto.
		const dx = r.access.x - r.door.x;
		const dz = r.access.y - r.door.y;
		const mx = wx(r.door.x) + 0.5 + dx * 0.5;
		const mz = wz(r.door.y) + 0.5 + dz * 0.5;
		const lx = dx !== 0 ? 0.08 : 0.3;
		const lz = dz !== 0 ? 0.08 : 0.3;
		solid.box(mx - lx, mz - lz, mx + lx, mz + lz, 0, 0.06, c.door);
	}

	const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
	const group = new THREE.Group();
	group.add(new THREE.Mesh(solid.build(), mat));
	return { group, materials: [mat], opacity: 0, y: 0, targetY: 0, targetOpacity: 1 };
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
	const renderer = new THREE.WebGLRenderer({ antialias: true });
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
			m.transparent = fading;
			m.depthWrite = !fading;
			m.opacity = fm.opacity;
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
		if (!r || !current) return void (o.visible = false);
		const h = roomHeight(current, r) + (r.kind === 'plant' ? 1.6 : 0) + 0.15;
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
		return { tile: { x, y }, room: map.rooms[map.roomAt[y][x]] ?? null };
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
			// Ghost pass shows the route through walls; the solid pass sits on the tunnel floor.
			routeGroup.add(routeMesh(ribbon(paths, 0.6, 0.05, core), 0.28, true, 5));
			routeGroup.add(routeMesh(ribbon(paths, 0.86, 0.07, casing), 1, false, 6));
			routeGroup.add(routeMesh(ribbon(paths, 0.56, 0.09, core), 1, false, 7));
			if (active?.length)
				routeGroup.add(
					routeMesh(ribbon([active], 0.26, 0.11, new THREE.Color('#ecfeff')), 1, false, 8)
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
			const span = Math.max(w / camera.aspect, h * 0.72, 24);
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
