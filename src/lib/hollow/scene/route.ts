/**
 * Route add-on: a walking route drawn over the tunnels, with shaft rides as bars between
 * the stacked levels. `routeOverlay(hollowMap).set(route)` draws it; null clears it.
 *
 * The route is a solid tube with a square cross-section, outlined in white, running along
 * the centre of its tunnel tiles. The tube is the same size along the whole route: one tunnel
 * tile (1×1) up close, growing as the camera zooms out so it never shrinks below a readable
 * on-screen size, and redrawing as the zoom changes. While directions are open, every
 * level's tunnels are tinted so it stands out.
 */
import type { BoxesOverlay, MapLayer, OverlayHandle } from '#lib/map/index.js';
import type { Point, Room } from '#lib/tunnels/generate.js';
import { TUNNEL_H } from '../mapStyle.js';
import { tokenHex } from '../theme.js';
import { addOn, layerId, stackY, W, type HollowMapHooks } from './common.js';

/** A route as the map draws it: walking legs per level, joined by shaft rides. */
export interface RouteDraw {
	legs: { level: number; path: Point[] }[];
	/** Shaft rides, at the landing's tile, between two levels. */
	rides: { x: number; y: number; from: number; to: number }[];
}

/** The top of the tube: flush with the tunnel tops, a hair above them. */
const TOP = TUNNEL_H + 0.02;
/** Smallest on-screen size of the tube and of its white border, in CSS pixels. */
const ROUTE_PX = 7;
const BORDER_PX = 2;
/** Thinnest border, in tiles (up close, where pixels are small). */
const BORDER = 0.2;
/** Redraw when the zoom drifts by more than this fraction. */
const RESCALE = 0.1;
/**
 * Render order of the route. It ignores depth (nothing covers it), with the white hull
 * first and the cyan shell over it, so the white only shows outside the cyan silhouette.
 * It still writes depth, so the raised end buildings drawn after it can cover it.
 */
const ORDER = 5;

type Box = BoxesOverlay['boxes'][number];
const box = (b: Omit<Box, 'roof' | 'bottom'>): Box => ({ ...b, roof: b.color, bottom: b.color });

/** Teardowns of every route made by this copy of the module. */
const live = new Set<() => void>();

function createRoute(hooks: HollowMapHooks) {
	const { map } = hooks;
	let last: RouteDraw | null = null;
	let legParts: OverlayHandle[] = [];
	let rideParts: OverlayHandle[] = [];
	let raised: MapLayer[] = [];
	/** Camera distance the route was last drawn for (0 before the camera's first frame). */
	let drawnAt = 0;

	/** Tiles per CSS pixel at the camera's focus. */
	const tilesPerPixel = () => {
		const { camera, renderer } = map.three;
		const h = renderer.domElement.clientHeight || 1;
		const fov = (camera.fov * Math.PI) / 180;
		return (2 * map.camera.view.distance * Math.tan(fov / 2)) / h;
	};

	/**
	 * The route's two passes: the white border, then the orange tube over it. The border is
	 * an inverted hull: the tube grown on every side, drawn back faces only, so the white
	 * shows only where it sticks out past the tube's silhouette.
	 */
	const shellAndHull = (layer: string | null, hull: Box[], shell: Box[], merge = true) => {
		const base = {
			type: 'boxes',
			layer,
			lit: false,
			merge,
			onTop: true,
			depthWrite: true,
			// Zoomed out, the fog would wash the route into the background, border and all.
			fog: false
		} as const;
		return [
			map.addOverlay({ ...base, boxes: hull, backSide: true, order: ORDER }),
			map.addOverlay({ ...base, boxes: shell, order: ORDER + 1 })
		];
	};

	function clear() {
		for (const o of [...legParts, ...rideParts]) o.remove();
		legParts = [];
		rideParts = [];
		for (const l of raised) l.raise([]);
		raised = [];
	}

	function draw(route: RouteDraw) {
		const border = tokenHex('map-route-border');
		const core = tokenHex('map-route');
		drawnAt = map.camera.view.distance;
		// One size for the whole route: a tile up close, a fixed on-screen size when far.
		const px = tilesPerPixel();
		const half = Math.max(0.5, (ROUTE_PX * px) / 2);
		const rim = Math.max(BORDER, BORDER_PX * px);
		/** The tube's height range, grown by `by` (the border) above and below. */
		const zs = (by: number) => ({ z0: TOP - 2 * half - by, z1: TOP + by });
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
			layer.raise([...ends], ORDER + 2);
			raised.push(layer);
			const tiles = new Map<number, Point>();
			for (const p of legPaths)
				for (const t of p) if (grid[t.y]?.[t.x] === 'road') tiles.set(t.y * W + t.x, t);
			// Legs ride with their level's layer. Each tile is a cube at its centre plus an arm
			// to each neighbouring route tile, so the tube follows the path's centre line and
			// turns cleanly. The hull is drawn in order rather than by depth, since the route
			// ignores depth; faces where boxes touch are merged away, so neither has inner walls.
			const has = (x: number, y: number) => tiles.has(y * W + x);
			const tube = (border: boolean, color: string) =>
				[...tiles.values()].flatMap((t) => {
					const h = border ? half + rim : half;
					const cx = t.x + 0.5;
					const cy = t.y + 0.5;
					const z = { ...zs(border ? rim : 0), color };
					const out = [box({ x: cx - h, y: cy - h, w: 2 * h, h: 2 * h, ...z })];
					// Arms reach the shared tile edge, or past it when the tube is wider than a
					// tile, so neighbours always overlap.
					const reach = Math.max(0.5, h);
					if (has(t.x - 1, t.y))
						out.push(box({ x: cx - reach, y: cy - h, w: reach, h: 2 * h, ...z }));
					if (has(t.x + 1, t.y)) out.push(box({ x: cx, y: cy - h, w: reach, h: 2 * h, ...z }));
					if (has(t.x, t.y - 1))
						out.push(box({ x: cx - h, y: cy - reach, w: 2 * h, h: reach, ...z }));
					if (has(t.x, t.y + 1)) out.push(box({ x: cx - h, y: cy, w: 2 * h, h: reach, ...z }));
					return out;
				});
			legParts.push(...shellAndHull(layer.id, tube(true, border), tube(false, core)));
		}

		// Shaft rides: vertical bars between levels, only shown when the levels are stacked.
		// Same tube as the legs, standing upright, outlined in white.
		for (const r of route.rides) {
			const top = stackY(Math.min(r.from, r.to));
			const bottom = stackY(Math.max(r.from, r.to));
			const bar = (by: number, color: string) => [
				box({
					x: r.x - half - by,
					y: r.y - half - by,
					w: 2 * (half + by),
					h: 2 * (half + by),
					z0: bottom + zs(by).z0,
					z1: top + zs(by).z1,
					color
				})
			];
			rideParts.push(...shellAndHull(null, bar(rim, border), bar(0, core)));
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
				const link = (by: number, color: string) =>
					pts.slice(1).map((q, i) => {
						const p = pts[i];
						const hw = half + by;
						const x0 = Math.min(p.x, q.x) - hw;
						const y0 = Math.min(p.y, q.y) - hw;
						return box({
							x: x0,
							y: y0,
							w: Math.max(p.x, q.x) + hw - x0,
							h: Math.max(p.y, q.y) + hw - y0,
							...zs(by),
							color
						});
					});
				rideParts.push(...shellAndHull(layer.id, link(rim, border), link(0, core), false));
			}
		}
	}

	const self = {
		set(route: RouteDraw | null) {
			clear();
			last = route;
			hooks.setTunnelDim(!!route);
			if (route) draw(route);
		}
	};
	const redraw = () => last && self.set(last);

	const offs = [
		// Keep the tube's on-screen size as the camera zooms. A route drawn before the camera's
		// first frame (no distance yet) redraws as soon as it has one.
		map.on('view', ({ distance }) => {
			if (!last || !distance) return;
			if (!drawnAt || Math.abs(distance / drawnAt - 1) > RESCALE) redraw();
		}),
		// Rides only show in the stacked view, where the landings give way to shaft columns.
		map.on('frame', () => {
			const stacked = hooks.isStacked();
			for (const o of rideParts) o.setVisible(stacked);
		}),
		// A level the route crosses may only get its layer later; outlines and raised rooms
		// are sized from the old looks after a restyle.
		hooks.onLayer((level) => {
			if (last?.legs.some((l) => l.level === level)) redraw();
		}),
		hooks.onRestyle(redraw)
	];
	live.add(() => {
		clear();
		for (const off of offs) off();
	});
	return self;
}

// A hot reload of this module makes a fresh route on the next draw; take the old one down
// so its (stale, wrongly sized) line can't linger on the map.
import.meta.hot?.dispose(() => {
	for (const stop of live) stop();
	live.clear();
});

export const routeOverlay = addOn(createRoute);
