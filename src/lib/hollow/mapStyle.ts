import * as THREE from 'three';
import type { Room } from '#lib/tunnels/generate.js';
import { hash01, shade, type LayerStyle, type Prop, type RoomLook } from '#lib/map/index.js';
import { FACILITY_INFO, LEVELS, SHAFTS, SHAFT_COLORS, type FacilityKind } from './data.js';
import type { Floor } from './world.js';
import { SICK_STEPS, sickStep, sicknessOf } from './sickness.js';
import { cssColor, token, type Token } from './theme.js';
import { alertsOn } from './alerts.js';
import type { Status } from './sensors.js';

/** A data view painted over the map instead of its normal palette. */
export type MapLens = 'sickness' | 'alerts';

/** Tunnels under a data lens: a flat, very dark trace just above the floor. */
const lensTunnel = () => {
	const top = token('map-lens-tunnel');
	return {
		top,
		wall: top.clone().multiplyScalar(0.85),
		underside: top.clone().multiplyScalar(0.6),
		height: 0.06
	};
};

/** Height of a tunnel, in blocks. The top block is a half block. */
export const TUNNEL_H = 1.5;
/** Base height of a habitation block, in blocks; bigger blocks stand taller. */
const ROOM_BASE_H = 2;
/** Shaft landings are open well-tubes rising out of the level. */
export const SHAFT_H = 7;
/** Rooms drawn into this part are the shaft landings (hidden where shafts are columns). */
export const SHAFT_PART = 'shafts';

/**
 * Calm navigation palette, from the `--map-*` CSS variables (see `layout.css`).
 * Deeper floors only drift slightly warmer (toward `--map-warm`).
 */
function paletteFor(index: number) {
	const warm = LEVELS[index].heat * 0.22;
	const warmth = token('map-warm');
	const drift = (name: Token) => token(name).lerp(warmth, warm);
	return {
		road: drift('map-tunnel'),
		tunnelWall: drift('map-tunnel-wall'),
		placeWall: drift('map-room-wall'),
		placeRoof: drift('map-room-roof'),
		blockWallDark: drift('map-room-dark-wall'),
		blockRoofDark: drift('map-room-dark-roof'),
		farmRoof: token('map-farm-roof'),
		farmWall: token('map-farm-wall'),
		crop: token('map-crop'),
		plantRoof: drift('map-plant-roof'),
		plantWall: drift('map-plant-wall'),
		plantCore: token('map-plant-core'),
		shaftRoof: token('map-well')
	};
}

/** Ceiling height of a chamber, in whole blocks. */
export function roomHeight(floor: Floor, r: Room) {
	if (r.kind === 'gate') return SHAFT_H;
	if (r.kind === 'farm') return 3;
	if (r.kind === 'plant') return 4;
	if (floor.facilities.has(r.id)) return 3;
	const big = Math.min(r.w, r.h) >= 3 ? 1 : 0;
	return ROOM_BASE_H + big + (hash01(r.id + floor.index * 7919) > 0.75 ? 1 : 0);
}

/** One look for a shaft everywhere it appears: tinted by its status. */
export function shaftColors(shaft: number) {
	const wall = token('map-shaft');
	if (shaft >= 0) wall.lerp(cssColor(SHAFT_COLORS[SHAFTS[shaft].status]), 0.35);
	return { wall, roof: wall.clone().multiplyScalar(1.15), well: token('map-well') };
}

/** Simple fixtures on a facility's roof that say what it is at a glance (room-local tiles). */
function facilityProps(kind: FacilityKind, r: Room, y: number): Prop[] {
	const accent = cssColor(FACILITY_INFO[kind].color);
	const dim = accent.clone().multiplyScalar(0.55);
	const cx = r.w / 2;
	const cy = r.h / 2;
	const quad = (x0: number, y0: number, x1: number, y1: number, z: number, color: THREE.Color) =>
		({ type: 'quad', x0, y0, x1, y1, z, color, glow: true }) as const;
	const out: Prop[] = [];
	if (kind === 'air') {
		// Rows of vent grilles around a fan housing.
		const alongX = r.w >= r.h;
		const n = alongX ? r.h : r.w;
		for (let i = 0; i < n - 1; i++) {
			const o = i + 0.75;
			if (alongX) out.push(quad(0.6, o, r.w - 0.6, o + 0.3, y + 0.03, dim));
			else out.push(quad(o, 0.6, o + 0.3, r.h - 0.6, y + 0.03, dim));
		}
		const housing = accent.clone().multiplyScalar(0.7);
		out.push({
			type: 'box',
			x0: cx - 0.6,
			y0: cy - 0.6,
			x1: cx + 0.6,
			y1: cy + 0.6,
			z0: y,
			z1: y + 1.2,
			wall: housing
		});
	} else if (kind === 'water') {
		// A tank open at the top.
		out.push(quad(0.4, 0.4, r.w - 0.4, r.h - 0.4, y + 0.03, dim));
		out.push(quad(0.8, 0.8, r.w - 0.8, r.h - 0.8, y + 0.05, accent));
	} else if (kind === 'clinic') {
		const pale = token('map-highlight');
		out.push(quad(cx - 0.3, cy - 1.1, cx + 0.3, cy + 1.1, y + 0.03, pale));
		out.push(quad(cx - 1.1, cy - 0.3, cx + 1.1, cy + 0.3, y + 0.03, pale));
		out.push(quad(cx - 0.2, cy - 1, cx + 0.2, cy + 1, y + 0.05, accent));
		out.push(quad(cx - 1, cy - 0.2, cx + 1, cy + 0.2, y + 0.05, accent));
	} else if (kind === 'market') {
		// Stall awnings.
		for (let ty = 0; ty + 1 < r.h; ty += 2)
			for (let tx = 0; tx + 1 < r.w; tx += 2) {
				const sx = tx + 0.55;
				const sy = ty + 0.55;
				out.push({
					type: 'box',
					x0: sx,
					y0: sy,
					x1: sx + 0.9,
					y1: sy + 0.9,
					z0: y,
					z1: y + 0.5,
					wall: dim,
					roof: accent
				});
			}
	} else {
		// Directorate: a dais with a beacon.
		out.push({
			type: 'box',
			x0: cx - 1.2,
			y0: cy - 1.2,
			x1: cx + 1.2,
			y1: cy + 1.2,
			z0: y,
			z1: y + 0.4,
			wall: dim
		});
		out.push({
			type: 'box',
			x0: cx - 0.35,
			y0: cy - 0.35,
			x1: cx + 0.35,
			y1: cy + 0.35,
			z0: y + 0.4,
			z1: y + 2.2,
			wall: accent,
			glow: true
		});
	}
	return out;
}

/** How a Hollow floor looks: tunnels, housing (dark in blackout), farms, plants, shafts, facilities. */
export function floorStyle(floor: Floor, lens: MapLens | null = null): LayerStyle {
	const c = paletteFor(floor.index);
	const sickness = lens === 'sickness' ? sicknessOf(floor) : null;
	const steps = SICK_STEPS.map((_, i) => token(`map-sick-${(i + 1) as 1 | 2 | 3 | 4 | 5}`));
	const muted = { wall: token('map-muted-wall'), roof: token('map-muted-roof') };
	const alerts = lens === 'alerts' ? alertsOn(floor) : null;
	const air: Record<Status, THREE.Color> = {
		normal: muted.roof,
		warning: token('map-alert-air-1'),
		high: token('map-alert-air-2'),
		critical: token('map-alert-air-3')
	};
	const darkRoof = token('map-alert-dark-roof');
	const darkWall = token('map-alert-dark-wall');
	return {
		seed: floor.index * 1_000_003,
		// A data lens is read off the rooms alone: they go fully opaque with flat colours (no
		// per-block brightness jitter skewing the scale), and the tunnels flatten into a
		// near-black trace on the floor, too low to ever cover a room or its highlight.
		...(lens
			? { tunnel: lensTunnel(), ghostOpacity: 0, jitter: 0 }
			: { tunnel: { top: c.road, wall: c.tunnelWall, height: TUNNEL_H } }),
		room(r): RoomLook {
			const height = roomHeight(floor, r);
			const facility = floor.facilities.get(r.id);
			const base = { height, door: null };
			if (sickness && r.kind !== 'gate') {
				// Sickness lens: houses in five steps from dark gray to bright orange; every
				// other chamber recedes so the heat reads at a glance.
				const s = sickness[r.id];
				if (!s) return { ...base, ...muted };
				const roof = steps[sickStep(s.score)];
				return { ...base, roof, wall: roof.clone().multiplyScalar(0.72) };
			}
			if (alerts && r.kind !== 'gate') {
				// Alerts lens: blackouts sink to near-black with red walls, air alerts glow by
				// severity, failing vents stay bright; everything else recedes.
				const a = alerts.blocks.get(r.id);
				if (a?.blackout) return { ...base, roof: darkRoof, wall: a.air ? air[a.air] : darkWall };
				if (a?.air)
					return { ...base, roof: air[a.air], wall: air[a.air].clone().multiplyScalar(0.7) };
				if (alerts.sources.has(r.id)) {
					const accent = cssColor(FACILITY_INFO.air.color);
					return {
						...base,
						roof: accent,
						wall: accent.clone().multiplyScalar(0.6),
						height: height + 1
					};
				}
				return { ...base, ...muted };
			}
			if (facility) {
				const accent = cssColor(FACILITY_INFO[facility.kind].color);
				return {
					...base,
					wall: c.placeWall.clone().lerp(accent, 0.3),
					roof: c.placeRoof.clone().lerp(accent, 0.4),
					props: facilityProps(facility.kind, r, height)
				};
			}
			if (r.kind === 'farm') {
				// Crops under grow-lamps, on the roof so they read from above.
				const props: Prop[] = [];
				for (let ty = 1; ty < r.h - 1; ty += 2)
					for (let tx = 1; tx < r.w - 1; tx += 2) {
						const s = 0.3 + hash01(r.id * 977 + ty * 31 + tx) * 0.12;
						const cx = tx + 0.5;
						const cy = ty + 0.5;
						props.push({
							type: 'box',
							x0: cx - s,
							y0: cy - s,
							x1: cx + s,
							y1: cy + s,
							z0: height,
							z1: height + 0.3 + s,
							wall: shade(c.crop, r.id + tx * 17 + ty)
						});
					}
				return { ...base, wall: c.farmWall, roof: c.farmRoof, props };
			}
			if (r.kind === 'plant') {
				const cx = r.w / 2;
				const cy = r.h / 2;
				const props: Prop[] = [
					{
						type: 'box',
						x0: cx - 1,
						y0: cy - 1,
						x1: cx + 1,
						y1: cy + 1,
						z0: height,
						z1: height + 0.6,
						wall: c.plantCore,
						glow: true
					}
				];
				for (const [sx, sy] of [
					[-1, -1],
					[1, -1],
					[-1, 1],
					[1, 1]
				])
					props.push({
						type: 'box',
						x0: cx + sx * 2.2 - 0.4,
						y0: cy + sy * 2.2 - 0.4,
						x1: cx + sx * 2.2 + 0.4,
						y1: cy + sy * 2.2 + 0.4,
						z0: height,
						z1: height + 1.5,
						wall: c.plantWall
					});
				return { ...base, wall: c.plantWall, roof: c.plantRoof, props };
			}
			if (r.kind === 'room') {
				// Habitation: muted; blocks in blackout go darker.
				const lit = floor.lit[r.id];
				return {
					...base,
					wall: lit ? c.placeWall : c.blockWallDark,
					roof: lit ? c.placeRoof : c.blockRoofDark
				};
			}
			// Shaft landing, with the well opening at the top.
			const { wall, roof } = shaftColors(floor.shaftGates.indexOf(r));
			return {
				...base,
				wall,
				roof,
				part: SHAFT_PART,
				props: [
					{
						type: 'quad',
						x0: 0.7,
						y0: 0.7,
						x1: r.w - 0.7,
						y1: r.h - 0.7,
						z: height + 0.03,
						color: c.shaftRoof,
						glow: true
					}
				]
			};
		}
	};
}
