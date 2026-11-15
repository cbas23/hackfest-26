/**
 * A content-agnostic 3D renderer for generated tunnel maps.
 *
 * It draws `TunnelMap`s as layers of blocky tunnels and rooms, and exposes visual
 * primitives only: per-room styles, overlays, HTML markers, camera moves, picking and
 * a frame hook. It knows nothing about what the rooms mean; apps build that on top.
 *
 *   const map = createMap(el);
 *   const ground = map.addLayer('ground', tunnelMap, { style });
 *   map.addOverlay({ type: 'path', layer: 'ground', paths, width: 0.5, z: 1.6, color: '#38d8f2' });
 *   map.on('click', (pick) => …);
 */
export { createMap } from './map.js';
export type {
	FlyOptions,
	MapCamera,
	MapEvents,
	MapOptions,
	MapPick,
	MapView,
	MarkerHandle,
	MarkerSpec,
	TunnelMapView
} from './map.js';
export { DEFAULT_TUNNEL, defaultRoomLook } from './layer.js';
export type { Color, LayerStyle, MapLayer, Prop, RoomLook, TunnelLook } from './layer.js';
export type {
	BoxesOverlay,
	ObjectOverlay,
	OutlineOverlay,
	OverlayHandle,
	OverlaySpec,
	PathOverlay,
	Rect,
	RectsOverlay
} from './overlays.js';
/** Helpers for styles: deterministic noise and brightness jitter. */
export { hash01, shade } from './geometry.js';
