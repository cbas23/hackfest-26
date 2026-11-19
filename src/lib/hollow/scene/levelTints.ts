/**
 * Level-tint add-on: tint every building on whole levels (shown in the stacked view too),
 * e.g. a risk heat map. `levelTintOverlay(hollowMap).set(tints)`; an empty list clears it.
 */
import type { OverlayHandle } from '#lib/map/index.js';
import { cssHex } from '../theme.js';
import { addOn, layerId, type HollowMapHooks } from './common.js';

export interface LevelTint {
	level: number;
	/** Any CSS colour. */
	color: string;
	/** Default 0.75. */
	opacity?: number;
}

function createLevelTints({ map }: HollowMapHooks) {
	let handles: OverlayHandle[] = [];
	return {
		set(tints: LevelTint[]) {
			for (const h of handles) h.remove();
			handles = [];
			for (const t of tints) {
				const layer = map.layer(layerId(t.level));
				if (!layer) continue;
				const color = cssHex(t.color);
				handles.push(
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
								color
							})),
						opacity: t.opacity ?? 0.75,
						visible: true
					})
				);
			}
		}
	};
}

export const levelTintOverlay = addOn(createLevelTints);
