export type TileType = 'rock' | 'road' | 'residence';

export interface Tile {
	x: number;
	y: number;
	type: TileType;
	/** For residences: the single road tile that gives access to it. */
	access?: { x: number; y: number };
}

export interface TunnelMap {
	width: number;
	height: number;
	seed: number;
	tiles: Tile[][]; // tiles[y][x]
	roadCount: number;
	residenceCount: number;
}

export interface GenerateOptions {
	width?: number;
	height?: number;
	seed?: number;
	/** 0..1 — chance of opening an extra wall to create loops. */
	loopChance?: number;
	/** 0..1 — fraction of dead ends trimmed back so tunnels feel sparser. */
	deadEndTrim?: number;
	/** 0..1 — fraction of valid pockets turned into residences. */
	residenceChance?: number;
}

const DIRS = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0]
] as const;

/** Small deterministic PRNG so a seed always yields the same map. */
function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

export function generateTunnelMap(opts: GenerateOptions = {}): TunnelMap {
	// Odd dimensions so the maze lattice has a solid rock border.
	const width = (opts.width ?? 41) | 1;
	const height = (opts.height ?? 25) | 1;
	const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
	const loopChance = opts.loopChance ?? 0.08;
	const deadEndTrim = opts.deadEndTrim ?? 0.55;
	const residenceChance = opts.residenceChance ?? 0.35;
	const rand = mulberry32(seed);

	const road: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));
	const inBounds = (x: number, y: number) => x > 0 && y > 0 && x < width - 1 && y < height - 1;
	const roadNeighbours = (x: number, y: number) =>
		DIRS.filter(([dx, dy]) => road[y + dy]?.[x + dx]).map(([dx, dy]) => ({ x: x + dx, y: y + dy }));

	// 1. Carve a connected tunnel network with an iterative randomized DFS on odd cells.
	const start = {
		x: 1 + 2 * Math.floor(rand() * ((width - 1) / 2)),
		y: 1 + 2 * Math.floor(rand() * ((height - 1) / 2))
	};
	road[start.y][start.x] = true;
	const stack = [start];
	while (stack.length) {
		const cur = stack[stack.length - 1];
		const options = shuffle([...DIRS], rand).filter(([dx, dy]) => {
			const nx = cur.x + dx * 2;
			const ny = cur.y + dy * 2;
			return inBounds(nx, ny) && !road[ny][nx];
		});
		if (!options.length) {
			stack.pop();
			continue;
		}
		const [dx, dy] = options[0];
		road[cur.y + dy][cur.x + dx] = true;
		road[cur.y + dy * 2][cur.x + dx * 2] = true;
		stack.push({ x: cur.x + dx * 2, y: cur.y + dy * 2 });
	}

	// 2. Punch a few extra openings so the network has loops (not just a tree).
	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			if (road[y][x] || (x % 2 === 1 && y % 2 === 1)) continue;
			const horiz = road[y][x - 1] && road[y][x + 1];
			const vert = road[y - 1][x] && road[y + 1][x];
			if ((horiz || vert) && rand() < loopChance) road[y][x] = true;
		}
	}

	// 3. Trim dead ends back so the map has open rock to place residences in.
	//    Removing a tile with a single neighbour never disconnects the network.
	const trimSteps = Math.floor(((width * height) / 4) * deadEndTrim);
	for (let i = 0; i < trimSteps; i++) {
		const deadEnds: { x: number; y: number }[] = [];
		for (let y = 1; y < height - 1; y++)
			for (let x = 1; x < width - 1; x++)
				if (road[y][x] && roadNeighbours(x, y).length === 1) deadEnds.push({ x, y });
		if (!deadEnds.length) break;
		const d = deadEnds[Math.floor(rand() * deadEnds.length)];
		road[d.y][d.x] = false;
	}

	// 4. Residences: rock tiles touching exactly ONE road tile (orthogonally),
	//    and never touching another residence, so each is reachable through one road only.
	const tiles: Tile[][] = Array.from({ length: height }, (_, y) =>
		Array.from({ length: width }, (_, x) => ({ x, y, type: road[y][x] ? 'road' : 'rock' }) as Tile)
	);
	const candidates: { x: number; y: number }[] = [];
	for (let y = 1; y < height - 1; y++)
		for (let x = 1; x < width - 1; x++)
			if (!road[y][x] && roadNeighbours(x, y).length === 1) candidates.push({ x, y });

	let residenceCount = 0;
	for (const c of shuffle(candidates, rand)) {
		if (rand() > residenceChance) continue;
		const nearResidence = DIRS.some(
			([dx, dy]) => tiles[c.y + dy]?.[c.x + dx]?.type === 'residence'
		);
		if (nearResidence) continue;
		const [access] = roadNeighbours(c.x, c.y);
		tiles[c.y][c.x] = { x: c.x, y: c.y, type: 'residence', access };
		residenceCount++;
	}

	const roadCount = road.flat().filter(Boolean).length;
	return { width, height, seed, tiles, roadCount, residenceCount };
}
