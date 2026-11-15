/** Pre-generate every Hollow floor into src/lib/hollow/floors.json. Run: `bun run bake:hollow`. */
import { writeFileSync } from 'node:fs';
import { FLOOR_CONFIG, HOLLOW_SEED } from '../src/lib/hollow/data.ts';
import { encodeFloor, type BakedHollow } from '../src/lib/hollow/bake.ts';
import { generateHollowMaps } from '../src/lib/hollow/world.ts';

const t = performance.now();
const { gateSpecs, maps } = generateHollowMaps(HOLLOW_SEED);
const out: BakedHollow = {
	seed: HOLLOW_SEED,
	width: FLOOR_CONFIG.width,
	height: FLOOR_CONFIG.height,
	gateSpecs,
	floors: maps.map(encodeFloor)
};
const path = new URL('../src/lib/hollow/floors.json', import.meta.url);
writeFileSync(path, JSON.stringify(out));
console.log(
	`Baked ${maps.length} floors in ${Math.round(performance.now() - t)} ms → ${path.pathname}`
);
