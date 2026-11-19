/**
 * Small deterministic random helpers, so seeded content is the same on every run.
 * Changing any constant here changes every generated city and simulated dataset.
 */

/** Seeded PRNG (mulberry32): each call returns the next float in [0, 1). */
export function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Hash of one integer → [0, 1). */
export const hash01 = (n: number) => {
	let h = Math.imul(n + 0x9e3779b9, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
};

/** Salts for `hashPair`; a different salt gives an independent stream for the same inputs. */
export const SALT = {
	world: [0x9e3779b9, 0x632be59b],
	sensors: [0x5bd1e995, 0x27d4eb2f]
} as const satisfies Record<string, readonly [number, number]>;

/** Hash of two integers → [0, 1). */
export function hashPair(a: number, b: number, salt: readonly [number, number] = SALT.world) {
	let h = Math.imul(a ^ salt[0], 0x85ebca6b) ^ Math.imul(b + salt[1], 0xc2b2ae35);
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d);
	h ^= h >>> 12;
	return (h >>> 0) / 4294967296;
}
