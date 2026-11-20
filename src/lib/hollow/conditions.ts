/**
 * Simulated power, water and air per housing block, each a score from 0 (good) to 1 (bad)
 * in five steps. Nothing here is measured. Each kind only reads its own points and is
 * independent of the others:
 * - Every block starts from a level-wide base (darker levels have a weaker grid, deeper ones
 *   older mains, and the air supply thins with depth) plus a little noise from the city seed.
 * - Every point of the kind pushes the blocks it reaches towards bad: in full at the point,
 *   fading out to its reach. Power and water spread along the tunnels: the distance is the
 *   walk from the point to the block's door, so a fault reaches what its tunnels connect.
 *   Air spreads over an area (straight-line distance).
 *   Overlapping points compound.
 * Lung-sickness outbreaks are scored the same way (`kindScores(floor, 'sickness', …)`, area
 * spread) and turned into health reports in `sickness.ts`. Tuning is in `SIM.conditions`.
 */
import { hashPair } from '#lib/random.js';
import type { Room } from '#lib/tunnels/generate.js';
import { LEVELS } from './data.js';
import { SIM, spread, streamSeed } from './simConfig.js';
import {
	POINT_INFO,
	POINT_RADIUS,
	type PointKind,
	type SourceKind,
	type StatePoint,
	type Tile
} from './state.js';
import { perFloor, perFloorWith, type Floor } from './world.js';

/** A point on this floor with the housing blocks it reaches. */
export interface PointArea {
	point: StatePoint;
	/** Housing block (room) ids it pushes at least one step towards bad. */
	blocks: number[];
}

export interface FloorConditions {
	/** Kind → room id → score, 0 (good) to 1 (bad); null for rooms that aren't housing. */
	score: Record<PointKind, (number | null)[]>;
	/** Every point on this floor, with the blocks it reaches. */
	areas: PointArea[];
}

/** Five steps per kind, good first; the colours are the `--map-<kind>-1` … `-5` CSS variables. */
const steps = (kind: PointKind, labels: string[]) =>
	labels.map((label, i) => ({ color: `var(--map-${kind}-${i + 1})`, label, short: label }));
export const CONDITION_STEPS: Record<PointKind, { color: string; label: string; short: string }[]> =
	{
		power: steps('power', ['Stable', 'Flicker', 'Brownout', 'Cuts', 'Blackout']),
		water: steps('water', ['Clean', 'Fair', 'Poor', 'Unsafe', 'Toxic']),
		air: steps('air', ['Clean', 'Fair', 'Stale', 'Poor', 'Hazardous'])
	};

/** Which of the five steps a 0–1 score falls in (0 good … 4 bad). */
export const conditionStep = (score: number) => Math.min(4, Math.floor(score * 5));

/** Steps from here up count as bad (in totals and the lens headline). */
export const BAD_STEP = 3;

// ── Walking the tunnels ─────────────────────────────────────────────────────

/** Furthest walk worth tracking: past this every point has faded out. */
const MAX_WALK = POINT_RADIUS.max * 3;

/** Per floor: start tile → walking distance over road tiles (index y·width + x; -1 out of reach). */
const walkCache = perFloor(() => new Map<string, Int32Array>());

/** The road tile a point starts from: the nearest one, searching outward. */
function startTile(floor: Floor, x: number, y: number): Tile | null {
	const { grid } = floor.map;
	for (let r = 0; r <= 8; r++)
		for (let dy = -r; dy <= r; dy++)
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				if (grid[y + dy]?.[x + dx] === 'road') return { x: x + dx, y: y + dy };
			}
	return null;
}

/**
 * Walking distance along the tunnels from the road nearest (x, y) to every road tile, up to
 * `MAX_WALK`. Cached per floor and start tile, so resizing a point costs nothing.
 */
export function tunnelWalk(floor: Floor, x: number, y: number) {
	const start = startTile(floor, x, y);
	if (!start) return null;
	const key = `${start.x},${start.y}`;
	const cache = walkCache(floor);
	const hit = cache.get(key);
	if (hit) return { start, dist: hit };
	const { grid, width, height } = floor.map;
	const dist = new Int32Array(width * height).fill(-1);
	const queue = new Int32Array(width * height);
	let head = 0;
	let tail = 0;
	dist[start.y * width + start.x] = 0;
	queue[tail++] = start.y * width + start.x;
	while (head < tail) {
		const i = queue[head++];
		const d = dist[i];
		if (d >= MAX_WALK) continue;
		const tx = i % width;
		const ty = (i - tx) / width;
		for (const [nx, ny] of [
			[tx + 1, ty],
			[tx - 1, ty],
			[tx, ty + 1],
			[tx, ty - 1]
		]) {
			if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
			const j = ny * width + nx;
			if (dist[j] !== -1 || grid[ny][nx] !== 'road') continue;
			dist[j] = d + 1;
			queue[tail++] = j;
		}
	}
	cache.set(key, dist);
	return { start, dist };
}

/** Distance from a point to a block, by the kind's spread (Infinity when out of reach). */
function distanceFn(floor: Floor, point: StatePoint): (r: Room) => number {
	const cx = point.x + 0.5;
	const cy = point.y + 0.5;
	if (POINT_INFO[point.kind].spread === 'area')
		return (r) => Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy);
	const walk = tunnelWalk(floor, point.x, point.y);
	if (!walk) return () => Infinity;
	// Getting from the point onto its tunnel counts too.
	const offset = Math.hypot(walk.start.x + 0.5 - cx, walk.start.y + 0.5 - cy);
	const { width } = floor.map;
	return (r) => {
		const d = walk.dist[r.access.y * width + r.access.x];
		return d < 0 ? Infinity : offset + d + 1;
	};
}

// ── Scores ──────────────────────────────────────────────────────────────────

/** How much of a level-wide strain each kind takes from the level (0 easy, 1 hardest). */
function levelStrain(kind: SourceKind, floor: Floor) {
	const level = LEVELS[floor.index];
	const depth = floor.index / (LEVELS.length - 1);
	if (kind === 'power') return 1 - level.light;
	if (kind === 'water') return depth;
	// Sickness: the crowded top levels catch it most.
	if (kind === 'sickness') return 1 - depth;
	return 1 - level.air;
}

/** Room id → score for one kind, from that kind's points on the floor. */
function scoreKind(floor: Floor, kind: SourceKind, points: StatePoint[]) {
	const C = SIM.conditions[kind];
	const seed = streamSeed(floor.seed, kind) ^ floor.index;
	const base = C.base + C.levelWeight * levelStrain(kind, floor);
	const sources = points.map((p) => ({
		point: p,
		reach: Math.max(1, p.radius),
		strength: Math.min(1, Math.max(0, p.strength ?? 1)),
		distance: distanceFn(floor, p),
		blocks: [] as number[]
	}));
	const score = floor.map.rooms.map((r): number | null => {
		if (!(floor.residents[r.id] > 0)) return null;
		const noise = (hashPair(r.id, seed) - 0.5) * C.noise;
		const jitter = spread(C.jitter, hashPair(r.id * 7 + 3, seed));
		// What's left good after every point's push (overlapping points compound).
		let good = 1 - clamp(base + noise);
		for (const s of sources) {
			const d = s.distance(r);
			if (!Number.isFinite(d)) continue;
			const push = Math.min(1, (s.strength * jitter) / (1 + Math.pow(d / s.reach, C.edge)));
			if (push >= 0.2) s.blocks.push(r.id);
			good *= 1 - push;
		}
		return clamp(1 - good);
	});
	return { score, areas: sources.map((s) => ({ point: s.point, blocks: s.blocks })) };
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Per floor: each kind's last points (by content) and its scores. */
const kindCache = perFloor(
	() => new Map<SourceKind, { key: string; value: ReturnType<typeof scoreKind> }>()
);
const signature = (pts: StatePoint[]) =>
	pts.map((p) => `${p.id}:${p.x},${p.y},${p.radius},${p.strength ?? 1}`).join('|');

/**
 * One kind's scores on `floor` (room id → 0–1, null for non-housing) and the blocks each of
 * its points reaches, from the city's points (all levels and kinds; it picks its own). Cached
 * by the content of that kind's points: a change to a water point leaves the others untouched.
 */
export function kindScores(
	floor: Floor,
	kind: SourceKind,
	points: StatePoint[]
): { score: (number | null)[]; areas: PointArea[] } {
	const mine = points.filter((p) => p.kind === kind && p.level === floor.index);
	const key = signature(mine);
	const cache = kindCache(floor);
	const hit = cache.get(kind);
	if (hit && hit.key === key) return hit.value;
	const value = scoreKind(floor, kind, mine);
	cache.set(kind, { key, value });
	return value;
}

/** Power, water and air on `floor` given the city's points (all levels; it picks its own). */
export const conditionsOn = perFloorWith((floor: Floor, points: StatePoint[]): FloorConditions => {
	const power = kindScores(floor, 'power', points);
	const water = kindScores(floor, 'water', points);
	const air = kindScores(floor, 'air', points);
	return {
		score: { power: power.score, water: water.score, air: air.score },
		areas: [...power.areas, ...water.areas, ...air.areas]
	};
});

/** Residents per step of `kind` over some floors' conditions. */
export function conditionTotals(
	floors: { floor: Floor; conditions: FloorConditions }[],
	kind: PointKind
) {
	const byStep = [0, 0, 0, 0, 0];
	let residents = 0;
	for (const { floor, conditions } of floors)
		conditions.score[kind].forEach((s, id) => {
			if (s === null) return;
			byStep[conditionStep(s)] += floor.residents[id];
			residents += floor.residents[id];
		});
	/** Residents at a bad step or worse. */
	const bad = byStep.slice(BAD_STEP).reduce((a, b) => a + b, 0);
	return { byStep, residents, bad, share: bad / Math.max(1, residents) };
}
