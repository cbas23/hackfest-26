/**
 * The Hollow's map: the generic tunnel-map renderer (`#lib/map`) dressed with Hollow
 * floors, plus the navigation visuals the app needs (level changes, the all-levels stack,
 * route, impact tint, outlines, pins). Everything here is built from the library's
 * public primitives; reach for `hollowMap.map` to add your own.
 */
import * as THREE from 'three';
import type { Point, Room } from '#lib/tunnels/generate.js';
import {
	createMap,
	type BoxesOverlay,
	type MapLayer,
	type OutlineOverlay,
	type OverlayHandle,
	type MarkerHandle,
	type TunnelMapView
} from '#lib/map/index.js';
import { SIDE_SHADE, UNDERSIDE_SHADE } from '#lib/map/mesh.js';
import { FLOOR_CONFIG, LEVELS, SHAFTS } from './data.js';
import {
	floorStyle,
	type MapLens,
	SHAFT_H,
	SHAFT_PART,
	shaftColors,
	TUNNEL_H
} from './mapStyle.js';
import { onThemeChange, tokenHex } from './theme.js';
import type { Floor } from './world.js';

const W = FLOOR_CONFIG.width;
const H = FLOOR_CONFIG.height;
/** Furthest the camera may pull back; scaled to the 500×400 floors. */
const MAX_DISTANCE = 1040;
const NEAR_FOG = { near: 520, far: 1440 };
const FAR_FOG = { near: 1040, far: 3000 };
/** Level change: the old level slides away under a veil, the new one slides in. */
const LEVEL_OUT_MS = 170;
const LEVEL_IN_MS = 280;
/** How far a level slides during the change, in blocks. */
const LEVEL_SLIDE = 12;
/** All-levels view: levels stack at their true relative depth, scaled to blocks. */
const STACK_SCALE = 0.25;
const stackY = (level: number) => -(LEVELS[level].depth - LEVELS[0].depth) * STACK_SCALE;
/** Where the camera looks in the all-levels view: a little above the middle of the stack. */
const STACK_MID = stackY(LEVELS.length - 1) * 0.3;
/** Height the route ribbon rides at: on top of the (solid) tunnels. */
const ROUTE_Y = TUNNEL_H;
/** How far the route's cyan shell stands proud of the tunnel faces, in blocks. */
const ROUTE_PAD = 0.02;
/** Thickness of the white inverted-hull border around the painted tunnel, in blocks. */
const ROUTE_BORDER = 0.3;
/**
 * Smallest on-screen size of the route, in CSS pixels. Zoomed out (and in the all-levels
 * view) a tunnel is only a pixel or two wide, so the route grows past it to stay readable.
 */
const ROUTE_MIN_PX = 7;
const ROUTE_BORDER_MIN_PX = 3;
/** Redraw the route when its on-screen scale drifts by more than this fraction. */
const ROUTE_RESCALE = 0.12;
/**
 * Render order of the route. It ignores depth (nothing covers it), with the white hull
 * first and the cyan shell over it, so the white only shows outside the cyan silhouette.
 * It still writes depth, so the raised end buildings drawn after it can cover it.
 */
const ROUTE_ORDER = 5;

export const layerId = (level: number) => `floor-${level}`;
const levelOf = (id: string) => Number(id.slice('floor-'.length));

export interface Pick {
	tile: Point;
	room: Room | null;
	/** Level the pick landed on (in the all-levels view, the one under the cursor). */
	level: number;
}

export interface Pin {
	el: HTMLElement;
	/** Tile coordinates (centre of the marker). */
	x: number;
	y: number;
	/** Height above the floor. */
	h?: number;
	/** Level the pin belongs to; it rides with that level. */
	level?: number;
}

/** A route as the map draws it: walking legs per level, joined by shaft rides. */
export interface RouteDraw {
	legs: { level: number; path: Point[] }[];
	/** Shaft rides, at the landing's tile, between two levels. */
	rides: { x: number; y: number; from: number; to: number }[];
}

export interface HollowMapOptions {
	onHover(pick: Pick | null): void;
	onClick(pick: Pick | null): void;
	onView?(info: { distance: number; heading: number }): void;
	/** A level change started (true) or finished (false); overlays should hide meanwhile. */
	onTransition?(active: boolean): void;
	/** Camera distance for the stacked view (default MAX_DISTANCE). Larger fits a smaller panel. */
	stackDistance?: number;
}

export interface HollowMap {
	/** The underlying generic map, for anything beyond these helpers. */
	readonly map: TunnelMapView;
	/** Show one floor; `dir` > 0 arrives from above (going deeper), < 0 from below. */
	showFloor(floor: Floor, dir: number): void;
	setHover(room: Room | null): void;
	setSelection(room: Room | null): void;
	setRoute(route: RouteDraw | null): void;
	/** Stack every level at its depth (`floors` must hold all of them), or go back to one. */
	setOverview(on: boolean, floors: Floor[]): void;
	/** Frame the whole all-levels stack (the view it opens on). */
	frameStack(): void;
	/**
	 * In the all-levels view, keep one level solid and fade the others almost away (e.g.
	 * the level under the pointer); null shows them all. Ignored outside that view.
	 */
	setFocusLevel(level: number | null): void;
	setPins(pins: Pin[]): void;
	/**
	 * Build a level's meshes ahead of time (in the background) so showing it later is
	 * instant. Cheap to call again.
	 */
	preload(floor: Floor): void;
	/** Repaint every level with a data lens (e.g. sickness), or back to the normal look. */
	setLens(lens: MapLens | null): void;
	/** Repaint with the current lens after the data behind it changed (e.g. an alert was fixed). */
	refreshLens(): void;
	/** Tint rooms on the shown floor (impact assessment); an empty list clears it. */
	setImpact(rooms: { room: Room; color: string }[]): void;
	/** Rooms on the current level that throb in their colour (alerts); [] clears. */
	setAlertPulse(rooms: { room: Room; color: string }[]): void;
	/** Tint every building on whole levels (shown in the stacked view too), e.g. a risk heat map. */
	setLevelTints(tints: { level: number; color: string; opacity?: number }[]): void;
	/** A radar lying flat on a level: disc, range rings, a rotating sweep and a ping. Null clears it. */
	setRadar(
		radar: { level: number; x: number; y: number; radius: number; color?: string } | null
	): void;
	flyTo(x: number, y: number, opts?: { distance?: number; heading?: Point; tilt?: number }): void;
	fitBounds(minX: number, minY: number, maxX: number, maxY: number): void;
	zoomBy(factor: number): void;
	resetNorth(): void;
	setPan(x: number, y: number): void;
	dispose(): void;
}

const easeIn = (t: number) => t * t;
/** Share of the levels' squared-off built area the hover hitboxes cover (centred). */
const CAKE_AREA = 0.125;
/** Share of the space between levels the hitboxes fill (1 = stacked with no gaps). */
const CAKE_HEIGHT = 0.5;
/** Height (blocks) of the slice when only one level is shown. */
const SINGLE_SLICE = 30;
/** Opacity of the other levels while one is focused in the all-levels view. */
const FOCUS_DIM = 0.1;
/** Time constant of the focus fade, in ms. */
const FOCUS_FADE_MS = 60;
/** Run when the page is idle (soon, at the latest). */
const idle = (fn: () => void) =>
	typeof requestIdleCallback === 'function'
		? requestIdleCallback(fn, { timeout: 500 })
		: setTimeout(fn, 30);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export function createHollowMap(container: HTMLElement, opts: HollowMapOptions): HollowMap {
	// Every colour comes from the `--map-*` CSS variables (see theme.ts), so the scene matches
	// the UI around it and repaints when the theme changes.
	const map = createMap(container, {
		background: tokenHex('map-background'),
		light: { sky: tokenHex('map-light-sky'), ground: tokenHex('map-light-ground') },
		origin: { x: W / 2, y: H / 2 },
		fog: NEAR_FOG,
		camera: { maxDistance: Math.max(MAX_DISTANCE, opts.stackDistance ?? 0) }
	});

	// ── Hover hitboxes (all-levels view) ────────────────────────────────────
	// The stack is a layered cake: one square box per level, all the same size, stacked with
	// no gaps. A level's slice runs halfway up to the level above and halfway down to the one
	// below (the top and bottom slices reach as far past their level as the next one in).
	// The pointer picks the first slice its ray enters, so pointing through a hole in a level
	// still lands on that level, and its sides read as levels by height.
	let cakeTiles: readonly [number, number, number, number] | null = null;
	/** The shared square footprint, in tiles: every level's built area, squared off and shrunk. */
	const cakeFootprint = () => {
		if (cakeTiles) return cakeTiles;
		let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
		for (const floor of floors.values())
			floor.map.grid.forEach((row, y) =>
				row.forEach((t, x) => {
					if (t === 'void' || t === 'rock') return;
					minX = Math.min(minX, x);
					maxX = Math.max(maxX, x + 1);
					minY = Math.min(minY, y);
					maxY = Math.max(maxY, y + 1);
				})
			);
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		const half = (Math.max(maxX - minX, maxY - minY) / 2) * Math.sqrt(CAKE_AREA);
		const b = [cx - half, cy - half, cx + half, cy + half] as const;
		// Only final once every level is in.
		if (floors.size === LEVELS.length) cakeTiles = b;
		return b;
	};
	/** World-space box of each shown level's slice, top level first. */
	const cakeSlices = () => {
		const shown = map
			.layers()
			.filter((l) => l.visible && floors.has(levelOf(l.id)))
			.sort((a, b) => b.y - a.y);
		if (!shown.length) return [];
		const [minX, minY, maxX, maxY] = cakeFootprint();
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
	const slabHit = new THREE.Vector3();
	/** The level whose slice the pointer's ray enters first. */
	const slabPick = (e: PointerEvent): Pick | null => {
		const rect = container.getBoundingClientRect();
		const ray = map.rayAt(e.clientX - rect.left, e.clientY - rect.top);
		let best: Pick | null = null;
		let nearest = Infinity;
		const [minX, minY, maxX, maxY] = cakeFootprint();
		for (const { level, box } of cakeSlices()) {
			if (!ray.intersectBox(box, slabHit)) continue;
			const d = slabHit.distanceToSquared(ray.origin);
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

	const toPick = (p: { layer: string; tile: Point; room: Room | null } | null): Pick | null =>
		p && { tile: p.tile, room: p.room, level: levelOf(p.layer) };
	// In the all-levels view a pick names a level, not a room (see the hover hitboxes above).
	map.on('hover', (p, e) => opts.onHover(overview ? (e ? slabPick(e) : null) : toPick(p)));
	map.on('click', (p, e) => opts.onClick(overview ? slabPick(e) : toPick(p)));
	if (opts.onView) map.on('view', opts.onView);

	// ── Floors ──────────────────────────────────────────────────────────────
	let current: Floor | null = null;
	let lens: MapLens | null = null;
	const floors = new Map<number, Floor>();
	// A lens already draws its tunnels near-black (see floorStyle), so it needs no tint.
	// Tint multiplied into the tunnels while a route is shown, for contrast with the route.
	const tunnelTint = () => (!lens && lastRoute ? tokenHex('map-route-dim') : null);
	/** Bumped on every theme change, so each layer knows its colours are stale. */
	let themeVersion = 0;
	/** Bumped when the lens's data changes, so layers repaint with the same lens. */
	let dataVersion = 0;
	const styleKey = () => `${lens}@${themeVersion}.${dataVersion}`;
	/** The lens and theme each layer was last styled with. */
	const styledWith = new Map<number, string>();
	/** Restyle a layer if the lens or theme changed since it was built. */
	const syncLens = (index: number) => {
		const layer = map.layer(layerId(index));
		const floor = floors.get(index);
		if (!layer || !floor || styledWith.get(index) === styleKey()) return;
		styledWith.set(index, styleKey());
		layer.setStyle(floorStyle(floor, lens));
		layer.setTunnelTint(tunnelTint());
	};
	const layerFor = (floor: Floor): MapLayer => {
		const existing = map.layer(layerId(floor.index));
		if (existing) {
			// Hidden levels catch up with a lens change lazily, at the latest when shown.
			syncLens(floor.index);
			return existing;
		}
		floors.set(floor.index, floor);
		styledWith.set(floor.index, styleKey());
		const layer = map.addLayer(layerId(floor.index), floor.map, {
			style: floorStyle(floor, lens),
			visible: false
		});
		// Things that ride with levels may name this one before it existed.
		layer.setTunnelTint(tunnelTint());
		if (lastRoute?.legs.some((l) => l.level === floor.index)) self.setRoute(lastRoute);
		return layer;
	};
	const showOnly = (only: MapLayer | null) => {
		for (const l of map.layers()) l.set({ visible: l === only });
	};

	// ── Level change: slide under a veil ────────────────────────────────────
	interface Transition {
		from: MapLayer | null;
		to: MapLayer;
		dir: number;
		start: number;
	}
	let transition: Transition | null = null;
	let veilLevel = 0;

	/** Advance the level change by wall-clock time, so slow frames can't stretch it. */
	const stepTransition = (now: number) => {
		if (!transition) return;
		const { from, to, dir } = transition;
		const t = now - transition.start;
		const outMs = from ? LEVEL_OUT_MS : 0;
		if (from && t < outMs) {
			// Out: the level you're leaving slides away (up when going deeper) as the veil closes.
			const p = easeIn(t / outMs);
			showOnly(from);
			from.set({ y: dir * LEVEL_SLIDE * p });
			veilLevel = p;
		} else {
			// In: the new level slides into place from the other side as the veil lifts.
			const p = Math.min(1, (t - outMs) / LEVEL_IN_MS);
			const e = easeOut(p);
			showOnly(to);
			from?.set({ y: 0 });
			to.set({ y: -dir * LEVEL_SLIDE * (1 - e) });
			veilLevel = from ? 1 - e : 0;
			if (p >= 1) {
				transition = null;
				veilLevel = 0;
				opts.onTransition?.(false);
			}
		}
		map.setVeil(veilLevel);
	};

	// ── All-levels view: a plain veil dip that swaps the layout while covered ─
	/** Whether the levels are stacked right now (flips when a dip swaps the layout). */
	let overview = false;
	interface Dip {
		/** The layout this dip lands on, applied while the veil is fully closed. */
		stacked: boolean;
		apply: () => void;
		start: number;
		applied: boolean;
	}
	let dip: Dip | null = null;
	/** The layout the scene is in, or is about to swap to under a closing veil. */
	const willStack = () => (dip && !dip.applied ? dip.stacked : overview);
	/** Drop a running level slide, leaving its target level in place. */
	const settleSlide = () => {
		if (!transition) return;
		showOnly(transition.to);
		transition.to.set({ y: 0 });
		transition = null;
	};
	const startDip = (stacked: boolean, apply: () => void) => {
		// Finish any level slide first so the two animations never fight.
		settleSlide();
		// A dip whose veil is still closing just retargets: the newest request wins.
		if (dip && !dip.applied) Object.assign(dip, { stacked, apply });
		else
			dip = {
				stacked,
				apply,
				start: performance.now() - Math.sqrt(veilLevel) * LEVEL_OUT_MS,
				applied: false
			};
		opts.onTransition?.(true);
	};
	const stepDip = (now: number) => {
		if (!dip) return;
		const t = now - dip.start;
		if (t < LEVEL_OUT_MS) veilLevel = easeIn(t / LEVEL_OUT_MS);
		else {
			if (!dip.applied) {
				dip.apply();
				dip.applied = true;
			}
			const p = Math.min(1, (t - LEVEL_OUT_MS) / LEVEL_IN_MS);
			veilLevel = 1 - easeOut(p);
			if (p >= 1) {
				dip = null;
				veilLevel = 0;
				opts.onTransition?.(false);
			}
		}
		map.setVeil(veilLevel);
	};
	const setFar = (far: boolean) => map.setFog(far ? FAR_FOG : NEAR_FOG);

	// ── Shaft columns (all-levels view) ─────────────────────────────────────
	// Shafts are the only places at the same spot on every level. In the stacked view each
	// one is drawn as a single solid column from the bottom level to the top, in the same
	// blocky style and colour as its landings, which are hidden meanwhile.
	let shaftColumns: OverlayHandle[] = [];
	const buildShaftColumns = (crown: Floor) => {
		if (shaftColumns.length) return;
		const bottom = stackY(LEVELS.length - 1);
		const boxes: BoxesOverlay['boxes'] = [];
		const wells: { x: number; y: number; w: number; h: number; z: number; color: string }[] = [];
		SHAFTS.forEach((info, s) => {
			const g = crown.shaftGates[s];
			if (!g) return;
			const { roof, well } = shaftColors(s);
			// The sealed Ascent carries on above the Crown, toward the surface.
			const top = stackY(0) + SHAFT_H + (info.status === 'sealed' ? 8 : 0);
			// Shaded by face like the rooms (see SIDE_SHADE in the map's mesh.ts).
			boxes.push({
				x: g.x,
				y: g.y,
				w: g.w,
				h: g.h,
				z0: bottom,
				z1: top,
				color: roof,
				roof,
				bottom: roof.clone().multiplyScalar(UNDERSIDE_SHADE)
			});
			wells.push({
				x: g.x + 0.7,
				y: g.y + 0.7,
				w: g.w - 1.4,
				h: g.h - 1.4,
				z: top + 0.03,
				color: `#${well.getHexString()}`
			});
		});
		shaftColumns = [
			map.addOverlay({ type: 'boxes', boxes, lit: false, sideShade: SIDE_SHADE, visible: false }),
			map.addOverlay({ type: 'rects', rects: wells, order: 2, visible: false })
		];
	};

	// ── Route ───────────────────────────────────────────────────────────────
	let lastRoute: RouteDraw | null = null;
	let routeParts: OverlayHandle[] = [];
	let rideParts: OverlayHandle[] = [];
	let raisedLayers: MapLayer[] = [];
	/** World-per-pixel the route was last drawn for. */
	let routeScaleAt = 0;
	/** Tiles per CSS pixel at the camera's focus. */
	const worldPerPixel = () => {
		const { camera, renderer } = map.three;
		const h = renderer.domElement.clientHeight || 1;
		const fov = (camera.fov * Math.PI) / 180;
		return (2 * map.camera.view.distance * Math.tan(fov / 2)) / h;
	};
	/** The route's two passes: the white inverted hull, then the cyan shell over it. */
	const shellAndHull = (
		layer: string | null,
		hull: BoxesOverlay['boxes'],
		shell: BoxesOverlay['boxes'],
		merge = true
	) => {
		const base = {
			type: 'boxes',
			layer,
			lit: false,
			merge,
			onTop: true,
			depthWrite: true
		} as const;
		return [
			map.addOverlay({ ...base, boxes: hull, backSide: true, order: ROUTE_ORDER }),
			map.addOverlay({ ...base, boxes: shell, order: ROUTE_ORDER + 1 })
		];
	};
	// Keep the route's on-screen width as the camera zooms.
	map.on('view', () => {
		if (!lastRoute || !routeScaleAt) return;
		const px = worldPerPixel();
		if (Math.abs(px / routeScaleAt - 1) > ROUTE_RESCALE) self.setRoute(lastRoute);
	});

	// ── Highlights ──────────────────────────────────────────────────────────
	const outline = (opacity: number) => {
		let handle: OverlayHandle<OutlineOverlay> | null = null;
		let shown = false;
		let last: Room | null = null;
		return {
			set(r: Room | null) {
				last = r;
				const layer = current && map.layer(layerId(current.index));
				const look = r && layer?.lookOf(r);
				shown = !!look;
				if (!r || !layer || !look) return handle?.setVisible(false);
				const z0 = -layer.sinkOf(r);
				const spec = {
					layer: layer.id,
					x: r.x,
					y: r.y,
					w: r.w,
					h: r.h,
					z0,
					z1: z0 + look.height + 0.1
				};
				if (handle) handle.update({ ...spec, visible: !overview });
				else
					handle = map.addOverlay({
						type: 'outline',
						...spec,
						color: tokenHex('map-highlight'),
						opacity,
						visible: !overview
					});
			},
			sync() {
				handle?.setVisible(shown && !overview);
			},
			/** Rebuild in the current theme colours. */
			repaint() {
				handle?.remove();
				handle = null;
				this.set(last);
			}
		};
	};
	const hover = outline(0.55);
	const selection = outline(1);
	let impact: OverlayHandle | null = null;
	let alertPulse: OverlayHandle | null = null;
	let alertMats: THREE.Material[] = [];
	let levelTints: OverlayHandle[] = [];
	let radar: OverlayHandle | null = null;
	let lastRadar: Parameters<HollowMap['setRadar']>[0] = null;
	let radarRaf = 0;

	// ── Pins ────────────────────────────────────────────────────────────────
	let markers: MarkerHandle[] = [];

	// ── Focus level (all-levels view) ───────────────────────────────────────
	let focusLevel: number | null = null;
	/** Ease every layer towards its target opacity (frame-rate independent). */
	const stepFocus = (dt: number) => {
		const k = 1 - Math.exp(-dt / FOCUS_FADE_MS);
		for (const l of map.layers()) {
			const target =
				!overview || focusLevel === null || levelOf(l.id) === focusLevel ? 1 : FOCUS_DIM;
			if (l.opacity === target) continue;
			const next = l.opacity + (target - l.opacity) * k;
			l.setOpacity(Math.abs(target - next) < 0.01 ? target : next);
		}
	};

	// ── Per frame ───────────────────────────────────────────────────────────
	const off = map.on('frame', (now, dt) => {
		stepFocus(dt);
		stepTransition(now);
		stepDip(now);
		for (const o of rideParts) o.setVisible(overview);
		for (const o of shaftColumns) o.setVisible(overview);
		for (const l of map.layers()) l.setPartVisible(SHAFT_PART, !overview);
		hover.sync();
		selection.sync();
		impact?.setVisible(!overview);
		if (alertPulse) {
			alertPulse.setVisible(!overview && !transition);
			// A slow alarm throb: sharp rise, long fall.
			const k = (now % 1400) / 1400;
			const o = 0.15 + 0.6 * Math.pow(1 - k, 2.2);
			for (const m of alertMats) m.opacity = o;
		}
	});

	const self: HollowMap = {
		map,
		showFloor(floor, dir) {
			const layer = layerFor(floor);
			if (overview || dip?.applied === false) {
				// Leaving the all-levels view: dip, then show just this level. A dip that hasn't
				// swapped the layout yet (into or out of the stack) is retargeted to this level.
				current = floor;
				startDip(false, () => {
					overview = false;
					map.camera.setElevation(0);
					setFar(false);
					showOnly(layer);
					layer.set({ y: 0 });
				});
				return;
			}
			const same = current?.index === floor.index;
			const had = current;
			current = floor;
			if (same && !transition) return;
			// Any dip left is lifting off a single level; the new change takes over its veil.
			const busy = !!(transition || dip);
			dip = null;
			if (dir === 0 || !had) {
				transition = null;
				showOnly(layer);
				layer.set({ y: 0 });
				veilLevel = 0;
				map.setVeil(0);
				if (busy) opts.onTransition?.(false);
				return;
			}
			// Whatever is on screen now is what slides away. Start the "out" phase where the
			// veil currently is, so changing level again mid-change stays smooth.
			const visible = transition
				? veilLevel > 0 && transition.from?.visible
					? transition.from
					: transition.to
				: (map.layers().find((l) => l.visible && l !== layer) ?? null);
			const now = performance.now();
			transition = {
				from: visible && visible !== layer ? visible : null,
				to: layer,
				dir: Math.sign(dir),
				// The out phase eases with t², so invert that to resume at the same veil level.
				start: now - Math.sqrt(veilLevel) * LEVEL_OUT_MS
			};
			transition.from?.set({ y: dir * LEVEL_SLIDE * veilLevel });
			opts.onTransition?.(true);
			stepTransition(now);
		},
		setHover: (r) => hover.set(r),
		setSelection: (r) => selection.set(r),
		setRoute(route) {
			for (const o of [...routeParts, ...rideParts]) o.remove();
			routeParts = [];
			rideParts = [];
			for (const l of raisedLayers) l.raise([]);
			raisedLayers = [];
			lastRoute = route;
			// Dim every level's tunnels while a route is up, so the route stands out.
			for (const l of map.layers()) l.setTunnelTint(tunnelTint());
			if (!route) return;
			const border = tokenHex('map-route-border');
			const core = tokenHex('map-route');
			// Widths in tiles: the tunnel itself up close, a fixed pixel size when far away.
			const px = worldPerPixel();
			routeScaleAt = px;
			const spread = Math.max(0, (ROUTE_MIN_PX * px - 1) / 2);
			const rim = Math.max(ROUTE_BORDER, ROUTE_BORDER_MIN_PX * px);
			const byLevel = new Map<number, Point[][]>();
			for (const leg of route.legs)
				byLevel.set(leg.level, [...(byLevel.get(leg.level) ?? []), leg.path]);
			for (const [level, legPaths] of byLevel) {
				const layer = map.layer(layerId(level));
				if (!layer) continue;
				// Only the tunnel tiles get painted; the door tiles at each end sit inside rooms.
				const { grid, roomAt, rooms } = layer.map;
				// The route is drawn over everything; only the buildings each leg starts and ends
				// at (its door tiles) are drawn again after it, so they alone can cover it.
				const ends = new Set<Room>();
				for (const p of legPaths)
					for (const t of [p[0], p[p.length - 1]]) {
						const r = rooms[roomAt[t.y]?.[t.x] ?? -1];
						if (r) ends.add(r);
					}
				layer.raise([...ends], ROUTE_ORDER + 2);
				raisedLayers.push(layer);
				const paths = legPaths
					.map((p) => p.filter(({ x, y }) => grid[y]?.[x] === 'road'))
					.filter((p) => p.length > 0);
				const tiles = new Map<number, Point>();
				for (const p of paths) for (const t of p) tiles.set(t.y * W + t.x, t);
				// Legs ride with their level's layer. The cyan shell wraps the route's tunnel
				// blocks a hair larger than the tunnel so it covers the tunnel's own faces. It is
				// unlit with a cyan underside, so no face is shaded darker. The white border is
				// an inverted hull: the same blocks grown on every side, drawn back faces only,
				// so the white shows only where it sticks out past the cyan silhouette (drawn in
				// order rather than by depth, since the route ignores depth). Each tile
				// only grows on its open sides and faces between tiles are merged away, so the
				// hull is one solid with no inner walls poking up through the cyan roof.
				// When zoomed out, both grow sideways past the tunnel by `spread`.
				const has = (x: number, y: number) => tiles.has(y * W + x);
				const grow = (side: number, by: number, color: string, open = false) =>
					[...tiles.values()].map((t) => {
						const o = (dx: number, dy: number) => (open && has(t.x + dx, t.y + dy) ? 0 : side + by);
						return {
							x: t.x - o(-1, 0),
							y: t.y - o(0, -1),
							w: 1 + o(-1, 0) + o(1, 0),
							h: 1 + o(0, -1) + o(0, 1),
							z0: -by,
							z1: ROUTE_Y + by,
							color,
							roof: color,
							bottom: color
						};
					});
				routeParts.push(
					...shellAndHull(layer.id, grow(spread, rim, border, true), grow(spread, ROUTE_PAD, core))
				);
			}
			// Shaft rides: vertical bars between levels, only shown when the levels are stacked.
			// Same look as the legs: a cyan bar as wide as the route, outlined in white.
			for (const r of route.rides) {
				const top = stackY(Math.min(r.from, r.to)) + ROUTE_Y;
				const bottom = stackY(Math.max(r.from, r.to)) + ROUTE_Y;
				const bar = (half: number, color: string) => [
					{
						x: r.x - half,
						y: r.y - half,
						w: half * 2,
						h: half * 2,
						z0: bottom - (half - 0.5),
						z1: top + (half - 0.5),
						color,
						roof: color,
						bottom: color
					}
				];
				const half = 0.5 + spread;
				rideParts.push(...shellAndHull(null, bar(half + rim, border), bar(half, core)));
				// The legs stop at the tile outside the landing's door, but the bar stands at the
				// shaft's centre. In this view the landings give way to the shaft columns, so
				// bridge the gap on both end levels: tunnel tile → door → shaft centre.
				for (const level of [r.from, r.to]) {
					const layer = map.layer(layerId(level));
					const gate = layer?.map.rooms[layer.map.roomAt[Math.floor(r.y)]?.[Math.floor(r.x)] ?? -1];
					if (!layer || !gate) continue;
					const a = { x: gate.access.x + 0.5, y: gate.access.y + 0.5 };
					const d = { x: gate.door.x + 0.5, y: gate.door.y + 0.5 };
					// Turn where the door's line meets the centre's cross line, then go sideways.
					const alongX = gate.access.y === gate.door.y;
					const turn = alongX ? { x: r.x, y: d.y } : { x: d.x, y: r.y };
					const pts = [a, d, turn, { x: r.x, y: r.y }];
					const link = (hw: number, by: number, color: string) =>
						pts.slice(1).map((q, i) => {
							const p = pts[i];
							const x0 = Math.min(p.x, q.x) - hw;
							const y0 = Math.min(p.y, q.y) - hw;
							return {
								x: x0,
								y: y0,
								w: Math.max(p.x, q.x) + hw - x0,
								h: Math.max(p.y, q.y) + hw - y0,
								z0: -by,
								z1: ROUTE_Y + by,
								color,
								roof: color,
								bottom: color
							};
						});
					rideParts.push(
						...shellAndHull(
							layer.id,
							link(half + rim, rim, border),
							link(half, ROUTE_PAD, core),
							false
						)
					);
				}
			}
		},
		setOverview(on, floors) {
			// Compare against where the scene is headed, not where it is: a second request
			// during the dip must undo the first, not be dropped.
			if (on === willStack()) return;
			if (!on) {
				if (current) self.showFloor(current, 0);
				return;
			}
			// Build every level now, before the dip starts, so the swap can't stall.
			const layers = floors.map((f) => layerFor(f));
			startDip(true, () => {
				overview = true;
				map.camera.setElevation(STACK_MID);
				setFar(true);
				for (const l of layers) l.set({ visible: true, y: stackY(levelOf(l.id)) });
				const crown = floors.find((f) => f.index === 0);
				if (crown && floors.length === LEVELS.length) buildShaftColumns(crown);
				self.frameStack();
			});
		},
		setFocusLevel(level) {
			focusLevel = level;
		},
		frameStack() {
			// Pulled back and lifted a touch so the top levels clear the search/directions panel.
			map.camera.flyTo({
				x: W / 2,
				y: H / 2,
				distance: opts.stackDistance ?? MAX_DISTANCE,
				heading: { x: -0.55, y: -0.72 },
				tilt: Math.asin(0.42 / Math.hypot(0.55, 0.42, 0.72))
			});
		},
		setPins(pins) {
			for (const m of markers) m.remove();
			markers = pins.map((p) =>
				map.addMarker({
					el: p.el,
					x: p.x,
					y: p.y,
					z: p.h ?? 1,
					layer: layerId(p.level ?? current?.index ?? 0)
				})
			);
		},
		refreshLens() {
			dataVersion++;
			restyleAll();
		},
		setLens(next) {
			if (next === lens) return;
			lens = next;
			restyleAll();
		},
		preload(floor) {
			layerFor(floor);
			// With every level in, the all-levels view's shaft columns can be built ahead too.
			const crown = floors.get(0);
			if (crown && floors.size === LEVELS.length) buildShaftColumns(crown);
		},
		setImpact(rooms) {
			impact?.remove();
			impact = null;
			const layer = current && map.layer(layerId(current.index));
			if (!rooms.length || !layer) return;
			impact = map.addOverlay({
				type: 'rects',
				layer: layer.id,
				rects: rooms.map(({ room: r, color }) => ({
					x: r.x,
					y: r.y,
					w: r.w,
					h: r.h,
					z: layer.heightOf(r) + 0.06,
					color
				})),
				opacity: 0.7,
				visible: !overview
			});
		},
		setAlertPulse(rooms) {
			alertPulse?.remove();
			alertPulse = null;
			alertMats = [];
			const layer = current && map.layer(layerId(current.index));
			if (!rooms.length || !layer) return;
			alertPulse = map.addOverlay({
				type: 'rects',
				layer: layer.id,
				rects: rooms.map(({ room: r, color }) => ({
					x: r.x - 0.15,
					y: r.y - 0.15,
					w: r.w + 0.3,
					h: r.h + 0.3,
					z: layer.heightOf(r) + 0.08,
					color
				})),
				opacity: 0.6,
				visible: !overview
			});
			alertPulse.object.traverse((o) => {
				const m = (o as THREE.Mesh).material;
				if (m) alertMats.push(...(Array.isArray(m) ? m : [m]));
			});
			for (const m of alertMats) m.transparent = true;
		},
		setLevelTints(tints) {
			for (const t of levelTints) t.remove();
			levelTints = [];
			for (const t of tints) {
				const layer = map.layer(layerId(t.level));
				if (!layer) continue;
				levelTints.push(
					map.addOverlay({
						type: 'rects',
						layer: layer.id,
						rects: layer.map.rooms
							.filter((r) => r.kind === 'room')
							.map((r) => ({
								x: r.x,
								y: r.y,
								w: r.w,
								h: r.h,
								z: layer.heightOf(r) + 0.06,
								color: t.color
							})),
						opacity: t.opacity ?? 0.75,
						visible: true
					})
				);
			}
		},
		flyTo: (x, y, o = {}) => map.camera.flyTo({ x, y, ...o }),
		fitBounds: (minX, minY, maxX, maxY) =>
			map.camera.fitBounds(minX, minY, maxX, maxY, { maxDistance: MAX_DISTANCE }),
		zoomBy: (f) => map.camera.zoomBy(f),
		resetNorth: () => map.camera.resetNorth(),
		setPan: (x, y) => map.camera.setPan(x, y),
		setRadar(r) {
			lastRadar = r;
			cancelAnimationFrame(radarRaf);
			radar?.remove();
			radar = null;
			if (!r) return;
			const layer = map.layer(layerId(r.level));
			if (!layer) return;
			const R = r.radius;
			const color = new THREE.Color(r.color ?? tokenHex('map-radar'));
			const mat = (opacity: number) =>
				new THREE.MeshBasicMaterial({
					color,
					transparent: true,
					opacity,
					side: THREE.DoubleSide,
					depthWrite: false,
					depthTest: false
				});
			const flat = (geo: THREE.BufferGeometry, opacity: number, order: number) => {
				const m = new THREE.Mesh(geo, mat(opacity));
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
			// Sweep: a fading wedge, built from slices so the trailing edge fades out.
			const sweep = new THREE.Group();
			const SLICES = 14;
			const WEDGE = Math.PI * 0.4;
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

			radar = map.addOverlay({ type: 'object', layer: layer.id, object: root });
			const t0 = performance.now();
			const PERIOD = 2400;
			const tick = (t: number) => {
				const k = ((t - t0) % PERIOD) / PERIOD;
				sweep.rotation.y = -((t - t0) / PERIOD) * Math.PI * 2;
				ping.scale.setScalar(Math.max(0.01, R * k));
				(ping.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
				radarRaf = requestAnimationFrame(tick);
			};
			radarRaf = requestAnimationFrame(tick);
		},
		dispose() {
			off();
			offTheme();
			cancelAnimationFrame(radarRaf);
			map.dispose();
		}
	};

	/**
	 * Bring every level up to the current lens and theme: whatever is on screen restyles now;
	 * hidden levels follow one per idle slot (or right away if they are shown first), so a
	 * change never rebuilds all levels at once.
	 */
	function restyleAll() {
		const key = styleKey();
		for (const l of map.layers().filter((l) => l.visible)) syncLens(levelOf(l.id));
		const rest = [...floors.keys()].filter((i) => styledWith.get(i) !== key);
		const step = () => {
			const i = rest.shift();
			if (i === undefined || styleKey() !== key) return;
			syncLens(i);
			idle(step);
		};
		idle(step);
		// Outlines and raised rooms were sized from the old looks.
		if (lastRoute) self.setRoute(lastRoute);
	}

	const offTheme = onThemeChange(() => {
		themeVersion++;
		map.setBackground(tokenHex('map-background'));
		map.setLight({ sky: tokenHex('map-light-sky'), ground: tokenHex('map-light-ground') });
		for (const l of map.layers()) l.setTunnelTint(tunnelTint());
		hover.repaint();
		selection.repaint();
		if (lastRadar && !lastRadar.color) self.setRadar(lastRadar);
		restyleAll();
	});
	return self;
}
