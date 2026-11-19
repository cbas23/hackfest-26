/**
 * Route add-on: a walking route drawn over the tunnels, with shaft rides as bars between
 * the stacked levels. `routeOverlay(hollowMap).set(route)` draws it; null clears it.
 *
 * The route is painted cyan over its tunnel tiles and outlined in white. Up close it is as
 * wide as the tunnel; zoomed out it keeps a minimum on-screen width, redrawing as the
 * camera zooms. While a route is up, every level's tunnels dim so it stands out.
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

/** Height the route rides at: on top of the (solid) tunnels. */
const ROUTE_Y = TUNNEL_H;
/** How far the route's cyan shell stands proud of the tunnel faces, in blocks. */
const PAD = 0.02;
/** Thickness of the white inverted-hull border around the painted tunnel, in blocks. */
const BORDER = 0.3;
/**
 * Smallest on-screen size of the route, in CSS pixels. Zoomed out (and in the all-levels
 * view) a tunnel is only a pixel or two wide, so the route grows past it to stay readable.
 */
const MIN_PX = 7;
const BORDER_MIN_PX = 3;
/** Redraw the route when its on-screen scale drifts by more than this fraction. */
const RESCALE = 0.12;
/**
 * Render order of the route. It ignores depth (nothing covers it), with the white hull
 * first and the cyan shell over it, so the white only shows outside the cyan silhouette.
 * It still writes depth, so the raised end buildings drawn after it can cover it.
 */
const ORDER = 5;

type Box = BoxesOverlay['boxes'][number];
const box = (b: Omit<Box, 'roof' | 'bottom'>): Box => ({ ...b, roof: b.color, bottom: b.color });

function createRoute(hooks: HollowMapHooks) {
	const { map } = hooks;
	let last: RouteDraw | null = null;
	let legParts: OverlayHandle[] = [];
	let rideParts: OverlayHandle[] = [];
	let raised: MapLayer[] = [];
	/** World-per-pixel the route was last drawn for. */
	let scaleAt = 0;

	/** Tiles per CSS pixel at the camera's focus. */
	const worldPerPixel = () => {
		const { camera, renderer } = map.three;
		const h = renderer.domElement.clientHeight || 1;
		const fov = (camera.fov * Math.PI) / 180;
		return (2 * map.camera.view.distance * Math.tan(fov / 2)) / h;
	};

	/** The route's two passes: the white inverted hull, then the cyan shell over it. */
	const shellAndHull = (layer: string | null, hull: Box[], shell: Box[], merge = true) => {
		const base = {
			type: 'boxes',
			layer,
			lit: false,
			merge,
			onTop: true,
			depthWrite: true
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
		// Widths in tiles: the tunnel itself up close, a fixed pixel size when far away.
		const px = worldPerPixel();
		scaleAt = px;
		const spread = Math.max(0, (MIN_PX * px - 1) / 2);
		const rim = Math.max(BORDER, BORDER_MIN_PX * px);
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
			// Legs ride with their level's layer. The cyan shell wraps the route's tunnel
			// blocks a hair larger than the tunnel so it covers the tunnel's own faces. It is
			// unlit with a cyan underside, so no face is shaded darker. The white border is an
			// inverted hull: the same blocks grown on every side, drawn back faces only, so the
			// white shows only where it sticks out past the cyan silhouette (drawn in order
			// rather than by depth, since the route ignores depth). Each tile only grows on its
			// open sides and faces between tiles are merged away, so the hull is one solid with
			// no inner walls poking up through the cyan roof. When zoomed out, both grow
			// sideways past the tunnel by `spread`.
			const has = (x: number, y: number) => tiles.has(y * W + x);
			const grow = (side: number, by: number, color: string, open = false) =>
				[...tiles.values()].map((t) => {
					const o = (dx: number, dy: number) => (open && has(t.x + dx, t.y + dy) ? 0 : side + by);
					return box({
						x: t.x - o(-1, 0),
						y: t.y - o(0, -1),
						w: 1 + o(-1, 0) + o(1, 0),
						h: 1 + o(0, -1) + o(0, 1),
						z0: -by,
						z1: ROUTE_Y + by,
						color
					});
				});
			legParts.push(
				...shellAndHull(layer.id, grow(spread, rim, border, true), grow(spread, PAD, core))
			);
		}

		// Shaft rides: vertical bars between levels, only shown when the levels are stacked.
		// Same look as the legs: a cyan bar as wide as the route, outlined in white.
		const half = 0.5 + spread;
		for (const r of route.rides) {
			const top = stackY(Math.min(r.from, r.to)) + ROUTE_Y;
			const bottom = stackY(Math.max(r.from, r.to)) + ROUTE_Y;
			const bar = (hw: number, color: string) => [
				box({
					x: r.x - hw,
					y: r.y - hw,
					w: hw * 2,
					h: hw * 2,
					z0: bottom - (hw - 0.5),
					z1: top + (hw - 0.5),
					color
				})
			];
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
						return box({
							x: x0,
							y: y0,
							w: Math.max(p.x, q.x) + hw - x0,
							h: Math.max(p.y, q.y) + hw - y0,
							z0: -by,
							z1: ROUTE_Y + by,
							color
						});
					});
				rideParts.push(
					...shellAndHull(layer.id, link(half + rim, rim, border), link(half, PAD, core), false)
				);
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

	// Keep the route's on-screen width as the camera zooms.
	map.on('view', () => {
		if (last && scaleAt && Math.abs(worldPerPixel() / scaleAt - 1) > RESCALE) redraw();
	});
	// Rides only show in the stacked view, where the landings give way to shaft columns.
	map.on('frame', () => {
		const stacked = hooks.isStacked();
		for (const o of rideParts) o.setVisible(stacked);
	});
	// A level the route crosses may only get its layer later; outlines and raised rooms are
	// sized from the old looks after a restyle.
	hooks.onLayer((level) => {
		if (last?.legs.some((l) => l.level === level)) redraw();
	});
	hooks.onRestyle(redraw);
	return self;
}

export const routeOverlay = addOn(createRoute);
