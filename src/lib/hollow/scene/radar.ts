/**
 * Radar add-on: a radar lying flat on a level, with a disc, range rings, cross-hairs, a
 * rotating sweep and an expanding ping. `radarOverlay(hollowMap).set(radar)`; null clears it.
 */
import * as THREE from 'three';
import type { OverlayHandle } from '#lib/map/index.js';
import { cssColor } from '../theme.js';
import { addOn, H, layerId, W, type HollowMapHooks } from './common.js';

export interface RadarSpec {
	level: number;
	/** Centre, in tiles. */
	x: number;
	y: number;
	/** In tiles. */
	radius: number;
	/** Any CSS colour; defaults to the theme's `--map-radar`. */
	color?: string;
}

/** One sweep, in ms. */
const PERIOD = 2400;
/** Slices the sweep wedge is built from, so its trailing edge fades out. */
const SLICES = 14;
const WEDGE = Math.PI * 0.4;

function buildRadar(r: RadarSpec) {
	const R = r.radius;
	const color = cssColor(r.color ?? 'var(--map-radar)');
	const flat = (geo: THREE.BufferGeometry, opacity: number, order: number) => {
		const m = new THREE.Mesh(
			geo,
			new THREE.MeshBasicMaterial({
				color,
				transparent: true,
				opacity,
				side: THREE.DoubleSide,
				depthWrite: false,
				depthTest: false
			})
		);
		m.rotation.x = -Math.PI / 2;
		m.renderOrder = 40 + order;
		return m;
	};
	const root = new THREE.Group();
	// Just above the street, in the level's own space, so it stacks and tilts with it.
	root.position.set(r.x - W / 2, 0.2, r.y - H / 2);
	const w = Math.max(0.35, R * 0.012);
	root.add(flat(new THREE.CircleGeometry(R, 96), 0.1, 0));
	for (const [f, o] of [
		[1, 0.85],
		[2 / 3, 0.45],
		[1 / 3, 0.45]
	])
		root.add(flat(new THREE.RingGeometry(R * f - w, R * f, 128), o, 1));
	// Cross-hairs.
	root.add(flat(new THREE.PlaneGeometry(R * 2, w * 0.7), 0.3, 1));
	root.add(flat(new THREE.PlaneGeometry(w * 0.7, R * 2), 0.3, 1));
	const sweep = new THREE.Group();
	for (let i = 0; i < SLICES; i++)
		sweep.add(
			flat(
				new THREE.CircleGeometry(R, 8, (i / SLICES) * WEDGE, WEDGE / SLICES + 0.002),
				0.5 * (i / SLICES) ** 1.6,
				2
			)
		);
	root.add(sweep);
	const ping = flat(new THREE.RingGeometry(0.9, 1, 96), 0.8, 3);
	root.add(ping);

	const t0 = performance.now();
	const animate = (t: number) => {
		const k = ((t - t0) % PERIOD) / PERIOD;
		sweep.rotation.y = -((t - t0) / PERIOD) * Math.PI * 2;
		ping.scale.setScalar(Math.max(0.01, R * k));
		(ping.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
	};
	return { root, animate };
}

function createRadar(hooks: HollowMapHooks) {
	const { map } = hooks;
	let handle: OverlayHandle | null = null;
	let last: RadarSpec | null = null;
	let raf = 0;

	const self = {
		set(r: RadarSpec | null) {
			last = r;
			cancelAnimationFrame(raf);
			handle?.remove();
			handle = null;
			const layer = r && map.layer(layerId(r.level));
			if (!r || !layer) return;
			const { root, animate } = buildRadar(r);
			handle = map.addOverlay({ type: 'object', layer: layer.id, object: root });
			const tick = (t: number) => {
				animate(t);
				raf = requestAnimationFrame(tick);
			};
			raf = requestAnimationFrame(tick);
		}
	};
	// A radar in the theme's colour follows the theme.
	hooks.onTheme(() => {
		if (last && !last.color) self.set(last);
	});
	hooks.onDispose(() => cancelAnimationFrame(raf));
	return self;
}

export const radarOverlay = addOn(createRadar);
