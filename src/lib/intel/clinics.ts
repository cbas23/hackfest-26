/**
 * Where a new clinic would help most on the deep levels.
 *
 * Deterministic: walking distance along the tunnels from every housing block to its nearest
 * clinic, then the housing block that puts the most far-away residents back in reach.
 * No AI involved; the numbers come from the map and its resident estimates.
 */
import { HOLLOW_SEED, LEVELS } from '#lib/hollow/data.js';
import { TILE_M } from '#lib/hollow/nav.js';
import { createHollow, type Floor } from '#lib/hollow/world.js';
import type { Point, Room } from '#lib/tunnels/generate.js';

/** Levels from here down count as deep (L4 Lowmarch and below). */
export const FIRST_DEEP_LEVEL = 3;
/** A walk longer than this to the nearest clinic counts as out of reach. */
export const REACH_MINUTES = 15;
/** Below this many residents out of reach, a level doesn't need another clinic. */
const MIN_OUT_OF_REACH_SHARE = 0.2;
/** A level with only an aid post needs a full clinic once it houses this many people. */
const AID_POST_ONLY_RESIDENTS = 50_000_000;
const WALK_MPS = 1.3;

export interface ClinicProposal {
	level: number;
	/** Housing block the new clinic would go in. */
	room: Room;
	/** Proposed name, e.g. "Sump Clinic 2". */
	name: string;
	/** Why this level needs one, in plain words. */
	reason: string;
	/** Existing clinic or aid post on the level. */
	existing: string[];
	residents: number;
	/** Residents more than REACH_MINUTES from a clinic, before and after. */
	outOfReachBefore: number;
	outOfReachAfter: number;
	/** Resident-weighted average walk to the nearest clinic, in minutes. */
	avgWalkBefore: number;
	avgWalkAfter: number;
}

const walkable = (t: string) => t === 'road' || t === 'gate';

/** Tunnel distance in tiles from the nearest source to every walkable tile (-1 = unreachable). */
function distances(floor: Floor, sources: Point[]): Int32Array {
	const grid = floor.map.grid;
	const h = grid.length;
	const w = grid[0].length;
	const dist = new Int32Array(w * h).fill(-1);
	const queue = new Int32Array(w * h);
	let head = 0;
	let tail = 0;
	for (const s of sources) {
		const i = s.y * w + s.x;
		if (dist[i] === -1) {
			dist[i] = 0;
			queue[tail++] = i;
		}
	}
	while (head < tail) {
		const i = queue[head++];
		const x = i % w;
		const y = (i - x) / w;
		for (const [nx, ny] of [
			[x + 1, y],
			[x - 1, y],
			[x, y + 1],
			[x, y - 1]
		]) {
			if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
			const j = ny * w + nx;
			if (dist[j] !== -1 || !walkable(grid[ny][nx])) continue;
			dist[j] = dist[i] + 1;
			queue[tail++] = j;
		}
	}
	return dist;
}

const minutes = (tiles: number) => (tiles * TILE_M) / WALK_MPS / 60;

interface Reach {
	outOfReach: number;
	avgWalk: number;
}

function reach(floor: Floor, housing: Room[], dist: Int32Array): Reach {
	const w = floor.map.grid[0].length;
	let total = 0;
	let walk = 0;
	let out = 0;
	for (const r of housing) {
		const n = floor.residents[r.id];
		const d = dist[r.access.y * w + r.access.x];
		const m = d < 0 ? Infinity : minutes(d);
		total += n;
		if (m > REACH_MINUTES) out += n;
		if (Number.isFinite(m)) walk += m * n;
	}
	return { outOfReach: out, avgWalk: total ? walk / total : 0 };
}

/** The best spot for one more clinic on this floor, or undefined if the level is well served. */
export function proposeClinic(floor: Floor): ClinicProposal | undefined {
	if (floor.index < FIRST_DEEP_LEVEL) return undefined;
	const clinics = [...floor.facilities]
		.filter(([, spec]) => spec.kind === 'clinic')
		.map(([id, spec]) => ({ room: floor.map.rooms[id], name: spec.name }));
	if (!clinics.length) return undefined;

	const housing = floor.map.rooms.filter((r) => floor.residents[r.id] > 0);
	const residents = housing.reduce((s, r) => s + floor.residents[r.id], 0);
	const base = distances(
		floor,
		clinics.map((c) => c.room.access)
	);
	const before = reach(floor, housing, base);
	const farAway = before.outOfReach >= residents * MIN_OUT_OF_REACH_SHARE;
	const aidPostOnly =
		clinics.every((c) => /aid post/i.test(c.name)) && residents >= AID_POST_ONLY_RESIDENTS;
	if (!farAway && !aidPostOnly) return undefined;

	// Candidates: housing blocks with the most residents × walking distance.
	const w = floor.map.grid[0].length;
	const weight = (r: Room) => {
		const d = base[r.access.y * w + r.access.x];
		return floor.residents[r.id] * (d < 0 ? 1e6 : d);
	};
	const far = [...housing].sort((a, b) => weight(b) - weight(a)).slice(0, 24);

	let best: { room: Room; after: Reach } | undefined;
	for (const room of far) {
		const after = reach(
			floor,
			housing,
			distances(floor, [...clinics.map((c) => c.room.access), room.access])
		);
		if (
			!best ||
			after.outOfReach < best.after.outOfReach ||
			(after.outOfReach === best.after.outOfReach && after.avgWalk < best.after.avgWalk)
		)
			best = { room, after };
	}
	if (!best) return undefined;

	const level = LEVELS[floor.index];
	const round1 = (v: number) => Math.round(v * 10) / 10;
	return {
		level: floor.index,
		room: best.room,
		name: `${level.name.replace(/^The /, '')} General Clinic`,
		reason: farAway
			? `${Math.round((before.outOfReach / residents) * 100)}% of residents live more than ${REACH_MINUTES} min from a clinic`
			: `Only an aid post for ${Math.round(residents / 1e6)}M residents`,
		existing: clinics.map((c) => c.name),
		residents,
		outOfReachBefore: before.outOfReach,
		outOfReachAfter: best.after.outOfReach,
		avgWalkBefore: round1(before.avgWalk),
		avgWalkAfter: round1(best.after.avgWalk)
	};
}

const hollow = createHollow(HOLLOW_SEED);
const cache = new Map<number, ClinicProposal | undefined>();

/** Proposal for a level by index, worked out once and kept. */
export function clinicProposalFor(levelIndex: number): ClinicProposal | undefined {
	if (levelIndex < FIRST_DEEP_LEVEL) return undefined;
	if (!cache.has(levelIndex)) cache.set(levelIndex, proposeClinic(hollow.floor(levelIndex)));
	return cache.get(levelIndex);
}

/** "95M", "2.3M", "850K": readable resident counts. */
export function people(n: number): string {
	if (n >= 1e7) return `${Math.round(n / 1e6)}M`;
	if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
	return `${Math.round(n / 1e3)}K`;
}
