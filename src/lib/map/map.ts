import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { Point, Room, TunnelMap } from '#lib/tunnels/generate.js';
import { disposeTree } from './geometry.js';
import { Layer, Space, type Color, type LayerStyle, type MapLayer } from './layer.js';
import { Overlay, type OverlayHandle, type OverlaySpec } from './overlays.js';

// ── Public types ─────────────────────────────────────────────────────────────

export interface MapOptions {
	background?: Color;
	/** Hemisphere light: colour from above and from below. */
	light?: { sky?: Color; ground?: Color };
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
	/** `event` is the pointer move (none when the pointer leaves the map). */
	hover: (pick: MapPick | null, event?: PointerEvent) => void;
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
	/**
	 * Frame a set of points (tile x/y, world height z) so they fill `fill` of the view (default
	 * 0.9) on the tighter axis, seen from `heading` and `tilt`. Orbits at their centre's height.
	 */
	fitPoints(
		points: readonly { x: number; y: number; z: number }[],
		o?: { heading?: Point; tilt?: number; fill?: number }
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
	setLight(light: { sky?: Color; ground?: Color }): void;

	/** Tile (+ height, + layer) → world position. */
	toWorld(x: number, y: number, z?: number, layer?: string | null): THREE.Vector3;
	/** Tile (+ height, + layer) → container pixels, or null when off screen. */
	project(x: number, y: number, z?: number, layer?: string | null): Point | null;
	/** Pick at container pixel coordinates. */
	pickAt(px: number, py: number): MapPick | null;
	/** The camera ray through container pixel coordinates, in world space. */
	rayAt(px: number, py: number): THREE.Ray;

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
	const hemi = new THREE.HemisphereLight(
		options.light?.sky ?? '#dfe6ff',
		options.light?.ground ?? '#28304a',
		2.2
	);
	scene.add(hemi);
	const sun = new THREE.DirectionalLight('#ffffff', 1.6);
	sun.position.set(-0.45, 1, 0.3);
	scene.add(sun);

	// ── Warm-up: get new meshes onto the GPU before they are shown ───────────
	// A mesh's buffers upload the first time it is drawn, which for a whole level is a
	// long frame. New layer bodies are drawn once beforehand, one mesh per frame, into a
	// single pixel (that the real frame then paints over), in a scene with the same kinds
	// of lights and fog so the shaders already compiled for the real scene are reused.
	const warmScene = new THREE.Scene();
	warmScene.add(new THREE.HemisphereLight(), new THREE.DirectionalLight());
	const warmQueue: { mesh: THREE.Mesh; done?: () => void }[] = [];
	const warmUp = (object: THREE.Object3D) =>
		new Promise<void>((resolve) => {
			const meshes: THREE.Mesh[] = [];
			object.traverse((o) => {
				if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
			});
			if (!meshes.length) return resolve();
			meshes.forEach((mesh, i) =>
				warmQueue.push({ mesh, done: i === meshes.length - 1 ? resolve : undefined })
			);
		});
	const warmNext = () => {
		const job = warmQueue.shift();
		if (!job) return;
		const { mesh } = job;
		const parent = mesh.parent;
		const culled = mesh.frustumCulled;
		mesh.frustumCulled = false;
		warmScene.fog = scene.fog;
		warmScene.add(mesh);
		renderer.setScissorTest(true);
		renderer.setScissor(0, 0, 1, 1);
		renderer.render(warmScene, camera);
		renderer.setScissorTest(false);
		warmScene.remove(mesh);
		parent?.add(mesh);
		mesh.frustumCulled = culled;
		job.done?.();
	};
	/** Compile a new layer body's shaders (without blocking), then upload its meshes. */
	const prepare = async (object: THREE.Object3D) => {
		await renderer.compileAsync(object, camera, scene);
		await warmUp(object);
	};

	const cam = options.camera ?? {};
	const camera = new THREE.PerspectiveCamera(cam.fov ?? 40, 1, 0.5, 3000);
	const controls = new MapControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.12;
	controls.zoomToCursor = true;
	controls.minDistance = cam.minDistance ?? 10;
	controls.maxDistance = cam.maxDistance ?? 520;
	// Orbit all the way over: from straight overhead (0) to straight underneath (π).
	controls.maxPolarAngle = cam.maxPolarAngle ?? Math.PI;
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
				if (!look || look.pickable === false || !layer.partVisible(look.part ?? '')) continue;
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
			const onPlane = raycaster.ray.intersectPlane(plane, hit) !== null;
			const tile = onPlane
				? { x: Math.floor(space.tx(hit.x)), y: Math.floor(space.ty(hit.z)) }
				: null;
			// Only drawn surfaces stop the ray: tunnels and rooms. Rock and void aren't drawn,
			// so a stacked layer below shows (and picks) through them.
			const road = tile !== null && map.grid[tile.y]?.[tile.x] === 'road';
			if (room && (!road || nearest < hit.distanceToSquared(origin)))
				return { layer: layer.id, tile: tile ?? { ...room.door }, room };
			if (!tile || !road) continue;
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
		if (e.buttons === 0 && listeners.hover.size) emit('hover', local(e), e);
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

	// ── Cursors ─────────────────────────────────────────────────────────────
	// While a gesture runs the canvas shows what it does (grab, rotate, zoom); at rest it
	// inherits the container's cursor, so the page can show a pointer over clickable rooms.
	const gesture = gestureCursor(el, controls);

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
		fitPoints(points, o = {}) {
			if (!points.length) return;
			const dir = tiltDir(o.heading, o.tilt ?? 0.75);
			const forward = dir.clone().negate();
			const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
			const up = new THREE.Vector3().crossVectors(right, forward);
			const fill = o.fill ?? 0.9;
			const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * fill;
			const tanH = tanV * camera.aspect;
			const ws = points.map((p) => new THREE.Vector3(space.wx(p.x), p.z, space.wz(p.y)));
			// Centre on the middle of the points' screen extent (near enough to orthographic).
			const along = (axis: THREE.Vector3) => {
				const d = ws.map((w) => w.dot(axis));
				return (Math.min(...d) + Math.max(...d)) / 2;
			};
			const c = new THREE.Vector3()
				.addScaledVector(right, along(right))
				.addScaledVector(up, along(up))
				.addScaledVector(forward, along(forward));
			// A point at (r, u, f) from the centre projects inside the frame once the camera is at
			// least |r| / tanH - f (and |u| / tanV - f) back from it.
			let dist = 0;
			const p = new THREE.Vector3();
			for (const w of ws) {
				p.copy(w).sub(c);
				const f = p.dot(forward);
				dist = Math.max(dist, Math.abs(p.dot(right)) / tanH - f, Math.abs(p.dot(up)) / tanV - f);
			}
			elevation = c.y;
			fly = {
				x: c.x,
				z: c.z,
				dist: THREE.MathUtils.clamp(dist, controls.minDistance, controls.maxDistance),
				dir
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
		// Keep the target over the map (and at the orbit height). The camera moves with it,
		// so hitting an edge stops the pan instead of swinging the view and zoom around.
		const tx = THREE.MathUtils.clamp(controls.target.x, bounds.minX, bounds.maxX);
		const tz = THREE.MathUtils.clamp(controls.target.z, bounds.minZ, bounds.maxZ);
		const ty = fly ? controls.target.y : elevation;
		camera.position.x += tx - controls.target.x;
		camera.position.y += ty - controls.target.y;
		camera.position.z += tz - controls.target.z;
		controls.target.set(tx, ty, tz);
		controls.update();

		emit('frame', performance.now(), dt);

		for (const m of markers) placeMarker(m);
		warmNext();
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
			const layer = new Layer(id, map, opts.style ?? {}, space, prepare);
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
		setLight({ sky, ground }) {
			if (sky !== undefined) hemi.color.set(sky);
			if (ground !== undefined) hemi.groundColor.set(ground);
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
		rayAt(px, py) {
			const w = container.clientWidth || 1;
			const h = container.clientHeight || 1;
			raycaster.setFromCamera(ndc.set((px / w) * 2 - 1, -(py / h) * 2 + 1), camera);
			return raycaster.ray.clone();
		},

		three: { renderer, scene, camera, controls },
		dispose() {
			cancelAnimationFrame(raf);
			for (const job of warmQueue.splice(0)) job.done?.();
			observer.disconnect();
			controls.removeEventListener('start', cancelFly);
			controls.dispose();
			el.removeEventListener('pointerdown', onDown);
			el.removeEventListener('pointermove', onMove);
			el.removeEventListener('pointerup', onUp);
			el.removeEventListener('pointerleave', onLeave);
			gesture.dispose();
			for (const fns of Object.values(listeners)) fns.clear();
			markers.clear();
			veil.remove();
			disposeTree(scene);
			renderer.dispose();
			el.remove();
		}
	};
}

// ── Gesture cursors ─────────────────────────────────────────────────────────
/** A circular arrow (there is no standard "rotate" cursor), outlined so it reads on any map. */
const ROTATE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
	'<g stroke="#000" stroke-width="4.5"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 3v4.5h-4.5"/></g>' +
	'<g stroke="#fff" stroke-width="2"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 3v4.5h-4.5"/></g>' +
	'</svg>';
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ROTATE_SVG)}") 12 12, move`;

/**
 * Show what the camera gesture under way does: a closed hand while panning, a rotate
 * arrow while orbiting, a vertical resize while dollying, and zoom in/out while the
 * wheel turns. Mirrors MapControls' bindings (left pans, right rotates, middle dollies;
 * ctrl/meta/shift swaps pan and rotate). At rest the cursor is cleared so the canvas
 * inherits its container's.
 */
function gestureCursor(el: HTMLElement, controls: MapControls) {
	let drag = '';
	let wheel = '';
	let wheelTimer: ReturnType<typeof setTimeout> | undefined;
	const apply = () => (el.style.cursor = drag || wheel);
	// OrbitControls writes an inline `cursor: auto` on connect, which would block inheriting.
	apply();

	const onDown = (e: PointerEvent) => {
		if (!controls.enabled || e.pointerType === 'touch') return;
		const swap = e.ctrlKey || e.metaKey || e.shiftKey;
		const pan = controls.enablePan ? 'grabbing' : '';
		const rotate = controls.enableRotate ? ROTATE_CURSOR : '';
		if (e.button === 0) drag = swap ? rotate : pan;
		else if (e.button === 2) drag = swap ? pan : rotate;
		else if (e.button === 1) drag = controls.enableZoom ? 'ns-resize' : '';
		else return;
		apply();
	};
	const onUp = () => {
		if (!drag) return;
		drag = '';
		apply();
	};
	const onWheel = (e: WheelEvent) => {
		if (!controls.enabled || !controls.enableZoom || !e.deltaY) return;
		wheel = e.deltaY < 0 ? 'zoom-in' : 'zoom-out';
		apply();
		clearTimeout(wheelTimer);
		wheelTimer = setTimeout(() => {
			wheel = '';
			apply();
		}, 250);
	};

	el.addEventListener('pointerdown', onDown);
	el.addEventListener('lostpointercapture', onUp);
	el.addEventListener('wheel', onWheel, { passive: true });
	window.addEventListener('pointerup', onUp);
	window.addEventListener('pointercancel', onUp);
	window.addEventListener('blur', onUp);
	return {
		dispose() {
			clearTimeout(wheelTimer);
			el.removeEventListener('pointerdown', onDown);
			el.removeEventListener('lostpointercapture', onUp);
			el.removeEventListener('wheel', onWheel);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			window.removeEventListener('blur', onUp);
		}
	};
}
