import * as THREE from 'three';
import type { Point } from '#lib/tunnels/generate.js';
import { Builder, SIDES, corners, disposeTree, shade, toColor } from './geometry.js';
import type { Color, Space } from './layer.js';

/**
 * Overlays are pure visuals laid over the map, in tile coordinates (`x`, `y`) with heights
 * (`z`) in blocks. With a `layer` they ride with that layer (move, hide, stack with it);
 * without one they sit in world space, where `z` is absolute.
 */
interface Base {
	/** Layer id to attach to, or null/undefined for world space. */
	layer?: string | null;
	visible?: boolean;
	/** Draw order; higher draws later. */
	order?: number;
	/** 0..1 (default 1). */
	opacity?: number;
	/** Ignore depth: draw over everything. */
	onTop?: boolean;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Flat ribbons following tile paths (centre of each tile). */
export interface PathOverlay extends Base {
	type: 'path';
	paths: Point[][];
	/** Width in tiles. */
	width: number;
	z: number;
	color: Color;
}

/** Flat filled rectangles (tints, heatmaps, zones). */
export interface RectsOverlay extends Base {
	type: 'rects';
	rects: (Rect & { z?: number; color?: Color })[];
	z?: number;
	color?: Color;
}

/** Wireframe box around a rectangle (hover/selection outlines). Drawn on top by default. */
export interface OutlineOverlay extends Base, Rect {
	type: 'outline';
	z0?: number;
	z1: number;
	color: Color;
	/** Extra margin around the rectangle, in tiles (default 0.075). */
	pad?: number;
}

/** Solid boxes (columns, markers, lifts). */
export interface BoxesOverlay extends Base {
	type: 'boxes';
	boxes: (Rect & { z0: number; z1: number; color: Color; roof?: Color; bottom?: Color })[];
	/** Shaded by the scene lights (default true); false keeps exact colours. */
	lit?: boolean;
	/** Multiply each side's colour by this, by the way it faces (e.g. baked light). */
	sideShade?: Partial<Record<'n' | 's' | 'w' | 'e', number>>;
	/** Build from 1×1×1 blocks with brightness jitter, like the map itself. */
	blocky?: boolean;
	seed?: number;
	/**
	 * Draw only the inner (back) faces. Boxes grown past another shape this way form an
	 * inverted-hull outline: the hull only shows where it sticks out past that shape's
	 * silhouette.
	 */
	backSide?: boolean;
	/**
	 * Skip side faces that sit against another box of this overlay (tested just outside the
	 * face's centre), so boxes that touch or overlap read as one solid.
	 */
	merge?: boolean;
	/** Write depth even when transparent or on top (default: only when opaque). */
	depthWrite?: boolean;
}

/** Any three.js object, positioned in world space (see MapView.toWorld). */
export interface ObjectOverlay extends Base {
	type: 'object';
	object: THREE.Object3D;
}

export type OverlaySpec =
	PathOverlay | RectsOverlay | OutlineOverlay | BoxesOverlay | ObjectOverlay;

export interface OverlayHandle<S extends OverlaySpec = OverlaySpec> {
	readonly spec: S;
	readonly object: THREE.Group;
	/** Merge changes into the spec and redraw. */
	update(patch: Partial<S>): void;
	setVisible(visible: boolean): void;
	remove(): void;
}

const DEFAULT_ORDER: Record<OverlaySpec['type'], number> = {
	path: 6,
	rects: 5,
	outline: 20,
	boxes: 2,
	object: 0
};

function basic(opacity: number, onTop: boolean) {
	return new THREE.MeshBasicMaterial({
		vertexColors: true,
		transparent: opacity < 1 || onTop,
		opacity,
		depthTest: !onTop,
		depthWrite: false
	});
}

function pathGeometry(s: PathOverlay, space: Space) {
	const { wx, wz } = space;
	const b = new Builder();
	const h = s.width / 2;
	const c = toColor(s.color);
	for (const path of s.paths) {
		const pts = corners(path);
		if (pts.length === 1) {
			const p = pts[0];
			b.top(wx(p.x) + 0.5 - h, wz(p.y) + 0.5 - h, wx(p.x) + 0.5 + h, wz(p.y) + 0.5 + h, s.z, c);
		}
		for (let i = 1; i < pts.length; i++) {
			const a = pts[i - 1];
			const d = pts[i];
			b.top(
				wx(Math.min(a.x, d.x)) + 0.5 - h,
				wz(Math.min(a.y, d.y)) + 0.5 - h,
				wx(Math.max(a.x, d.x)) + 0.5 + h,
				wz(Math.max(a.y, d.y)) + 0.5 + h,
				s.z,
				c
			);
		}
	}
	return b.build();
}

function boxesGeometry(s: BoxesOverlay, space: Space) {
	const { wx, wz } = space;
	const b = new Builder();
	s.boxes.forEach((box, n) => {
		const wall = toColor(box.color);
		const roof = toColor(box.roof ?? box.color);
		const bottom = box.bottom ? toColor(box.bottom) : wall.clone().multiplyScalar(0.6);
		if (!s.blocky) {
			const x0 = wx(box.x);
			const z0 = wz(box.y);
			const x1 = wx(box.x + box.w);
			const z1 = wz(box.y + box.h);
			const cx = box.x + box.w / 2;
			const cy = box.y + box.h / 2;
			const cz = (box.z0 + box.z1) / 2;
			const e = 1e-3;
			const covered = (x: number, y: number) =>
				s.boxes.some(
					(o, k) =>
						k !== n &&
						x > o.x &&
						x < o.x + o.w &&
						y > o.y &&
						y < o.y + o.h &&
						cz > o.z0 &&
						cz < o.z1
				);
			const out: Record<'n' | 's' | 'w' | 'e', [number, number]> = {
				n: [cx, box.y - e],
				s: [cx, box.y + box.h + e],
				w: [box.x - e, cy],
				e: [box.x + box.w + e, cy]
			};
			for (const d of ['n', 's', 'w', 'e'] as const)
				if (!s.merge || !covered(...out[d]))
					b.side(
						d,
						x0,
						z0,
						x1,
						z1,
						box.z0,
						box.z1,
						wall.clone().multiplyScalar(s.sideShade?.[d] ?? 1)
					);
			b.top(x0, z0, x1, z1, box.z1, roof);
			b.top(wx(box.x), wz(box.y), wx(box.x + box.w), wz(box.y + box.h), box.z0, bottom, true);
			return;
		}
		const inside = (x: number, y: number) =>
			x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
		for (let y = box.y; y < box.y + box.h; y++)
			for (let x = box.x; x < box.x + box.w; x++) {
				const x0 = wx(x);
				const z0 = wz(y);
				const seed = (y * 1009 + x) * 7 + (s.seed ?? 0) + n * 7919;
				for (const [d, dx, dy] of SIDES) {
					if (inside(x + dx, y + dy)) continue;
					// One face per block, so the box reads like the map's own blocks.
					for (let k = 0; box.z0 + k < box.z1; k++) {
						const y0 = box.z0 + k;
						const y1 = Math.min(y0 + 1, box.z1);
						b.side(d, x0, z0, x0 + 1, z0 + 1, y0, y1, shade(wall, seed + k * 31 + d.charCodeAt(0)));
					}
				}
				b.top(x0, z0, x0 + 1, z0 + 1, box.z1, shade(roof, seed, 0.08));
				b.top(x0, z0, x0 + 1, z0 + 1, box.z0, bottom, true);
			}
	});
	return b.build();
}

function rectsGeometry(s: RectsOverlay, space: Space) {
	const { wx, wz } = space;
	const b = new Builder();
	for (const r of s.rects)
		b.top(
			wx(r.x),
			wz(r.y),
			wx(r.x + r.w),
			wz(r.y + r.h),
			r.z ?? s.z ?? 0,
			toColor(r.color ?? s.color ?? '#ffffff')
		);
	return b.build();
}

/** Builds (or, for outlines, re-places) the overlay's content under `root`. */
function draw(root: THREE.Group, s: OverlaySpec, space: Space) {
	const opacity = s.opacity ?? 1;
	const order = s.order ?? DEFAULT_ORDER[s.type];
	if (s.type === 'outline') {
		let line = root.children[0] as THREE.LineSegments | undefined;
		if (!line || !(line instanceof THREE.LineSegments)) {
			disposeTree(root);
			root.clear();
			line = new THREE.LineSegments(
				new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
				new THREE.LineBasicMaterial({ transparent: true })
			);
			root.add(line);
		}
		const mat = line.material as THREE.LineBasicMaterial;
		mat.color.set(s.color);
		mat.opacity = opacity;
		mat.depthTest = !(s.onTop ?? true);
		line.renderOrder = order;
		const pad = s.pad ?? 0.075;
		const z0 = s.z0 ?? 0;
		line.scale.set(s.w + pad * 2, s.z1 - z0, s.h + pad * 2);
		line.position.set(space.wx(s.x) + s.w / 2, (z0 + s.z1) / 2, space.wz(s.y) + s.h / 2);
		return;
	}
	if (s.type === 'object') {
		if (root.children[0] !== s.object) {
			root.clear();
			root.add(s.object);
		}
		return;
	}
	disposeTree(root);
	root.clear();
	let mesh: THREE.Mesh;
	if (s.type === 'path') mesh = new THREE.Mesh(pathGeometry(s, space), basic(opacity, !!s.onTop));
	else if (s.type === 'rects')
		mesh = new THREE.Mesh(rectsGeometry(s, space), basic(opacity, !!s.onTop));
	else {
		const transparent = opacity < 1 || !!s.onTop;
		const params = {
			vertexColors: true,
			transparent,
			opacity,
			depthTest: !s.onTop,
			depthWrite: s.depthWrite ?? !transparent,
			side: s.backSide ? THREE.BackSide : THREE.FrontSide
		};
		const mat =
			(s.lit ?? true) ? new THREE.MeshLambertMaterial(params) : new THREE.MeshBasicMaterial(params);
		mesh = new THREE.Mesh(boxesGeometry(s, space), mat);
	}
	mesh.renderOrder = order;
	root.add(mesh);
}

export class Overlay<S extends OverlaySpec = OverlaySpec> implements OverlayHandle<S> {
	readonly object = new THREE.Group();
	constructor(
		public spec: S,
		private space: Space,
		private attach: (o: Overlay, layer: string | null | undefined) => void,
		private detach: (o: Overlay) => void
	) {
		this.object.visible = spec.visible ?? true;
		draw(this.object, spec, space);
		attach(this as unknown as Overlay, spec.layer);
	}

	update(patch: Partial<S>) {
		const relayer = 'layer' in patch && patch.layer !== this.spec.layer;
		this.spec = { ...this.spec, ...patch };
		if ('visible' in patch) this.object.visible = this.spec.visible ?? true;
		draw(this.object, this.spec, this.space);
		if (relayer) this.attach(this as unknown as Overlay, this.spec.layer);
	}

	setVisible(visible: boolean) {
		this.spec = { ...this.spec, visible };
		this.object.visible = visible;
	}

	/** Redraw after the map's origin moved. */
	redraw() {
		draw(this.object, this.spec, this.space);
	}

	remove() {
		this.detach(this as unknown as Overlay);
		this.object.removeFromParent();
		// Caller-owned objects are left for the caller to dispose.
		if (this.spec.type !== 'object') disposeTree(this.object);
	}
}
