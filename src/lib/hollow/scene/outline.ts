/** Hover and selection outlines: a wireframe box around one room of the shown level. */
import type { MapLayer, OutlineOverlay, OverlayHandle, TunnelMapView } from '#lib/map/index.js';
import type { Room } from '#lib/tunnels/generate.js';
import { tokenHex } from '../theme.js';

export function createOutline(
	map: TunnelMapView,
	opacity: number,
	/** The shown level's layer, and whether the levels are stacked (outlines hide then). */
	scene: { layer(): MapLayer | null | undefined; isStacked(): boolean }
) {
	let handle: OverlayHandle<OutlineOverlay> | null = null;
	let shown = false;
	let last: Room | null = null;
	const self = {
		set(r: Room | null) {
			last = r;
			const layer = scene.layer();
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
				z1: z0 + look.height + 0.1,
				visible: !scene.isStacked()
			};
			if (handle) handle.update(spec);
			else
				handle = map.addOverlay({
					type: 'outline',
					...spec,
					color: tokenHex('map-highlight'),
					opacity
				});
		},
		/** Follow the layout (call every frame). */
		sync() {
			handle?.setVisible(shown && !scene.isStacked());
		},
		/** Rebuild in the current theme colours. */
		repaint() {
			handle?.remove();
			handle = null;
			self.set(last);
		}
	};
	return self;
}
