import { mulberry32 } from '#lib/random.js';

export type TileType = 'void' | 'rock' | 'road' | 'room' | 'gate' | FeatureKind;
export type FeatureKind = 'farm' | 'plant';

export interface Point {
	x: number;
	y: number;
}

export type Side = 'n' | 'e' | 's' | 'w';

export interface Room {
	id: number;
	kind: 'room' | 'gate' | FeatureKind;
	x: number;
	y: number;
	w: number;
	h: number;
	/** Room tile that holds the door. */
	door: Point;
	/** The single road tile the door opens onto — the only way in. */
	access: Point;
	/** Gates only: tile just outside the city this edge gate leads to. Interior gates are shafts and have none. */
	exit?: Point;
	/** Gates only: index into `GenerateOptions.gates` when the gate came from a predetermined spec. */
	specIndex?: number;
}

/** A predetermined gate. (x, y) is the gate's top-left tile. */
export interface GateSpec {
	x: number;
	y: number;
	/** Which face the door is on. Defaults to the face pointing toward the city centre. */
	door?: Side;
}

export interface TunnelMap {
	width: number;
	height: number;
	seed: number;
	grid: TileType[][]; // grid[y][x]
	roomAt: number[][]; // room id per tile, -1 if none
	rooms: Room[];
	roadCount: number;
}

export interface GenerateOptions {
	width?: number;
	height?: number;
	seed?: number;
	/** Number of random 4x5 gates, or an explicit list of gate positions. */
	gates?: number | GateSpec[];
	/** 0..1 — chance a random gate is placed inside the city (a shaft) rather than on the edge. */
	interiorGateChance?: number;
	/** 0..1 — share of the grid the city itself spans. Below 1 leaves open earth around it for features. */
	cityScale?: number;
	/** Large facilities (farms, plants) dug into the city's border, each reached by one tunnel. */
	features?: FeatureSpec[];
	/** 0..1 — how much of the city is cut by side streets. */
	streetDensity?: number;
	/** 0..1 — how densely rooms pack the space between streets. */
	roomDensity?: number;
}

export interface FeatureSpec {
	kind: FeatureKind;
	count: number;
	/** Inclusive side-length range, e.g. [10, 20]. */
	size: [number, number];
}

const DIRS: readonly Point[] = [
	{ x: 0, y: -1 },
	{ x: 1, y: 0 },
	{ x: 0, y: 1 },
	{ x: -1, y: 0 }
];
const SIDE_DIR: Record<Side, Point> = { n: DIRS[0], e: DIRS[1], s: DIRS[2], w: DIRS[3] };

const GATE_WIDTH = 4;
const GATE_DEPTH = 5;

/**
 * Allowed room footprints: 1..5 on each side, but a side of 4 or 5 needs the
 * other side to be at least 2 (no 1x4 / 1x5 corridors-as-rooms).
 */
const ROOM_SIZES: { w: number; h: number; weight: number }[] = [];
for (let w = 1; w <= 5; w++)
	for (let h = 1; h <= 5; h++) {
		if (Math.max(w, h) >= 4 && Math.min(w, h) < 2) continue;
		// One-tile-wide rooms are allowed but rare.
		ROOM_SIZES.push({ w, h, weight: Math.min(w, h) === 1 ? 0.05 : 1 });
	}
const ROOM_WEIGHT_TOTAL = ROOM_SIZES.reduce((s, r) => s + r.weight, 0);

/** Minimal binary min-heap keyed by priority. */
class Heap {
	private items: { k: number; p: number }[] = [];
	get size() {
		return this.items.length;
	}
	push(k: number, p: number) {
		const a = this.items;
		a.push({ k, p });
		let i = a.length - 1;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (a[parent].p <= a[i].p) break;
			[a[parent], a[i]] = [a[i], a[parent]];
			i = parent;
		}
	}
	pop() {
		const a = this.items;
		const top = a[0];
		const last = a.pop()!;
		if (a.length) {
			a[0] = last;
			let i = 0;
			for (;;) {
				const l = i * 2 + 1;
				const r = l + 1;
				let m = i;
				if (l < a.length && a[l].p < a[m].p) m = l;
				if (r < a.length && a[r].p < a[m].p) m = r;
				if (m === i) break;
				[a[m], a[i]] = [a[i], a[m]];
				i = m;
			}
		}
		return top;
	}
}

export function generateTunnelMap(opts: GenerateOptions = {}): TunnelMap {
	const width = opts.width ?? 72;
	const height = opts.height ?? 56;
	const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
	const gateOpt = opts.gates ?? 4;
	const interiorGateChance = opts.interiorGateChance ?? 0.35;
	const streetDensity = opts.streetDensity ?? 0.5;
	const roomDensity = opts.roomDensity ?? 0.8;
	const cityScale = opts.cityScale ?? 1;
	const features = opts.features ?? [];
	const rand = mulberry32(seed);
	const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

	const grid: TileType[][] = Array.from({ length: height }, () => Array(width).fill('void'));
	const roomAt: number[][] = Array.from({ length: height }, () => Array(width).fill(-1));
	const rooms: Room[] = [];
	const at = (x: number, y: number): TileType => grid[y]?.[x] ?? 'void';
	const inside = (x: number, y: number) => x > 0 && y > 0 && x < width - 1 && y < height - 1;
	const cx = Math.floor(width / 2);
	const cy = Math.floor(height / 2);

	// ── 1. Organic, roughly circular city boundary ──────────────────────────
	// Radius wobbles with a few random harmonics, then cellular-automata smoothing
	// roughens the edge into something that looks dug rather than drawn.
	const rx = (width / 2 - 3) * cityScale;
	const ry = (height / 2 - 3) * cityScale;
	const harmonics = Array.from({ length: 5 }, (_, i) => ({
		k: i + 2,
		amp: (0.12 / (i + 1)) * (0.5 + rand()),
		phase: rand() * Math.PI * 2
	}));
	const radiusAt = (theta: number) =>
		0.86 + harmonics.reduce((s, h) => s + h.amp * Math.sin(h.k * theta + h.phase), 0);

	let mask: boolean[][] = Array.from({ length: height }, (_, y) =>
		Array.from({ length: width }, (_, x) => {
			const dx = (x - cx) / rx;
			const dy = (y - cy) / ry;
			const limit = radiusAt(Math.atan2(dy, dx));
			return Math.hypot(dx, dy) < limit + (rand() - 0.5) * 0.12;
		})
	);
	for (let pass = 0; pass < 3; pass++) {
		mask = mask.map((row, y) =>
			row.map((_, x) => {
				if (!inside(x, y)) return false;
				let n = 0;
				for (let dy = -1; dy <= 1; dy++)
					for (let dx = -1; dx <= 1; dx++) if (mask[y + dy][x + dx]) n++;
				return n >= 5;
			})
		);
	}
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) if (mask[y][x]) grid[y][x] = 'rock';

	const placeRoom = (r: Omit<Room, 'id'>) => {
		const room: Room = { ...r, id: rooms.length };
		rooms.push(room);
		for (let y = r.y; y < r.y + r.h; y++)
			for (let x = r.x; x < r.x + r.w; x++) {
				grid[y][x] = r.kind;
				roomAt[y][x] = room.id;
			}
		return room;
	};

	// ── 2. Gates: 4x5 rooms, on the edge (exits) or inside the city (shafts) ─
	const gates: Room[] = [];
	const gateSize = (side: Side) =>
		side === 'e' || side === 'w'
			? { w: GATE_DEPTH, h: GATE_WIDTH }
			: { w: GATE_WIDTH, h: GATE_DEPTH };
	const facingCentre = (x: number, y: number): Side => {
		const dx = cx - x;
		const dy = cy - y;
		return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'e' : 'w') : dy >= 0 ? 's' : 'n';
	};
	/** Gate rect at (x, y) with its door on `side`. Returns null if it can't go there. */
	const tryGate = (
		x: number,
		y: number,
		side: Side,
		opts: { force: boolean; specIndex?: number }
	) => {
		const { w, h } = gateSize(side);
		x = Math.max(2, Math.min(width - 2 - w, x));
		y = Math.max(2, Math.min(height - 2 - h, y));
		// Keep at least two tiles between gates.
		for (let yy = y - 2; yy < y + h + 2; yy++)
			for (let xx = x - 2; xx < x + w + 2; xx++) if (at(xx, yy) === 'gate') return null;
		if (!opts.force)
			for (let yy = y; yy < y + h; yy++)
				for (let xx = x; xx < x + w; xx++) if (!mask[yy][xx]) return null;

		const d = SIDE_DIR[side];
		const along = randInt(1, 2);
		const door: Point =
			d.x !== 0
				? { x: d.x > 0 ? x + w - 1 : x, y: y + along }
				: { x: x + along, y: d.y > 0 ? y + h - 1 : y };
		const access = { x: door.x + d.x, y: door.y + d.y };
		// The face opposite the door: if it opens onto the outside, this is an edge gate.
		const back =
			d.x !== 0
				? { x: d.x > 0 ? x - 1 : x + w, y: door.y }
				: { x: door.x, y: d.y > 0 ? y - 1 : y + h };
		const isEdge = !mask[back.y]?.[back.x];
		if (!inside(access.x, access.y)) return null;

		if (grid[access.y][access.x] === 'void') grid[access.y][access.x] = 'rock';
		const gate = placeRoom({
			kind: 'gate',
			x,
			y,
			w,
			h,
			door,
			access,
			exit: isEdge ? back : undefined,
			specIndex: opts.specIndex
		});
		gates.push(gate);
		return gate;
	};

	if (Array.isArray(gateOpt)) {
		gateOpt.forEach((spec, i) =>
			tryGate(spec.x, spec.y, spec.door ?? facingCentre(spec.x + 2, spec.y + 2), {
				force: true,
				specIndex: i
			})
		);
	} else {
		const baseAngle = rand() * Math.PI * 2;
		for (let g = 0; g < gateOpt; g++) {
			const theta = baseAngle + (g / gateOpt) * Math.PI * 2 + (rand() - 0.5) * 0.5;
			const c = Math.cos(theta);
			const s = Math.sin(theta);

			if (rand() < interiorGateChance) {
				// Interior shaft: somewhere between the core and the outskirts, clear of the plaza.
				for (let tries = 0; tries < 40; tries++) {
					const r = 0.2 + rand() * 0.4;
					const t = theta + (rand() - 0.5) * 0.6;
					const side = (['n', 'e', 's', 'w'] as const)[randInt(0, 3)];
					const { w, h } = gateSize(side);
					const x = Math.round(cx + Math.cos(t) * rx * r - w / 2);
					const y = Math.round(cy + Math.sin(t) * ry * r - h / 2);
					const nearPlaza = x - 4 <= cx && cx <= x + w + 3 && y - 4 <= cy && cy <= y + h + 3;
					if (!nearPlaza && tryGate(x, y, side, { force: false })) break;
				}
				continue;
			}

			// Edge gate: walk outward to the last city tile on this bearing.
			let edge: Point | null = null;
			const scale = Math.max(rx, ry);
			for (let t = 0; t < scale * 2; t += 0.5) {
				const x = Math.round(cx + (c * t * rx) / scale);
				const y = Math.round(cy + (s * t * ry) / scale);
				if (!inside(x, y)) break;
				if (mask[y][x]) edge = { x, y };
			}
			if (!edge) continue;
			const horizontal = Math.abs(c) >= Math.abs(s);
			const side: Side = horizontal ? (c > 0 ? 'w' : 'e') : s > 0 ? 'n' : 's';
			const { w, h } = gateSize(side);
			const x = horizontal ? (c > 0 ? edge.x - w + 1 : edge.x) : edge.x - 1;
			const y = horizontal ? edge.y - 1 : s > 0 ? edge.y - h + 1 : edge.y;
			tryGate(x, y, side, { force: true });
		}
	}

	// ── 2b. Border facilities: big rectangles straddling the city edge ──────
	// Each sits half in, half out of the boundary, door facing the city centre.
	const facilities: Room[] = [];
	const blocked = (x: number, y: number, w: number, h: number, gap: number) => {
		for (let yy = y - gap; yy < y + h + gap; yy++)
			for (let xx = x - gap; xx < x + w + gap; xx++) {
				const t = at(xx, yy);
				if (t === 'gate' || t === 'farm' || t === 'plant') return true;
			}
		return false;
	};
	const featureQueue = features.flatMap((f) => Array.from({ length: f.count }, () => f));
	const featureAngle = rand() * Math.PI * 2;
	featureQueue.forEach((f, i) => {
		for (let tries = 0; tries < 40; tries++) {
			const theta =
				featureAngle +
				(i / featureQueue.length) * Math.PI * 2 +
				(rand() - 0.5) * (0.4 + tries * 0.15);
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			const w = randInt(f.size[0], f.size[1]);
			const h = randInt(f.size[0], f.size[1]);
			let edge: Point | null = null;
			const scale = Math.max(rx, ry);
			for (let t = 0; t < scale * 2; t += 0.5) {
				const x = Math.round(cx + (c * t * rx) / scale);
				const y = Math.round(cy + (s * t * ry) / scale);
				if (!inside(x, y)) break;
				if (mask[y][x]) edge = { x, y };
			}
			if (!edge) continue;
			// Push the rect outward so roughly a third of it overlaps the city.
			const horizontal = Math.abs(c) >= Math.abs(s);
			const inset = Math.floor((horizontal ? w : h) / 3);
			let x = horizontal
				? c > 0
					? edge.x - inset
					: edge.x - w + 1 + inset
				: edge.x - Math.floor(w / 2);
			let y = horizontal
				? edge.y - Math.floor(h / 2)
				: s > 0
					? edge.y - inset
					: edge.y - h + 1 + inset;
			x = Math.max(2, Math.min(width - 2 - w, x));
			y = Math.max(2, Math.min(height - 2 - h, y));
			if (blocked(x, y, w, h, 3)) continue;

			const side: Side = horizontal ? (c > 0 ? 'w' : 'e') : s > 0 ? 'n' : 's';
			const d = SIDE_DIR[side];
			const door: Point =
				d.x !== 0
					? { x: d.x > 0 ? x + w - 1 : x, y: y + Math.floor(h / 2) }
					: { x: x + Math.floor(w / 2), y: d.y > 0 ? y + h - 1 : y };
			const access = { x: door.x + d.x, y: door.y + d.y };
			if (!inside(access.x, access.y) || at(access.x, access.y) === 'gate') continue;
			if (grid[access.y][access.x] === 'void') grid[access.y][access.x] = 'rock';
			facilities.push(placeRoom({ kind: f.kind, x, y, w, h, door, access }));
			break;
		}
	});

	// ── 3. Main streets via direction-aware Dijkstra ────────────────────────
	// Turning is expensive and existing roads are cheap, so paths come out as long
	// straight runs that merge into each other — like planned avenues.
	const noise: number[][] = Array.from({ length: height }, () =>
		Array.from({ length: width }, () => rand())
	);
	const TURN_COST = 5;
	const carvePath = (from: Point, to: Point, allowVoid = false) => {
		const N = width * height;
		const dist = new Float64Array(N * 4).fill(Infinity);
		const prev = new Int32Array(N * 4).fill(-1);
		const heap = new Heap();
		for (let d = 0; d < 4; d++) {
			const k = (from.y * width + from.x) * 4 + d;
			dist[k] = 0;
			heap.push(k, 0);
		}
		let goal = -1;
		while (heap.size) {
			const { k, p } = heap.pop();
			if (p > dist[k]) continue;
			const cell = k >> 2;
			const dir = k & 3;
			const x = cell % width;
			const y = (cell - x) / width;
			if (x === to.x && y === to.y) {
				goal = k;
				break;
			}
			for (let nd = 0; nd < 4; nd++) {
				if ((nd + 2) % 4 === dir) continue;
				const nx = x + DIRS[nd].x;
				const ny = y + DIRS[nd].y;
				if (!inside(nx, ny)) continue;
				const t = at(nx, ny);
				let base: number;
				if (t === 'road') base = 0.35;
				else if (t === 'rock') base = 1 + noise[ny][nx] * 1.5;
				else if (t === 'void' && allowVoid)
					base = 6; // dig a new tunnel out to a remote gate
				else continue;
				const step = base + (nd !== dir ? TURN_COST : 0);
				const nk = (ny * width + nx) * 4 + nd;
				if (p + step < dist[nk]) {
					dist[nk] = p + step;
					prev[nk] = k;
					heap.push(nk, p + step);
				}
			}
		}
		for (let k = goal; k !== -1; k = prev[k]) {
			const cell = k >> 2;
			const x = cell % width;
			const y = (cell - x) / width;
			const t = grid[y][x];
			if (t === 'rock' || t === 'road' || t === 'void') grid[y][x] = 'road';
		}
	};

	// Central plaza (skipping any gate that sits on the centre).
	const plaza = randInt(2, 3);
	for (let y = cy - plaza; y <= cy + plaza; y++)
		for (let x = cx - plaza; x <= cx + plaza; x++) if (at(x, y) === 'rock') grid[y][x] = 'road';
	// Hub = the plaza tile nearest the centre (a custom gate may cover the exact centre).
	let hub: Point = { x: cx, y: cy };
	for (let r = 0, found = false; r < Math.max(width, height) && !found; r++)
		for (let y = cy - r; y <= cy + r && !found; y++)
			for (let x = cx - r; x <= cx + r && !found; x++)
				if (at(x, y) === 'road' || at(x, y) === 'rock') {
					hub = { x, y };
					found = true;
				}
	if (at(hub.x, hub.y) === 'rock') grid[hub.y][hub.x] = 'road';

	// Ring road around the core, following the boundary's shape.
	const ringPoints: Point[] = [];
	const ringSteps = 10;
	for (let i = 0; i < ringSteps; i++) {
		const theta = (i / ringSteps) * Math.PI * 2;
		const r = radiusAt(theta) * (0.5 + rand() * 0.1);
		const p = {
			x: Math.round(cx + Math.cos(theta) * rx * r),
			y: Math.round(cy + Math.sin(theta) * ry * r)
		};
		if (at(p.x, p.y) === 'rock' || at(p.x, p.y) === 'road') ringPoints.push(p);
	}
	for (let i = 0; i < ringPoints.length; i++)
		carvePath(ringPoints[i], ringPoints[(i + 1) % ringPoints.length]);

	// Avenues from the plaza to every gate (digging through earth if a gate is outside the city).
	for (const g of [...gates, ...facilities]) carvePath(hub, g.access, true);

	// ── 4. Side streets: straight branches with occasional turns ────────────
	const isRoad = (x: number, y: number) => at(x, y) === 'road';
	const cityArea = mask.flat().filter(Boolean).length;
	const targetRoads = cityArea * (0.12 + streetDensity * 0.2);
	let roadCount = grid.flat().filter((t) => t === 'road').length;
	for (let attempt = 0; attempt < cityArea && roadCount < targetRoads; attempt++) {
		const sx = randInt(1, width - 2);
		const sy = randInt(1, height - 2);
		if (!isRoad(sx, sy)) continue;
		let dir = randInt(0, 3);
		let p = { x: sx, y: sy };
		const carved: Point[] = [];
		let segments = randInt(1, 3);
		let len = randInt(4, 12);
		for (;;) {
			const d = DIRS[dir];
			const n = { x: p.x + d.x, y: p.y + d.y };
			if (isRoad(n.x, n.y)) {
				// Joined another street: forms a loop / junction.
				if (carved.length) carved.push(n);
				break;
			}
			if (at(n.x, n.y) !== 'rock') break;
			// Keep streets single-width and at least two tiles apart side by side.
			const side = DIRS[(dir + 1) % 4];
			let crowded = false;
			for (const k of [-2, -1, 1, 2]) {
				const sxk = n.x + side.x * k;
				const syk = n.y + side.y * k;
				if (isRoad(sxk, syk) && !(carved.length === 0 && Math.abs(k) === 2)) crowded = true;
			}
			if (crowded) break;
			carved.push(n);
			p = n;
			if (--len <= 0) {
				if (--segments <= 0) break;
				dir = (dir + (rand() < 0.5 ? 1 : 3)) % 4;
				len = randInt(3, 10);
			}
		}
		if (carved.length < 3) continue;
		for (const c of carved) {
			if (grid[c.y][c.x] !== 'road') roadCount++;
			grid[c.y][c.x] = 'road';
		}
	}

	// ── 5. Rooms: packed against streets, one door each, one tile apart ─────
	const roadTiles: Point[] = [];
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) if (grid[y][x] === 'road') roadTiles.push({ x, y });

	/** Room must sit on bare rock and keep a one-tile gap (incl. diagonals) from other rooms/gates. */
	const fits = (x: number, y: number, w: number, h: number) => {
		for (let yy = y; yy < y + h; yy++)
			for (let xx = x; xx < x + w; xx++) if (at(xx, yy) !== 'rock') return false;
		for (let yy = y - 1; yy <= y + h; yy++)
			for (let xx = x - 1; xx <= x + w; xx++) {
				const t = at(xx, yy);
				if (t !== 'rock' && t !== 'road' && t !== 'void') return false;
			}
		return true;
	};
	const pickSize = () => {
		let r = rand() * ROOM_WEIGHT_TOTAL;
		for (const s of ROOM_SIZES) if ((r -= s.weight) <= 0) return s;
		return ROOM_SIZES[ROOM_SIZES.length - 1];
	};

	const roomAttempts = Math.floor(roadTiles.length * 6 * roomDensity);
	for (let i = 0; i < roomAttempts; i++) {
		const access = roadTiles[Math.floor(rand() * roadTiles.length)];
		const d = DIRS[randInt(0, 3)];
		const door = { x: access.x + d.x, y: access.y + d.y };
		if (at(door.x, door.y) !== 'rock') continue;
		// Try the chosen size, then progressively smaller allowed sizes so space still fills.
		const want = pickSize();
		// Only occasionally let an attempt settle for a one-tile-wide room.
		const allowThin = rand() < 0.02;
		const fallbacks = ROOM_SIZES.filter(
			(s) => s.w <= want.w && s.h <= want.h && (Math.min(s.w, s.h) > 1 || allowThin)
		).sort((a, b) => b.w * b.h - a.w * a.h);
		for (const { w, h } of fallbacks) {
			const x = d.x > 0 ? door.x : d.x < 0 ? door.x - w + 1 : door.x - randInt(0, w - 1);
			const y = d.y > 0 ? door.y : d.y < 0 ? door.y - h + 1 : door.y - randInt(0, h - 1);
			if (fits(x, y, w, h)) {
				placeRoom({ kind: 'room', x, y, w, h, door, access });
				break;
			}
		}
	}

	roadCount = grid.flat().filter((t) => t === 'road').length;
	return { width, height, seed, grid, roomAt, rooms, roadCount };
}
