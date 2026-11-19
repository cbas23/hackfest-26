/**
 * Shaft columns for the all-levels view. Shafts are the only places at the same spot on
 * every level, so in the stacked view each one is drawn as a single solid column from the
 * bottom level to the top, in the same blocky style and colour as its landings (which are
 * hidden meanwhile).
 */
import {
	SIDE_SHADE,
	UNDERSIDE_SHADE,
	type BoxesOverlay,
	type OverlayHandle,
	type TunnelMapView
} from '#lib/map/index.js';
import { LEVELS, SHAFTS } from '../data.js';
import { SHAFT_H, shaftColors } from '../mapStyle.js';
import type { Floor } from '../world.js';
import { stackY } from './common.js';

/** Build the columns (hidden) from the Crown's shaft gates. */
export function buildShaftColumns(map: TunnelMapView, crown: Floor): OverlayHandle[] {
	const bottom = stackY(LEVELS.length - 1);
	const boxes: BoxesOverlay['boxes'] = [];
	const wells: { x: number; y: number; w: number; h: number; z: number; color: string }[] = [];
	SHAFTS.forEach((info, s) => {
		const g = crown.shaftGates[s];
		if (!g) return;
		const { roof, well } = shaftColors(s);
		// The sealed Ascent carries on above the Crown, toward the surface.
		const top = stackY(0) + SHAFT_H + (info.status === 'sealed' ? 8 : 0);
		// Shaded by face like the rooms.
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
	return [
		map.addOverlay({ type: 'boxes', boxes, lit: false, sideShade: SIDE_SHADE, visible: false }),
		map.addOverlay({ type: 'rects', rects: wells, order: 2, visible: false })
	];
}
