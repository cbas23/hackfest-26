import * as THREE from 'three';
import type { Room } from '#lib/tunnels/generate.js';
import { hash01, shade, type LayerStyle, type Prop, type RoomLook } from '#lib/map/index.js';
import { FACILITY_INFO, LEVELS, SHAFTS, SHAFT_COLORS, type FacilityKind } from './data.js';
import type { Floor } from './world.js';

/** Height of a tunnel, in blocks. The top block is a half block. */
export const TUNNEL_H = 1.5;
/** Base height of a habitation block, in blocks; bigger blocks stand taller. */
const ROOM_BASE_H = 2;
/** Shaft landings are open well-tubes rising out of the level. */
export const SHAFT_H = 7;
/** Rooms drawn into this part are the shaft landings (hidden where shafts are columns). */
export const SHAFT_PART = 'shafts';

const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);

/** Calm navigation palette; deeper floors only drift slightly warmer. */
function paletteFor(index: number) {
	const warm = LEVELS[index].heat * 0.22;
	return {
		road: mix('#c3cdee', '#d2c6c0', warm),
		tunnelWall: mix('#a3aed6', '#b4a69f', warm),
		placeWall: mix('#7a81af', '#827598', warm),
		placeRoof: mix('#5f6694', '#695c7e', warm),
		blockWallDark: mix('#4a4e72', '#4f465d', warm),
		blockRoofDark: mix('#383c5c', '#3d3549', warm),
		farmRoof: new THREE.Color('#1f6b67'),
		farmWall: new THREE.Color('#2a7d76'),
		crop: new THREE.Color('#38a897'),
		plantRoof: mix('#3c4060', '#43373f', warm),
		plantWall: mix('#575c80', '#5f5160', warm),
		plantCore: new THREE.Color('#ff9a52'),
		shaftRoof: new THREE.Color('#141a2b')
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
	const status = shaft >= 0 ? SHAFT_COLORS[SHAFTS[shaft].status] : '#5eead4';
	const wall = new THREE.Color('#3b4a74').lerp(new THREE.Color(status), 0.35);
	return { wall, roof: wall.clone().multiplyScalar(1.15), well: new THREE.Color('#141a2b') };
}

/** Simple fixtures on a facility's roof that say what it is at a glance (room-local tiles). */
function facilityProps(kind: FacilityKind, r: Room, y: number): Prop[] {
	const accent = new THREE.Color(FACILITY_INFO[kind].color);
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
		const pale = new THREE.Color('#f5f7ff');
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
export function floorStyle(floor: Floor): LayerStyle {
	const c = paletteFor(floor.index);
	return {
		seed: floor.index * 1_000_003,
		tunnel: { top: c.road, wall: c.tunnelWall, height: TUNNEL_H },
		room(r): RoomLook {
			const height = roomHeight(floor, r);
			const facility = floor.facilities.get(r.id);
			const base = { height, door: null };
			if (facility) {
				const accent = new THREE.Color(FACILITY_INFO[facility.kind].color);
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
