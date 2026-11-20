/** Shared pieces of the Hollow's 3D scene: layer ids, the stacked layout and the add-on hooks. */
import type { Point, Room } from '#lib/tunnels/generate.js';
import type { TunnelMapView } from '#lib/map/index.js';
import { FLOOR_CONFIG, LEVELS } from '../data.js';

export const W = FLOOR_CONFIG.width;
export const H = FLOOR_CONFIG.height;

export const layerId = (level: number) => `floor-${level}`;
export const levelOf = (id: string) => Number(id.slice('floor-'.length));

/** All-levels view: levels stack at their true relative depth, scaled to blocks. */
const STACK_SCALE = 0.25;
export const stackY = (level: number) => -(LEVELS[level].depth - LEVELS[0].depth) * STACK_SCALE;
/** Where the camera looks in the all-levels view: a little above the middle of the stack. */
export const STACK_MID = stackY(LEVELS.length - 1) * 0.3;

export interface Pick {
	tile: Point;
	room: Room | null;
	/** Level the pick landed on (in the all-levels view, the one under the cursor). */
	level: number;
}

/**
 * What add-ons (route, radar, level tints) build on: the generic map plus the few Hollow
 * events they need to stay in sync. Every `on*` returns its unsubscribe.
 */
export interface HollowMapHooks {
	readonly map: TunnelMapView;
	/** Whether the levels are stacked right now (flips while the veil is closed). */
	isStacked(): boolean;
	/** Tint every level's tunnels for contrast (directions, a route); a data lens overrides it. */
	setTunnelDim(on: boolean): void;
	/** A level's layer was just created. */
	onLayer(fn: (level: number) => void): () => void;
	/** Levels were restyled (lens or theme change), so sizes taken from the old looks are stale. */
	onRestyle(fn: () => void): () => void;
	/** The theme changed; the scene has already repainted its own parts. */
	onTheme(fn: () => void): () => void;
	/** The map is being disposed. */
	onDispose(fn: () => void): () => void;
}

/** Tiny event list for the hooks above. */
export function signal<A extends unknown[] = []>() {
	const fns = new Set<(...args: A) => void>();
	return {
		on(fn: (...args: A) => void) {
			fns.add(fn);
			return () => void fns.delete(fn);
		},
		emit(...args: A) {
			for (const fn of [...fns]) fn(...args);
		}
	};
}

/**
 * Make an add-on attach lazily, once per map: `routeOverlay(hollowMap).set(…)` creates the
 * route the first time it is asked for and reuses it after.
 */
export function addOn<T>(create: (hooks: HollowMapHooks) => T) {
	const made = new WeakMap<HollowMapHooks, T>();
	return ({ hooks }: { hooks: HollowMapHooks }): T => {
		let a = made.get(hooks);
		if (!a) made.set(hooks, (a = create(hooks)));
		return a;
	};
}
