/**
 * Hover hitboxes for the all-levels view. The stack is a layered cake: one square box per
 * level, all the same size, stacked with no gaps. A level's slice runs halfway up to the
 * level above and halfway down to the one below (the top and bottom slices reach as far
 * past their level as the next one in). The pointer picks the first slice its ray enters,
 * so pointing through a hole in a level still lands on that level, and its sides read as
 * levels by height.
 */
import * as THREE from 'three';
import type { TunnelMapView } from '#lib/map/index.js';
import { LEVELS } from '../data.js';
import { builtBounds, type Bounds, type Floor } from '../world.js';
import { levelOf, type Pick } from './common.js';

/** Share of the levels' squared-off built area the hitboxes cover (centred). */
const CAKE_AREA = 0.125;
/** Share of the space between levels the hitboxes fill (1 = stacked with no gaps). */
const CAKE_HEIGHT = 0.5;
/** Height (blocks) of the slice when only one level is shown. */
const SINGLE_SLICE = 30;

/** Returns the pick for a pointer event: the level whose slice its ray enters first. */
export function createStackPicker(
	map: TunnelMapView,
	container: HTMLElement,
	floors: ReadonlyMap<number, Floor>
) {
	let final: Bounds | null = null;
	/** The shared square footprint, in tiles: every level's built area, squared off and shrunk. */
	const footprint = (): Bounds => {
		if (final) return final;
		let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
		for (const floor of floors.values()) {
			const b = builtBounds(floor);
			minX = Math.min(minX, b[0]);
			minY = Math.min(minY, b[1]);
			maxX = Math.max(maxX, b[2]);
			maxY = Math.max(maxY, b[3]);
		}
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		const half = (Math.max(maxX - minX, maxY - minY) / 2) * Math.sqrt(CAKE_AREA);
		const b = [cx - half, cy - half, cx + half, cy + half] as const;
		// Only final once every level is in.
		if (floors.size === LEVELS.length) final = b;
		return b;
	};

	/** World-space box of each shown level's slice, top level first. */
	const slices = () => {
		const shown = map
			.layers()
			.filter((l) => l.visible && floors.has(levelOf(l.id)))
			.sort((a, b) => b.y - a.y);
		if (!shown.length) return [];
		const [minX, minY, maxX, maxY] = footprint();
		const ys = shown.map((l) => map.toWorld(0, 0, 0, l.id).y);
		const gap = ys.length > 1 ? ys[0] - ys[1] : SINGLE_SLICE;
		return shown.map((l, i) => {
			// Halfway to each neighbour, then scaled about the level by CAKE_HEIGHT.
			const up = i > 0 ? (ys[i - 1] - ys[i]) / 2 : gap / 2;
			const down =
				i < ys.length - 1 ? (ys[i] - ys[i + 1]) / 2 : i > 0 ? (ys[i - 1] - ys[i]) / 2 : gap / 2;
			const top = ys[i] + up * CAKE_HEIGHT;
			const bottom = ys[i] - down * CAKE_HEIGHT;
			const box = new THREE.Box3().setFromPoints([
				map.toWorld(minX, minY, 0, null).setY(bottom),
				map.toWorld(maxX, maxY, 0, null).setY(top)
			]);
			return { level: levelOf(l.id), box };
		});
	};

	const hit = new THREE.Vector3();
	return (e: PointerEvent): Pick | null => {
		const rect = container.getBoundingClientRect();
		const ray = map.rayAt(e.clientX - rect.left, e.clientY - rect.top);
		let best: Pick | null = null;
		let nearest = Infinity;
		const [minX, minY, maxX, maxY] = footprint();
		for (const { level, box } of slices()) {
			if (!ray.intersectBox(box, hit)) continue;
			const d = hit.distanceToSquared(ray.origin);
			if (d >= nearest) continue;
			nearest = d;
			best = {
				level,
				room: null,
				tile: { x: Math.floor((minX + maxX) / 2), y: Math.floor((minY + maxY) / 2) }
			};
		}
		return best;
	};
}
