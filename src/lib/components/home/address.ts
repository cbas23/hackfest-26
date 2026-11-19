import { LEVELS } from '#lib/hollow/data.js';
import { placesOn, type Place } from '#lib/hollow/nav.js';
import { getHollow } from '#lib/hollow/simulation.js';

/** The place behind a place key ("<level>:<roomId>"), if it exists. */
export function placeByKey(key: string | null): Place | null {
	if (!key) return null;
	const [level, room] = key.split(':').map(Number);
	if (!LEVELS[level]) return null;
	return placesOn(getHollow().floor(level)).find((p) => p.room.id === room) ?? null;
}

/**
 * Read a typed home address such as "L3-42" or "Block L3-42" (the block's label). Returns the
 * habitation block, or a message saying what is wrong.
 */
export function parseAddress(text: string): Place | string {
	const m = /^\s*(?:block\s*)?l?\s*(\d+)\s*[-:\s]\s*(\d+)\s*$/i.exec(text);
	if (!m) return 'Write it as level-block, e.g. L3-42.';
	const level = Number(m[1]) - 1;
	if (!LEVELS[level]) return `There is no level L${m[1]} (L1 to L${LEVELS.length}).`;
	const place = placeByKey(`${level}:${Number(m[2])}`);
	if (!place) return `There is no block ${m[2]} on ${LEVELS[level].code}.`;
	if (place.kind !== 'block') return `${place.label} isn't a habitation block.`;
	return place;
}

/** A real block to show as an example address. */
export const exampleAddress = (): string =>
	placesOn(getHollow().floor(2))
		.find((p) => p.kind === 'block')
		?.label.replace('Block ', '') ?? 'L3-42';
