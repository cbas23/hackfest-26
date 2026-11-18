/**
 * Named buildings callers can mention ("I'm at the Johnson Center on level 3").
 *
 * The generated map only names facilities (clinics, water works, air exchanges, markets);
 * housing blocks are numbered. So a few blocks per level get a landmark name here, chosen
 * deterministically from the seeded map so every client and the server agree.
 */
import { HOLLOW_SEED, LEVELS } from '#lib/hollow/data.js';
import { placesOn } from '#lib/hollow/nav.js';
import { createHollow } from '#lib/hollow/world.js';

export interface Building {
	key: string;
	label: string;
	/** 1-based, like hotline levels. */
	level: number;
	/** Tile centre. */
	x: number;
	y: number;
}

/** Landmark names per level; the first sits nearest the middle of the level. */
const LANDMARKS: string[][] = [
	['Crown Atrium', 'Directorate Hall', 'Sunlamp Gardens', 'Archive House'],
	['Lampline Commons', 'Ferris Towers', 'Glasswork Row', 'Beacon House', 'Orchard Flats'],
	[
		'Johnson Center',
		'Halvorsen Hall',
		'Mercer Commons',
		'Okafor Tower',
		'Pell Street Dorms',
		'Lindqvist Arcade',
		'Rook House',
		'Tunnel Nine Hostel'
	],
	['Lowmarch Exchange', 'Ibarra Blocks', 'Cistern Court', 'Kettle Row', 'Vance Tower', 'Saltworks'],
	['Sump Station', 'Dredger Halls', 'Mire Court', 'Pumphouse Flats', 'Ostrander Block'],
	['Blackline Depot', 'Cinder Rows', 'Furnace Gate', 'Slag Court'],
	['Furnace Hall', 'Ember Court', 'Deepwell Barracks', 'Magma Row']
];

let cache: Building[][] | null = null;
let world: ReturnType<typeof createHollow> | null = null;

/** The seeded Hollow, shared by building lookups and route planning. */
export const hollowWorld = () => (world ??= createHollow(HOLLOW_SEED));

/** Named buildings for every level, index 0 = L1. */
export function buildings(): Building[][] {
	if (cache) return cache;
	const hollow = hollowWorld();
	cache = LEVELS.map((l, i) => {
		const places = placesOn(hollow.floor(l.index));
		const centre = (p: { room: { x: number; y: number; w: number; h: number } }) => ({
			x: p.room.x + p.room.w / 2,
			y: p.room.y + p.room.h / 2
		});
		const out: Building[] = places
			.filter((p) => ['clinic', 'water', 'air', 'market'].includes(p.kind))
			.map((p) => ({ key: p.key, label: p.label, level: i + 1, ...centre(p) }));

		const blocks = places.filter((p) => p.kind === 'block');
		const names = LANDMARKS[i] ?? [];
		if (blocks.length && names.length) {
			let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
			for (const b of blocks) {
				const c = centre(b);
				minX = Math.min(minX, c.x);
				maxX = Math.max(maxX, c.x);
				minY = Math.min(minY, c.y);
				maxY = Math.max(maxY, c.y);
			}
			const mid = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
			const span = Math.max(maxX - minX, maxY - minY);
			const taken: { x: number; y: number }[] = [];
			names.forEach((label, n) => {
				// First name near the middle; the rest on a ring around it, spaced apart.
				const angle = (n / Math.max(1, names.length - 1)) * Math.PI * 2;
				const r = n === 0 ? 0 : span * (n % 2 ? 0.12 : 0.2);
				const want = { x: mid.x + Math.cos(angle) * r, y: mid.y + Math.sin(angle) * r };
				let best = blocks[0];
				let bestD = Infinity;
				for (const b of blocks) {
					const c = centre(b);
					if (taken.some((t) => Math.hypot(t.x - c.x, t.y - c.y) < 6)) continue;
					const d = Math.hypot(c.x - want.x, c.y - want.y);
					if (d < bestD) {
						bestD = d;
						best = b;
					}
				}
				const c = centre(best);
				taken.push(c);
				out.push({ key: best.key, label, level: i + 1, ...c });
			});
		}
		return out;
	});
	return cache;
}

const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/[’']/g, '')
		.replace(/\b(the|a|an)\b/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

/** The building named in what the caller said, preferring their level. */
export function findBuilding(text: string, level?: number): Building | null {
	const t = ` ${norm(text)} `;
	if (t.trim().length < 3) return null;
	const all = buildings();
	const order = level ? [all[level - 1] ?? [], ...all.filter((_, i) => i !== level - 1)] : all;
	for (const list of order) for (const b of list) if (t.includes(` ${norm(b.label)} `)) return b;
	return null;
}

export const buildingByKey = (key: string) =>
	buildings()
		.flat()
		.find((b) => b.key === key) ?? null;
