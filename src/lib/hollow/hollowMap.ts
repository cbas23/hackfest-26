/**
 * The Hollow's map: the generic tunnel-map renderer (`#lib/map`) dressed with Hollow
 * floors, plus the navigation visuals the Main Map needs: level changes, the all-levels
 * stack, hover/selection outlines, impact tint, alert pulse, pins and data lenses.
 *
 * The pieces live in `./scene/`. Extra visuals are add-ons that attach on first use, so
 * the core stays small: `routeOverlay`, `radarOverlay` and `levelTintOverlay` (see
 * `./scene/route.ts` etc.). Reach for `hollowMap.map` for anything else.
 */
import type * as THREE from 'three';
import type { Room, Point } from '#lib/tunnels/generate.js';
import {
	createMap,
	type MapLayer,
	type MarkerHandle,
	type OverlayHandle,
	type TunnelMapView
} from '#lib/map/index.js';
import { LEVELS } from './data.js';
import { floorStyle, type MapLens, SHAFT_PART } from './mapStyle.js';
import { cssHex, onThemeChange, tokenHex } from './theme.js';
import type { Floor } from './world.js';
import {
	H,
	layerId,
	levelOf,
	signal,
	STACK_MID,
	stackY,
	W,
	type HollowMapHooks,
	type Pick
} from './scene/common.js';
import { createOutline } from './scene/outline.js';
import { buildShaftColumns } from './scene/shaftColumns.js';
import { createStackPicker } from './scene/stackPick.js';
import { createTransitions } from './scene/transitions.js';

export { layerId, type HollowMapHooks, type Pick };

/** Furthest the camera may pull back; scaled to the 500×400 floors. */
const MAX_DISTANCE = 1040;
const NEAR_FOG = { near: 520, far: 1440 };
const FAR_FOG = { near: 1040, far: 3000 };
/** Opacity of the other levels while one is focused in the all-levels view. */
const FOCUS_DIM = 0.1;
/** Time constant of the focus fade, in ms. */
const FOCUS_FADE_MS = 60;

/** Run when the page is idle (soon, at the latest). */
const idle = (fn: () => void) =>
	typeof requestIdleCallback === 'function'
		? requestIdleCallback(fn, { timeout: 500 })
		: setTimeout(fn, 30);

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
	/** For add-ons (see `./scene/common.ts`). */
	readonly hooks: HollowMapHooks;
	/** Show one floor; `dir` > 0 arrives from above (going deeper), < 0 from below. */
	showFloor(floor: Floor, dir: number): void;
	setHover(room: Room | null): void;
	setSelection(room: Room | null): void;
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
	/** Repaint every level with a data lens (e.g. sickness), or back to the normal look. */
	setLens(lens: MapLens | null): void;
	/** Tint rooms on the shown floor (impact assessment) in any CSS colour; [] clears it. */
	setImpact(rooms: { room: Room; color: string }[]): void;
	/** Rooms on the shown floor that throb in a CSS colour (alerts); [] clears it. */
	setAlertPulse(rooms: { room: Room; color: string }[]): void;
	flyTo(x: number, y: number, opts?: { distance?: number; heading?: Point; tilt?: number }): void;
	fitBounds(minX: number, minY: number, maxX: number, maxY: number): void;
	zoomBy(factor: number): void;
	resetNorth(): void;
	setPan(x: number, y: number): void;
	dispose(): void;
}

export function createHollowMap(container: HTMLElement, opts: HollowMapOptions): HollowMap {
	// Every colour comes from the CSS variables (see theme.ts), so the scene matches the UI
	// around it and repaints when the theme changes.
	const map = createMap(container, {
		background: tokenHex('map-background'),
		light: { sky: tokenHex('map-light-sky'), ground: tokenHex('map-light-ground') },
		origin: { x: W / 2, y: H / 2 },
		fog: NEAR_FOG,
		camera: { maxDistance: Math.max(MAX_DISTANCE, opts.stackDistance ?? 0) }
	});

	const events = {
		layer: signal<[number]>(),
		restyle: signal(),
		theme: signal(),
		dispose: signal()
	};

	/** The level shown (or about to be) when the levels aren't stacked. */
	let current: Floor | null = null;
	/** Whether the levels are stacked right now (flips when a dip swaps the layout). */
	let overview = false;
	const floors = new Map<number, Floor>();
	const currentLayer = () => current && map.layer(layerId(current.index));
	const isStacked = () => overview;

	// ── Picking ─────────────────────────────────────────────────────────────
	// In the all-levels view a pick names a level, not a room (see stackPick.ts).
	const stackPick = createStackPicker(map, container, floors);
	const toPick = (p: { layer: string; tile: Point; room: Room | null } | null): Pick | null =>
		p && { tile: p.tile, room: p.room, level: levelOf(p.layer) };
	map.on('hover', (p, e) => opts.onHover(overview ? (e ? stackPick(e) : null) : toPick(p)));
	map.on('click', (p, e) => opts.onClick(overview ? stackPick(e) : toPick(p)));
	if (opts.onView) map.on('view', opts.onView);

	// ── Floors and their styles ─────────────────────────────────────────────
	let lens: MapLens | null = null;
	/** Set by add-ons (the route) that want the tunnels dimmed for contrast. */
	let tunnelDim = false;
	// A lens already draws its tunnels near-black (see floorStyle), so it needs no tint.
	const tunnelTint = () => (!lens && tunnelDim ? tokenHex('map-route-dim') : null);
	/** Bumped on every theme change, so each layer knows its colours are stale. */
	let themeVersion = 0;
	const styleKey = () => `${lens}@${themeVersion}`;
	/** The lens and theme each layer was last styled with. */
	const styledWith = new Map<number, string>();
	/** Restyle a layer if the lens or theme changed since it was built. */
	const syncStyle = (index: number) => {
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
			syncStyle(floor.index);
			return existing;
		}
		floors.set(floor.index, floor);
		styledWith.set(floor.index, styleKey());
		const layer = map.addLayer(layerId(floor.index), floor.map, {
			style: floorStyle(floor, lens),
			visible: false
		});
		layer.setTunnelTint(tunnelTint());
		// Things that ride with levels may name this one before it existed.
		events.layer.emit(floor.index);
		return layer;
	};

	/**
	 * Bring every level up to the current lens and theme: whatever is on screen restyles now;
	 * hidden levels follow one per idle slot (or right away if they are shown first), so a
	 * change never rebuilds all levels at once.
	 */
	const restyleAll = () => {
		const key = styleKey();
		for (const l of map.layers().filter((l) => l.visible)) syncStyle(levelOf(l.id));
		const rest = [...floors.keys()].filter((i) => styledWith.get(i) !== key);
		const step = () => {
			const i = rest.shift();
			if (i === undefined || styleKey() !== key) return;
			syncStyle(i);
			idle(step);
		};
		idle(step);
		events.restyle.emit();
	};

	// ── Views ───────────────────────────────────────────────────────────────
	const fx = createTransitions(map, (active) => opts.onTransition?.(active));
	const setFar = (far: boolean) => map.setFog(far ? FAR_FOG : NEAR_FOG);

	let shaftColumns: OverlayHandle[] = [];
	const ensureShaftColumns = () => {
		const crown = floors.get(0);
		if (shaftColumns.length || !crown || floors.size !== LEVELS.length) return;
		shaftColumns = buildShaftColumns(map, crown);
	};

	// ── Highlights ──────────────────────────────────────────────────────────
	const hover = createOutline(map, 0.55, { layer: currentLayer, isStacked });
	const selection = createOutline(map, 1, { layer: currentLayer, isStacked });
	let impact: OverlayHandle | null = null;
	let lastImpact: { room: Room; color: string }[] = [];
	let alertPulse: OverlayHandle | null = null;
	let alertMats: THREE.Material[] = [];
	let lastAlertPulse: { room: Room; color: string }[] = [];
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
	map.on('frame', (now, dt) => {
		stepFocus(dt);
		fx.step(now);
		for (const o of shaftColumns) o.setVisible(overview);
		for (const l of map.layers()) l.setPartVisible(SHAFT_PART, !overview);
		hover.sync();
		selection.sync();
		impact?.setVisible(!overview);
		if (alertPulse) {
			alertPulse.setVisible(!overview && !fx.sliding);
			// A slow alarm throb: sharp rise, long fall.
			const k = (now % 1400) / 1400;
			const o = 0.15 + 0.6 * Math.pow(1 - k, 2.2);
			for (const m of alertMats) m.opacity = o;
		}
	});

	const hooks: HollowMapHooks = {
		map,
		isStacked,
		setTunnelDim(on) {
			tunnelDim = on;
			for (const l of map.layers()) l.setTunnelTint(tunnelTint());
		},
		onLayer: events.layer.on,
		onRestyle: events.restyle.on,
		onTheme: events.theme.on,
		onDispose: events.dispose.on
	};

	const self: HollowMap = {
		map,
		hooks,
		showFloor(floor, dir) {
			const layer = layerFor(floor);
			if (overview || fx.pendingLayout() !== null) {
				// Leaving the all-levels view: dip, then show just this level. A dip that hasn't
				// swapped the layout yet (into or out of the stack) is retargeted to this level.
				current = floor;
				fx.dip(false, () => {
					overview = false;
					map.camera.setElevation(0);
					setFar(false);
					fx.showOnly(layer);
					layer.set({ y: 0 });
				});
				return;
			}
			const same = current?.index === floor.index;
			const had = current;
			current = floor;
			if (same && !fx.sliding) return;
			if (dir === 0 || !had) fx.jump(layer);
			else fx.slide(layer, dir);
		},
		setHover: (r) => hover.set(r),
		setSelection: (r) => selection.set(r),
		setOverview(on, all) {
			// Compare against where the scene is headed, not where it is: a second request
			// during the dip must undo the first, not be dropped.
			if (on === (fx.pendingLayout() ?? overview)) return;
			if (!on) {
				if (current) self.showFloor(current, 0);
				return;
			}
			// Build every level now, before the dip starts, so the swap can't stall.
			const layers = all.map((f) => layerFor(f));
			fx.dip(true, () => {
				overview = true;
				map.camera.setElevation(STACK_MID);
				setFar(true);
				for (const l of layers) l.set({ visible: true, y: stackY(levelOf(l.id)) });
				ensureShaftColumns();
				self.frameStack();
			});
		},
		setFocusLevel(level) {
			focusLevel = level;
		},
		frameStack() {
			// Pulled back and lifted a touch so the top levels clear the panels over the map.
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
		setLens(next) {
			if (next === lens) return;
			lens = next;
			restyleAll();
		},
		setImpact(rooms) {
			lastImpact = rooms;
			impact?.remove();
			impact = null;
			const layer = currentLayer();
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
					color: cssHex(color)
				})),
				opacity: 0.7,
				visible: !overview
			});
		},
		setAlertPulse(rooms) {
			lastAlertPulse = rooms;
			alertPulse?.remove();
			alertPulse = null;
			alertMats = [];
			const layer = currentLayer();
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
					color: cssHex(color)
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
		flyTo: (x, y, o = {}) => map.camera.flyTo({ x, y, ...o }),
		fitBounds: (minX, minY, maxX, maxY) =>
			map.camera.fitBounds(minX, minY, maxX, maxY, { maxDistance: MAX_DISTANCE }),
		zoomBy: (f) => map.camera.zoomBy(f),
		resetNorth: () => map.camera.resetNorth(),
		setPan: (x, y) => map.camera.setPan(x, y),
		dispose() {
			offTheme();
			events.dispose.emit();
			map.dispose();
		}
	};

	const offTheme = onThemeChange(() => {
		themeVersion++;
		map.setBackground(tokenHex('map-background'));
		map.setLight({ sky: tokenHex('map-light-sky'), ground: tokenHex('map-light-ground') });
		for (const l of map.layers()) l.setTunnelTint(tunnelTint());
		hover.repaint();
		selection.repaint();
		self.setImpact(lastImpact);
		self.setAlertPulse(lastAlertPulse);
		if (shaftColumns.length) {
			for (const o of shaftColumns) o.remove();
			shaftColumns = [];
			ensureShaftColumns();
		}
		restyleAll();
		events.theme.emit();
	});
	return self;
}
