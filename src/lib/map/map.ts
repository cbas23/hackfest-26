import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { Point, Room, TunnelMap } from '#lib/tunnels/generate.js';
import { disposeTree } from './geometry.js';
import { Layer, Space, type Color, type LayerStyle, type MapLayer } from './layer.js';
import { Overlay, type OverlayHandle, type OverlaySpec } from './overlays.js';

// ── Public types ─────────────────────────────────────────────────────────────

export interface MapOptions {
	background?: Color;
	/** Distance fog; null turns it off. */
	fog?: { near: number; far: number } | null;
	/** Tile shown at world origin. Defaults to the centre of the first layer added. */
	origin?: Point;
	camera?: {
		fov?: number;
		minDistance?: number;
		maxDistance?: number;
		/** Steepest the camera may lean away from straight down, in radians. */
		maxPolarAngle?: number;
	};
	/** Pointer travel (px) below which a press counts as a click (default 5). */
	clickTolerance?: number;
}

/** What is under the pointer. */
export interface MapPick {
	layer: string;
	tile: Point;
	room: Room | null;
}

export interface MapView {
	distance: number;
	/** Degrees; 0 = north up. */
	heading: number;
}

export interface MapEvents {
	hover: (pick: MapPick | null) => void;
	click: (pick: MapPick | null, event: PointerEvent) => void;
	/** Camera distance/heading changed (rounded; fires only on change). */
	view: (view: MapView) => void;
	/** Every frame, before rendering. Drive your own animations here. */
	frame: (now: number, dt: number) => void;
}

export interface MarkerSpec {
	/** Element to position; the caller owns it (it should be absolutely positioned at 0,0). */
	el: HTMLElement;
	x: number;
	y: number;
	/** Height in blocks above the layer (or world, without a layer). Default 1. */
	z?: number;
	/** Layer to ride with; the marker hides while that layer is hidden. */
	layer?: string | null;
}

export interface MarkerHandle {
	readonly spec: MarkerSpec;
	update(patch: Partial<MarkerSpec>): void;
	remove(): void;
}

export interface FlyOptions {
	/** Tile to centre on (defaults to the current centre). */
	x?: number;
	y?: number;
	/** Distance from the target, in blocks. */
	distance?: number;
	/** Direction to face, as a tile-space vector (heading-up). Default north. */
	heading?: Point;
	/** Angle above the floor, in radians. */
	tilt?: number;
}

export interface MapCamera {
	flyTo(o: FlyOptions): void;
	/** Frame a tile rectangle. `pad` scales the box (default 1.35 × 1.2, plus a margin). */
	fitBounds(
		minX: number,
		minY: number,
		maxX: number,
		maxY: number,
		o?: { padX?: number; padY?: number; tilt?: number; maxDistance?: number }
	): void;
	zoomBy(factor: number): void;
	resetNorth(): void;
	/** Continuous panning, e.g. from held keys: -1..1 on each axis (screen-relative). */
	setPan(x: number, y: number): void;
	/** World height (blocks) the camera orbits around; flyTo eases toward it. */
	setElevation(z: number): void;
	/** Cancel any camera animation. */
	stop(): void;
	readonly view: MapView;
	readonly limits: { minDistance: number; maxDistance: number };
}

export interface TunnelMapView {
	addLayer(
		id: string,
		map: TunnelMap,
		opts?: { style?: LayerStyle; y?: number; visible?: boolean }
	): MapLayer;
	layer(id: string): MapLayer | undefined;
	layers(): MapLayer[];
	removeLayer(id: string): void;

	addOverlay<S extends OverlaySpec>(spec: S): OverlayHandle<S>;
	addMarker(spec: MarkerSpec): MarkerHandle;

	readonly camera: MapCamera;
	on<E extends keyof MapEvents>(event: E, fn: MapEvents[E]): () => void;

	/** Cover the map with the background colour (0..1), e.g. to hide a swap. */
	setVeil(opacity: number): void;
	setFog(fog: { near: number; far: number } | null): void;
	setBackground(color: Color): void;

	/** Tile (+ height, + layer) → world position. */
	toWorld(x: number, y: number, z?: number, layer?: string | null): THREE.Vector3;
	/** Tile (+ height, + layer) → container pixels, or null when off screen. */
	project(x: number, y: number, z?: number, layer?: string | null): Point | null;
	/** Pick at container pixel coordinates. */
	pickAt(px: number, py: number): MapPick | null;

	/** Escape hatch for anything the API doesn't cover. */
	readonly three: {
		renderer: THREE.WebGLRenderer;
		scene: THREE.Scene;
		camera: THREE.PerspectiveCamera;
		controls: MapControls;
	};
	dispose(): void;
}

// ── Implementation ───────────────────────────────────────────────────────────

export function createMap(container: HTMLElement, options: MapOptions = {}): TunnelMapView {
	const background = new THREE.Color(options.background ?? '#121726');
	const space = new Space();
	let originSet = false;
	if (options.origin) {
		space.origin = { ...options.origin };
		originSet = true;
	}

	const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setClearColor(background);
	container.appendChild(renderer.domElement);
	renderer.domElement.style.display = 'block';
	renderer.domElement.style.touchAction = 'none';

	const scene = new THREE.Scene();
	const fogOpt = options.fog === undefined ? { near: 260, far: 720 } : options.fog;
	if (fogOpt) scene.fog = new THREE.Fog(background, fogOpt.near, fogOpt.far);
	scene.add(new THREE.HemisphereLight('#dfe6ff', '#28304a', 2.2));
	const sun = new THREE.DirectionalLight('#ffffff', 1.6);
	sun.position.set(-0.45, 1, 0.3);
	scene.add(sun);

	const cam = options.camera ?? {};
	const camera = new THREE.PerspectiveCamera(cam.fov ?? 40, 1, 0.5, 3000);
	const controls = new MapControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.12;
	controls.zoomToCursor = true;
	controls.minDistance = cam.minDistance ?? 10;
	controls.maxDistance = cam.maxDistance ?? 520;
	controls.maxPolarAngle = cam.maxPolarAngle ?? Math.PI * 0.42;
	camera.position.set(0, 160, 150);
	controls.target.set(0, 0, 0);

	// ── Events ──────────────────────────────────────────────────────────────
	const listeners: { [E in keyof MapEvents]: Set<MapEvents[E]> } = {
		hover: new Set(),
		click: new Set(),
		view: new Set(),
		frame: new Set()
	};
	const emit = <E extends keyof MapEvents>(e: E, ...args: Parameters<MapEvents[E]>) => {
		for (const fn of listeners[e]) (fn as (...a: Parameters<MapEvents[E]>) => void)(...args);
	};

	// ── Layers ──────────────────────────────────────────────────────────────
	const layers = new Map<string, Layer>();
	const overlays = new Set<Overlay>();
	/** World-space XZ extent of all layers; the camera target stays inside it. */
	const bounds = { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
	const updateBounds = () => {
		if (!layers.size) {
			Object.assign(bounds, { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity });
			return;
		}
		const ls = [...layers.values()];
		bounds.minX = space.wx(0);
		bounds.minZ = space.wz(0);
		bounds.maxX = space.wx(Math.max(...ls.map((l) => l.map.width)));
		bounds.maxZ = space.wz(Math.max(...ls.map((l) => l.map.height)));
	};

	const attach = (o: Overlay, layerId: string | null | undefined) => {
		const parent = layerId ? layers.get(layerId)?.object : scene;
		if (!parent) throw new Error(`No layer "${layerId}"`);
		parent.add(o.object);
	};
	const detach = (o: Overlay) => overlays.delete(o);

	// ── Veil ────────────────────────────────────────────────────────────────
	const veil = document.createElement('div');
	Object.assign(veil.style, {
		position: 'absolute',
		inset: '0',
		background: `#${background.getHexString()}`,
		opacity: '0',
		pointerEvents: 'none'
	});
	container.appendChild(veil);

	// ── Picking ─────────────────────────────────────────────────────────────
	const raycaster = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
	const hit = new THREE.Vector3();
	const box = new THREE.Box3();

	/** Topmost visible layer first; on each, rooms (as boxes) before the floor behind them. */
	function pickAt(px: number, py: number): MapPick | null {
		const w = container.clientWidth || 1;
		const h = container.clientHeight || 1;
		ndc.set((px / w) * 2 - 1, -(py / h) * 2 + 1);
		raycaster.setFromCamera(ndc, camera);
		const origin = raycaster.ray.origin;
		const visible = [...layers.values()].filter((l) => l.visible).sort((a, b) => b.y - a.y);
		for (const layer of visible) {
			const { map } = layer;
			const ly = layer.y;
			let room: Room | null = null;
			let nearest = Infinity;
			for (const r of map.rooms) {
				const look = layer.lookOf(r);
				if (!look || look.pickable === false) continue;
				const base = ly - layer.sinkOf(r);
				box.min.set(space.wx(r.x), base, space.wz(r.y));
				box.max.set(space.wx(r.x) + r.w, base + look.height, space.wz(r.y) + r.h);
				if (!raycaster.ray.intersectBox(box, hit)) continue;
				const d = hit.distanceToSquared(origin);
				if (d < nearest) {
					nearest = d;
					room = r;
				}
			}
			plane.constant = -(ly + layer.tunnelHeight);
			if (!raycaster.ray.intersectPlane(plane, hit)) {
				if (room) return { layer: layer.id, tile: { ...room.door }, room };
				continue;
			}
			const tile = { x: Math.floor(space.tx(hit.x)), y: Math.floor(space.ty(hit.z)) };
			if (room && nearest < hit.distanceToSquared(origin)) return { layer: layer.id, tile, room };
			if ((map.grid[tile.y]?.[tile.x] ?? 'void') === 'void') {
				if (room) return { layer: layer.id, tile, room };
				continue;
			}
			const under = map.rooms[map.roomAt[tile.y][tile.x]];
			const look = under ? layer.lookOf(under) : null;
			return {
				layer: layer.id,
				tile,
				room: look && look.pickable !== false ? under : null
			};
		}
		return null;
	}

	const el = renderer.domElement;
	const local = (e: PointerEvent) => {
		const rect = el.getBoundingClientRect();
		return pickAt(e.clientX - rect.left, e.clientY - rect.top);
	};
	const tolerance = options.clickTolerance ?? 5;
	let down: Point | null = null;
	const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
	const onMove = (e: PointerEvent) => {
		if (e.buttons === 0 && listeners.hover.size) emit('hover', local(e));
	};
	const onUp = (e: PointerEvent) => {
		if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < tolerance)
			emit('click', local(e), e);
		down = null;
	};
	const onLeave = () => emit('hover', null);
	el.addEventListener('pointerdown', onDown);
	el.addEventListener('pointermove', onMove);
	el.addEventListener('pointerup', onUp);
	el.addEventListener('pointerleave', onLeave);

	// ── Camera motion ───────────────────────────────────────────────────────
	let fly: { x: number; z: number; dist: number; dir?: THREE.Vector3 } | null = null;
	let elevation = 0;
	const cancelFly = () => (fly = null);
	controls.addEventListener('start', cancelFly);
	const pan = { x: 0, y: 0 };

	const resize = () => {
		const w = container.clientWidth || 1;
		const h = container.clientHeight || 1;
		renderer.setSize(w, h);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	const observer = new ResizeObserver(resize);
	observer.observe(container);
	resize();

	/** Camera direction sitting behind `heading` (heading-up), tilted `tilt` rad above the floor. */
	const tiltDir = (heading: Point | undefined, tilt: number) => {
		const hd = heading ?? { x: 0, y: -1 };
		const len = Math.hypot(hd.x, hd.y) || 1;
		const cosT = Math.cos(tilt);
		return new THREE.Vector3((-hd.x / len) * cosT, Math.sin(tilt), (-hd.y / len) * cosT);
	};

	const offset = new THREE.Vector3();
	const view: MapView = { distance: 0, heading: 0 };

	const cameraApi: MapCamera = {
		flyTo(o) {
			fly = {
				x: o.x !== undefined ? space.wx(o.x) : (fly?.x ?? controls.target.x),
				z: o.y !== undefined ? space.wz(o.y) : (fly?.z ?? controls.target.z),
				dist: o.distance ?? camera.position.distanceTo(controls.target),
				dir: o.heading || o.tilt !== undefined ? tiltDir(o.heading, o.tilt ?? 0.75) : undefined
			};
		},
		fitBounds(minX, minY, maxX, maxY, o = {}) {
			const fov = THREE.MathUtils.degToRad(camera.fov);
			const w = (maxX - minX) * (o.padX ?? 1.35) + 24;
			const h = (maxY - minY) * (o.padY ?? 1.2) + 20;
			// Width must fit the horizontal field of view; depth is foreshortened by the tilt.
			const span = Math.max(w / camera.aspect, h, 24);
			const dist = THREE.MathUtils.clamp(span / (2 * Math.tan(fov / 2)), 25, o.maxDistance ?? 480);
			fly = {
				x: space.wx((minX + maxX) / 2),
				z: space.wz((minY + maxY) / 2),
				dist,
				dir: tiltDir(undefined, o.tilt ?? 1.05)
			};
		},
		zoomBy(factor) {
			const dist = fly?.dist ?? camera.position.distanceTo(controls.target);
			fly = {
				x: fly?.x ?? controls.target.x,
				z: fly?.z ?? controls.target.z,
				dist: THREE.MathUtils.clamp(dist / factor, controls.minDistance, controls.maxDistance),
				dir: fly?.dir
			};
		},
		resetNorth() {
			offset.copy(camera.position).sub(controls.target);
			const tilt = Math.asin(THREE.MathUtils.clamp(offset.y / offset.length(), -1, 1));
			fly = {
				x: controls.target.x,
				z: controls.target.z,
				dist: offset.length(),
				dir: tiltDir(undefined, tilt)
			};
		},
		setPan(x, y) {
			pan.x = x;
			pan.y = y;
		},
		setElevation(z) {
			elevation = z;
		},
		stop: cancelFly,
		get view() {
			return { ...view };
		},
		get limits() {
			return { minDistance: controls.minDistance, maxDistance: controls.maxDistance };
		}
	};

	// ── Markers ─────────────────────────────────────────────────────────────
	const markers = new Set<{ spec: MarkerSpec }>();
	const v = new THREE.Vector3();
	const layerY = (id: string | null | undefined) => (id ? (layers.get(id)?.y ?? 0) : 0);
	const placeMarker = ({ spec: m }: { spec: MarkerSpec }) => {
		const layer = m.layer ? layers.get(m.layer) : null;
		let visible = !m.layer || !!layer?.visible;
		if (visible) {
			v.set(space.wx(m.x), (m.z ?? 1) + layerY(m.layer), space.wz(m.y)).project(camera);
			visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
		}
		m.el.style.visibility = visible ? 'visible' : 'hidden';
		if (!visible) return;
		const sx = (v.x * 0.5 + 0.5) * container.clientWidth;
		const sy = (-v.y * 0.5 + 0.5) * container.clientHeight;
		m.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
		m.el.style.zIndex = String(Math.round((1 - v.z) * 1e5));
	};

	// ── Frame loop ──────────────────────────────────────────────────────────
	const right = new THREE.Vector3();
	const forward = new THREE.Vector3();
	let raf = 0;
	let last = performance.now();
	let lastView = '';
	const frame = (t: number) => {
		raf = requestAnimationFrame(frame);
		const dt = Math.min(50, t - last);
		last = t;
		const k = 1 - Math.exp(-dt / 140);

		offset.copy(camera.position).sub(controls.target);
		if (pan.x || pan.y) {
			fly = null;
			right.setFromMatrixColumn(camera.matrix, 0).setY(0).normalize();
			forward.set(-right.z, 0, right.x);
			const speed = offset.length() * 0.0012 * dt;
			controls.target.addScaledVector(right, pan.x * speed).addScaledVector(forward, pan.y * speed);
			camera.position.copy(controls.target).add(offset);
		}
		if (fly) {
			controls.target.x += (fly.x - controls.target.x) * k;
			controls.target.z += (fly.z - controls.target.z) * k;
			controls.target.y += (elevation - controls.target.y) * k;
			const dist = offset.length();
			const next = dist * Math.pow(fly.dist / dist, k);
			offset.normalize();
			if (fly.dir) offset.lerp(fly.dir, k).normalize();
			camera.position.copy(controls.target).addScaledVector(offset, next);
			if (
				Math.abs(fly.x - controls.target.x) < 0.03 &&
				Math.abs(fly.z - controls.target.z) < 0.03 &&
				Math.abs(elevation - controls.target.y) < 0.03 &&
				Math.abs(fly.dist / next - 1) < 0.002 &&
				(!fly.dir || offset.angleTo(fly.dir) < 0.005)
			)
				fly = null;
		}
		controls.target.x = THREE.MathUtils.clamp(controls.target.x, bounds.minX, bounds.maxX);
		controls.target.z = THREE.MathUtils.clamp(controls.target.z, bounds.minZ, bounds.maxZ);
		if (!fly) controls.target.y = elevation;
		controls.update();

		emit('frame', performance.now(), dt);

		for (const m of markers) placeMarker(m);
		renderer.render(scene, camera);

		offset.copy(camera.position).sub(controls.target);
		view.distance = Math.round(offset.length());
		view.heading = Math.round(THREE.MathUtils.radToDeg(Math.atan2(-offset.x, offset.z)));
		const key = `${view.distance}:${view.heading}`;
		if (key !== lastView) {
			lastView = key;
			emit('view', { ...view });
		}
	};
	raf = requestAnimationFrame(frame);

	return {
		addLayer(id, map, opts = {}) {
			if (layers.has(id)) throw new Error(`Layer "${id}" already exists`);
			if (!originSet) {
				space.origin = { x: map.width / 2, y: map.height / 2 };
				originSet = true;
				for (const o of overlays) o.redraw();
			}
			const layer = new Layer(id, map, opts.style ?? {}, space);
			layer.set({ y: opts.y ?? 0, visible: opts.visible ?? true });
			layers.set(id, layer);
			scene.add(layer.object);
			updateBounds();
			return layer;
		},
		layer: (id) => layers.get(id),
		layers: () => [...layers.values()],
		removeLayer(id) {
			const layer = layers.get(id);
			if (!layer) return;
			for (const o of [...overlays]) if (o.spec.layer === id) o.remove();
			for (const m of [...markers]) if (m.spec.layer === id) markers.delete(m);
			layer.dispose();
			layers.delete(id);
			updateBounds();
		},

		addOverlay<S extends OverlaySpec>(spec: S) {
			const o = new Overlay<S>(spec, space, attach, detach);
			overlays.add(o as unknown as Overlay);
			return o;
		},
		addMarker(spec) {
			const m = { spec: { ...spec } };
			markers.add(m);
			placeMarker(m);
			return {
				get spec() {
					return m.spec;
				},
				update(patch) {
					m.spec = { ...m.spec, ...patch };
					placeMarker(m);
				},
				remove() {
					markers.delete(m);
				}
			};
		},

		camera: cameraApi,
		on(event, fn) {
			listeners[event].add(fn);
			return () => listeners[event].delete(fn);
		},

		setVeil(opacity) {
			veil.style.opacity = THREE.MathUtils.clamp(opacity, 0, 1).toFixed(3);
		},
		setFog(fog) {
			if (!fog) scene.fog = null;
			else if (scene.fog instanceof THREE.Fog) {
				scene.fog.near = fog.near;
				scene.fog.far = fog.far;
			} else scene.fog = new THREE.Fog(background, fog.near, fog.far);
		},
		setBackground(color) {
			background.set(color);
			renderer.setClearColor(background);
			if (scene.fog) scene.fog.color.copy(background);
			veil.style.background = `#${background.getHexString()}`;
		},

		toWorld(x, y, z = 0, layer) {
			return new THREE.Vector3(space.wx(x), z + layerY(layer), space.wz(y));
		},
		project(x, y, z = 0, layer) {
			v.set(space.wx(x), z + layerY(layer), space.wz(y)).project(camera);
			if (v.z < -1 || v.z > 1) return null;
			return {
				x: (v.x * 0.5 + 0.5) * container.clientWidth,
				y: (-v.y * 0.5 + 0.5) * container.clientHeight
			};
		},
		pickAt,

		three: { renderer, scene, camera, controls },
		dispose() {
			cancelAnimationFrame(raf);
			observer.disconnect();
			controls.removeEventListener('start', cancelFly);
			controls.dispose();
			el.removeEventListener('pointerdown', onDown);
			el.removeEventListener('pointermove', onMove);
			el.removeEventListener('pointerup', onUp);
			el.removeEventListener('pointerleave', onLeave);
			for (const fns of Object.values(listeners)) fns.clear();
			markers.clear();
			veil.remove();
			disposeTree(scene);
			renderer.dispose();
			el.remove();
		}
	};
}
