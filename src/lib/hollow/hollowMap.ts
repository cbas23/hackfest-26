/**
 * The Hollow's map: the generic tunnel-map renderer (`#lib/map`) dressed with Hollow
 * floors, plus the navigation visuals the app needs (level changes, the all-levels stack,
 * route, impact tint, outlines, pins). Everything here is built from the library's
 * public primitives; reach for `hollowMap.map` to add your own.
 */
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
import { FLOOR_CONFIG, LEVELS, SHAFTS } from './data.js';
import { floorStyle, SHAFT_H, SHAFT_PART, shaftColors, TUNNEL_H } from './mapStyle.js';
import type { Floor } from './world.js';

const W = FLOOR_CONFIG.width;
const H = FLOOR_CONFIG.height;
const BACKGROUND = '#121726';
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
	setPins(pins: Pin[]): void;
	/** Tint rooms on the shown floor (impact assessment); an empty list clears it. */
	setImpact(rooms: { room: Room; color: string }[]): void;
	flyTo(x: number, y: number, opts?: { distance?: number; heading?: Point; tilt?: number }): void;
	fitBounds(minX: number, minY: number, maxX: number, maxY: number): void;
	zoomBy(factor: number): void;
	resetNorth(): void;
	setPan(x: number, y: number): void;
	dispose(): void;
}

const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export function createHollowMap(container: HTMLElement, opts: HollowMapOptions): HollowMap {
	const map = createMap(container, {
		background: BACKGROUND,
		origin: { x: W / 2, y: H / 2 },
		fog: NEAR_FOG,
		camera: { maxDistance: MAX_DISTANCE }
	});

	const toPick = (p: { layer: string; tile: Point; room: Room | null } | null): Pick | null =>
		p && { tile: p.tile, room: p.room, level: levelOf(p.layer) };
	map.on('hover', (p) => opts.onHover(toPick(p)));
	map.on('click', (p) => opts.onClick(toPick(p)));
	if (opts.onView) map.on('view', opts.onView);

	// ── Floors ──────────────────────────────────────────────────────────────
	let current: Floor | null = null;
	const layerFor = (floor: Floor): MapLayer => {
		const existing = map.layer(layerId(floor.index));
		if (existing) return existing;
		const layer = map.addLayer(layerId(floor.index), floor.map, {
			style: floorStyle(floor),
			visible: false
		});
		// Things that ride with levels may name this one before it existed.
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
	let overview = false;
	let dip: { apply: () => void; start: number; applied: boolean } | null = null;
	const startDip = (apply: () => void) => {
		// Finish any level slide first so the two animations never fight.
		if (transition) {
			showOnly(transition.to);
			transition.to.set({ y: 0 });
			transition = null;
		}
		if (dip && !dip.applied) dip.apply = apply;
		else
			dip = {
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
			const { wall, roof, well } = shaftColors(s);
			// The sealed Ascent carries on above the Crown, toward the surface.
			const top = stackY(0) + SHAFT_H + (info.status === 'sealed' ? 8 : 0);
			boxes.push({ x: g.x, y: g.y, w: g.w, h: g.h, z0: bottom, z1: top, color: wall, roof });
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
			map.addOverlay({ type: 'boxes', boxes, blocky: true, seed: 7919, visible: false }),
			map.addOverlay({ type: 'rects', rects: wells, order: 2, visible: false })
		];
	};

	// ── Route ───────────────────────────────────────────────────────────────
	let lastRoute: RouteDraw | null = null;
	let routeParts: OverlayHandle[] = [];
	let rideParts: OverlayHandle[] = [];

	// ── Highlights ──────────────────────────────────────────────────────────
	const outline = (color: string, opacity: number) => {
		let handle: OverlayHandle<OutlineOverlay> | null = null;
		let shown = false;
		return {
			set(r: Room | null) {
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
						color,
						opacity,
						visible: !overview
					});
			},
			sync() {
				handle?.setVisible(shown && !overview);
			}
		};
	};
	const hover = outline('#e2e8f0', 0.55);
	const selection = outline('#ffffff', 1);
	let impact: OverlayHandle | null = null;

	// ── Pins ────────────────────────────────────────────────────────────────
	let markers: MarkerHandle[] = [];

	// ── Per frame ───────────────────────────────────────────────────────────
	const off = map.on('frame', (now) => {
		stepTransition(now);
		stepDip(now);
		for (const o of rideParts) o.setVisible(overview);
		for (const o of shaftColumns) o.setVisible(overview);
		for (const l of map.layers()) l.setPartVisible(SHAFT_PART, !overview);
		hover.sync();
		selection.sync();
		impact?.setVisible(!overview);
	});

	const self: HollowMap = {
		map,
		showFloor(floor, dir) {
			const layer = layerFor(floor);
			if (overview) {
				// Leaving the all-levels view: dip, then show just this level.
				current = floor;
				startDip(() => {
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
			if (dir === 0 || !had) {
				transition = null;
				showOnly(layer);
				layer.set({ y: 0 });
				veilLevel = 0;
				map.setVeil(0);
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
			lastRoute = route;
			if (!route) return;
			const casing = '#1667c9';
			const core = '#38d8f2';
			const byLevel = new Map<number, Point[][]>();
			for (const leg of route.legs)
				byLevel.set(leg.level, [...(byLevel.get(leg.level) ?? []), leg.path]);
			for (const [level, paths] of byLevel) {
				const layer = map.layer(layerId(level));
				if (!layer) continue;
				const base = { type: 'path', layer: layer.id, paths } as const;
				// The see-through pass keeps the line readable past buildings; the solid passes
				// sit on the tunnel tops. Legs ride with their level's layer.
				routeParts.push(
					map.addOverlay({
						...base,
						width: 0.5,
						z: ROUTE_Y + 0.05,
						color: core,
						opacity: 0.8,
						onTop: true,
						order: 9
					}),
					map.addOverlay({ ...base, width: 0.86, z: ROUTE_Y + 0.07, color: casing, order: 6 }),
					map.addOverlay({ ...base, width: 0.56, z: ROUTE_Y + 0.09, color: core, order: 7 })
				);
			}
			// Shaft rides: vertical bars between levels, only shown when the levels are stacked.
			for (const r of route.rides) {
				const top = stackY(Math.min(r.from, r.to)) + ROUTE_Y;
				const bottom = stackY(Math.max(r.from, r.to)) + ROUTE_Y;
				rideParts.push(
					map.addOverlay({
						type: 'boxes',
						boxes: [
							{ x: r.x - 0.35, y: r.y - 0.35, w: 0.7, h: 0.7, z0: bottom, z1: top, color: core }
						],
						lit: false,
						opacity: 0.85,
						onTop: true,
						order: 9,
						visible: overview
					})
				);
			}
		},
		setOverview(on, floors) {
			if (on === overview && !dip) return;
			if (!on) {
				if (current) self.showFloor(current, 0);
				return;
			}
			// Build every level now, before the dip starts, so the swap can't stall.
			const layers = floors.map((f) => layerFor(f));
			startDip(() => {
				overview = true;
				map.camera.setElevation(STACK_MID);
				setFar(true);
				for (const l of layers) l.set({ visible: true, y: stackY(levelOf(l.id)) });
				const crown = floors.find((f) => f.index === 0);
				if (crown && floors.length === LEVELS.length) buildShaftColumns(crown);
				// Pulled back and lifted a touch so the top levels clear the search/directions panel.
				map.camera.flyTo({
					x: W / 2,
					y: H / 2,
					distance: MAX_DISTANCE,
					heading: { x: -0.55, y: -0.72 },
					tilt: Math.asin(0.42 / Math.hypot(0.55, 0.42, 0.72))
				});
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
		flyTo: (x, y, o = {}) => map.camera.flyTo({ x, y, ...o }),
		fitBounds: (minX, minY, maxX, maxY) =>
			map.camera.fitBounds(minX, minY, maxX, maxY, { maxDistance: MAX_DISTANCE }),
		zoomBy: (f) => map.camera.zoomBy(f),
		resetNorth: () => map.camera.resetNorth(),
		setPan: (x, y) => map.camera.setPan(x, y),
		dispose() {
			off();
			map.dispose();
		}
	};
	return self;
}
