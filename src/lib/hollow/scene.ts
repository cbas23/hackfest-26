import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
	DISTRICTS,
	LEVELS,
	SHAFTS,
	SHAFT_COLORS,
	STATUS_COLORS,
	TUNNELS,
	levelById,
	levelY,
	type District,
	type DistrictKind,
	type Level,
	type Shaft
} from './data.js';

export type Selection =
	| { type: 'district'; item: District }
	| { type: 'shaft'; item: Shaft }
	| { type: 'level'; item: Level }
	| null;

export interface HollowSceneOptions {
	onSelect: (sel: Selection) => void;
	onHover?: (sel: Selection) => void;
}

export interface HollowScene {
	focusLevel: (id: string | null) => void;
	select: (sel: Selection) => void;
	resetView: () => void;
	dispose: () => void;
}

/* ------------------------------------------------------------------ helpers */

function mulberry32(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const TOP_COLOR = new THREE.Color('#bae6fd');
const DEEP_COLOR = new THREE.Color('#ff5a2e');

function levelColor(level: Level) {
	if (level.index === 0) return new THREE.Color('#fb7185');
	const t = (level.index - 1) / (LEVELS.length - 2);
	const hslA = { h: 0, s: 0, l: 0 };
	const hslB = { h: 0, s: 0, l: 0 };
	TOP_COLOR.getHSL(hslA);
	DEEP_COLOR.getHSL(hslB);
	return new THREE.Color().setHSL(
		hslA.h + (hslB.h - 1 - hslA.h) * t,
		hslA.s + (hslB.s - hslA.s) * t,
		hslA.l + (hslB.l - hslA.l) * t
	);
}

/** Irregular "carved cavern" outline. */
function blobOutline(rx: number, rz: number, seed: number, segments = 72) {
	const rand = mulberry32(seed);
	const phases = [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2];
	const pts: THREE.Vector2[] = [];
	for (let i = 0; i < segments; i++) {
		const a = (i / segments) * Math.PI * 2;
		const n =
			1 +
			0.08 * Math.sin(a * 3 + phases[0]) +
			0.05 * Math.sin(a * 5 + phases[1]) +
			0.03 * Math.sin(a * 11 + phases[2]) +
			(rand() - 0.5) * 0.03;
		pts.push(new THREE.Vector2(Math.cos(a) * rx * n, Math.sin(a) * rz * n));
	}
	return pts;
}

function glowTexture() {
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	g.addColorStop(0, 'rgba(255,255,255,1)');
	g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
	g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
	g.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function districtGeometry(kind: DistrictKind): THREE.BufferGeometry {
	switch (kind) {
		case 'directorate':
			return new THREE.CylinderGeometry(0.35, 0.7, 2.4, 6).translate(0, 1.2, 0);
		case 'farm':
			return new THREE.BoxGeometry(2.4, 0.25, 1.4).translate(0, 0.125, 0);
		case 'plant':
			return new THREE.CylinderGeometry(0.6, 1.1, 1.4, 10, 1, true).translate(0, 0.7, 0);
		case 'recycler':
			return new THREE.TorusGeometry(0.75, 0.22, 8, 24).rotateX(Math.PI / 2).translate(0, 0.25, 0);
		case 'air':
			return new THREE.CylinderGeometry(0.8, 0.8, 0.5, 16, 1, true).translate(0, 0.25, 0);
		case 'hub':
			return new THREE.OctahedronGeometry(0.75).translate(0, 0.75, 0);
		case 'clinic':
			return new THREE.BoxGeometry(0.9, 0.9, 0.9).translate(0, 0.45, 0);
		case 'ruin':
			return new THREE.BoxGeometry(0.6, 0.6, 0.6).translate(0, 0.3, 0);
		case 'machine':
			return new THREE.IcosahedronGeometry(0.55, 0).translate(0, 0.9, 0);
		case 'city':
		default:
			return new THREE.CylinderGeometry(0.9, 0.9, 0.9, 20).translate(0, 0.45, 0);
	}
}

/* ------------------------------------------------------------------ scene */

interface Fadeable {
	material: THREE.Material & { opacity: number };
	base: number;
	levels: string[];
}

interface LabelRef {
	el: HTMLElement;
	levels: string[];
	kind: 'level' | 'district';
}

export function createHollowScene(container: HTMLElement, opts: HollowSceneOptions): HollowScene {
	const width = () => container.clientWidth;
	const height = () => container.clientHeight;

	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(width(), height());
	renderer.setClearColor('#05060a');
	container.appendChild(renderer.domElement);

	const labelRenderer = new CSS2DRenderer();
	labelRenderer.setSize(width(), height());
	labelRenderer.domElement.style.position = 'absolute';
	labelRenderer.domElement.style.inset = '0';
	labelRenderer.domElement.style.pointerEvents = 'none';
	container.appendChild(labelRenderer.domElement);

	const scene = new THREE.Scene();
	scene.fog = new THREE.FogExp2('#05060a', 0.0085);

	const camera = new THREE.PerspectiveCamera(42, width() / height(), 0.1, 500);
	const HOME_TARGET = new THREE.Vector3(-2, -14, 0);
	const HOME_OFFSET = new THREE.Vector3(40, 20, 54);
	camera.position.copy(HOME_TARGET).add(HOME_OFFSET);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.target.copy(HOME_TARGET);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minDistance = 10;
	controls.maxDistance = 120;
	controls.maxPolarAngle = Math.PI * 0.95;
	controls.update();

	scene.add(new THREE.AmbientLight('#ffffff', 0.35));
	const key = new THREE.DirectionalLight('#ffffff', 0.9);
	key.position.set(20, 30, 10);
	scene.add(key);

	const glow = glowTexture();
	const fadeables: Fadeable[] = [];
	const labels: LabelRef[] = [];
	const pickables: THREE.Object3D[] = [];
	const movers: { obj: THREE.Object3D; fn: (t: number) => THREE.Vector3 }[] = [];
	const disposables: { dispose: () => void }[] = [glow];

	function track<M extends THREE.Material & { opacity: number }>(material: M, levels: string[]): M {
		material.transparent = true;
		fadeables.push({ material, base: material.opacity, levels });
		disposables.push(material);
		return material;
	}

	function makeLabel(html: string, className: string, levels: string[], kind: LabelRef['kind']) {
		const el = document.createElement('div');
		el.className = className;
		el.innerHTML = html;
		labels.push({ el, levels, kind });
		return new CSS2DObject(el);
	}

	/* ----------------------------------------------------------- depth axis */
	{
		const axisX = -26;
		const bottom = levelY(LEVELS.length - 1) - 2;
		const geo = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(axisX, 1, 0),
			new THREE.Vector3(axisX, bottom, 0)
		]);
		disposables.push(geo);
		const mat = new THREE.LineBasicMaterial({ color: '#334155', transparent: true, opacity: 0.8 });
		disposables.push(mat);
		scene.add(new THREE.Line(geo, mat));
	}

	/* --------------------------------------------------------------- levels */
	const districtMeshes = new Map<string, THREE.Mesh>();
	const flicker: { items: Fadeable[]; seed: number }[] = [];

	for (const level of LEVELS) {
		const y = levelY(level.index);
		const color = levelColor(level);
		const group = new THREE.Group();
		group.position.y = y;
		scene.add(group);

		if (level.index === 0) {
			buildSurface(group, level, color);
		} else {
			const outline = blobOutline(level.rx, level.rz, level.index * 97 + 13);
			const shape = new THREE.Shape(outline);
			const fillGeo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
			disposables.push(fillGeo);
			const fill = new THREE.Mesh(
				fillGeo,
				track(
					new THREE.MeshBasicMaterial({
						color,
						opacity: 0.07 + level.light * 0.05,
						side: THREE.DoubleSide,
						depthWrite: false
					}),
					[level.id]
				)
			);
			fill.userData.pick = { type: 'level', item: level } satisfies Selection;
			fill.userData.isSlab = true;
			group.add(fill);
			pickables.push(fill);

			const pts3 = outline.map((p) => new THREE.Vector3(p.x, 0, p.y));
			const loopGeo = new THREE.BufferGeometry().setFromPoints(pts3);
			disposables.push(loopGeo);
			group.add(
				new THREE.LineLoop(
					loopGeo,
					track(new THREE.LineBasicMaterial({ color, opacity: 0.85 }), [level.id])
				)
			);

			// rock thickness: lower outline + a few struts
			const thick = 0.9;
			const lowGeo = new THREE.BufferGeometry().setFromPoints(
				pts3.map((p) => p.clone().setY(-thick))
			);
			disposables.push(lowGeo);
			group.add(
				new THREE.LineLoop(
					lowGeo,
					track(new THREE.LineBasicMaterial({ color, opacity: 0.25 }), [level.id])
				)
			);
			const struts: THREE.Vector3[] = [];
			pts3.forEach((p, i) => {
				if (i % 6 === 0) struts.push(p, p.clone().setY(-thick));
			});
			const strutGeo = new THREE.BufferGeometry().setFromPoints(struts);
			disposables.push(strutGeo);
			group.add(
				new THREE.LineSegments(
					strutGeo,
					track(new THREE.LineBasicMaterial({ color, opacity: 0.2 }), [level.id])
				)
			);

			// faint inner grid (old survey lines)
			const grid: THREE.Vector3[] = [];
			for (let gx = -level.rx; gx <= level.rx; gx += 2) {
				const span = level.rz * Math.sqrt(Math.max(0, 1 - (gx / level.rx) ** 2)) * 0.92;
				if (span > 0.5)
					grid.push(new THREE.Vector3(gx, 0.01, -span), new THREE.Vector3(gx, 0.01, span));
			}
			for (let gz = -level.rz; gz <= level.rz; gz += 2) {
				const span = level.rx * Math.sqrt(Math.max(0, 1 - (gz / level.rz) ** 2)) * 0.92;
				if (span > 0.5)
					grid.push(new THREE.Vector3(-span, 0.01, gz), new THREE.Vector3(span, 0.01, gz));
			}
			const gridGeo = new THREE.BufferGeometry().setFromPoints(grid);
			disposables.push(gridGeo);
			group.add(
				new THREE.LineSegments(
					gridGeo,
					track(new THREE.LineBasicMaterial({ color, opacity: 0.06 }), [level.id])
				)
			);
		}

		// level label on depth axis
		const tick = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(-26, 0, 0),
			new THREE.Vector3(-24.5, 0, 0)
		]);
		disposables.push(tick);
		group.add(
			new THREE.Line(tick, track(new THREE.LineBasicMaterial({ color, opacity: 0.9 }), [level.id]))
		);
		const lbl = makeLabel(
			`<span class="hl-code" style="color:#${color.getHexString()}">${level.code}</span><span class="hl-name">${level.name}</span><span class="hl-depth">${level.depth}</span>`,
			'hl-level',
			[level.id],
			'level'
		);
		lbl.element.addEventListener('click', () => opts.onSelect({ type: 'level', item: level }));
		lbl.position.set(-26.5, 0, 0);
		lbl.center.set(1, 0.5);
		group.add(lbl);

		// districts
		for (const d of DISTRICTS.filter((d) => d.level === level.id)) {
			const sc = new THREE.Color(STATUS_COLORS[d.status]);
			const geo = districtGeometry(d.kind);
			disposables.push(geo);
			const mat = track(
				new THREE.MeshStandardMaterial({
					color: sc.clone().multiplyScalar(0.35),
					emissive: sc,
					emissiveIntensity: d.status === 'blackout' ? 0.15 : 0.75,
					roughness: 0.6,
					metalness: 0.1,
					opacity: 0.95,
					side: THREE.DoubleSide
				}),
				[level.id]
			);
			const mesh = new THREE.Mesh(geo, mat);
			mesh.position.set(d.x, 0.02, d.z);
			mesh.userData.pick = { type: 'district', item: d } satisfies Selection;
			group.add(mesh);
			pickables.push(mesh);
			districtMeshes.set(d.id, mesh);

			const halo = new THREE.Sprite(
				track(
					new THREE.SpriteMaterial({
						map: glow,
						color: sc,
						opacity: d.status === 'blackout' ? 0.12 : 0.5,
						blending: THREE.AdditiveBlending,
						depthWrite: false
					}),
					[level.id]
				)
			);
			halo.scale.setScalar(d.kind === 'farm' ? 4.5 : 3.6);
			halo.position.set(d.x, 0.5, d.z);
			group.add(halo);

			if (d.status === 'blackout') {
				flicker.push({
					items: fadeables.filter((f) => f.material === mat || f.material === halo.material),
					seed: Math.random() * 100
				});
			}

			const label = makeLabel(d.name, `hl-district hl-${d.status}`, [level.id], 'district');
			label.position.set(d.x, d.kind === 'directorate' ? 3 : 1.9, d.z);
			label.center.set(0.5, 1);
			group.add(label);
		}

		// tunnels
		const levelDistricts = new Map(
			DISTRICTS.filter((d) => d.level === level.id).map((d) => [d.id, d])
		);
		for (const [a, b] of TUNNELS) {
			const da = levelDistricts.get(a);
			const db = levelDistricts.get(b);
			if (!da || !db) continue;
			const start = new THREE.Vector3(da.x, 0.15, da.z);
			const end = new THREE.Vector3(db.x, 0.15, db.z);
			const mid = start.clone().lerp(end, 0.5);
			const perp = new THREE.Vector3(-(end.z - start.z), 0, end.x - start.x).normalize();
			mid.addScaledVector(perp, start.distanceTo(end) * 0.12);
			const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
			const dark = da.status === 'blackout' || db.status === 'blackout';
			const tubeGeo = new THREE.TubeGeometry(curve, 32, level.index === 0 ? 0.05 : 0.14, 6);
			disposables.push(tubeGeo);
			group.add(
				new THREE.Mesh(
					tubeGeo,
					track(
						new THREE.MeshBasicMaterial({
							color: dark ? '#334155' : color,
							opacity: level.index === 0 ? 0.25 : 0.55,
							depthWrite: false
						}),
						[level.id]
					)
				)
			);
			if (!dark && level.index > 0) {
				const dot = new THREE.Sprite(
					track(
						new THREE.SpriteMaterial({
							map: glow,
							color,
							opacity: 0.9,
							blending: THREE.AdditiveBlending,
							depthWrite: false
						}),
						[level.id]
					)
				);
				dot.scale.setScalar(0.7);
				group.add(dot);
				movers.push({
					obj: dot,
					fn: (t) => curve.getPoint((t * 0.12 + a.length * 0.137) % 1)
				});
			}
		}
	}

	/* --------------------------------------------------------------- surface */
	function buildSurface(group: THREE.Group, level: Level, color: THREE.Color) {
		const rand = mulberry32(2087);
		const groundGeo = new THREE.PlaneGeometry(level.rx * 2.4, level.rz * 2.4).rotateX(-Math.PI / 2);
		disposables.push(groundGeo);
		const ground = new THREE.Mesh(
			groundGeo,
			track(
				new THREE.MeshBasicMaterial({
					color: '#2a0f14',
					opacity: 0.55,
					side: THREE.DoubleSide,
					depthWrite: false
				}),
				[level.id]
			)
		);
		ground.userData.pick = { type: 'level', item: level } satisfies Selection;
		ground.userData.isSlab = true;
		group.add(ground);
		pickables.push(ground);

		const grid = new THREE.GridHelper(level.rx * 2.4, 26, color, color);
		const gm = grid.material as THREE.LineBasicMaterial;
		gm.opacity = 0.12;
		track(gm, [level.id]);
		grid.scale.z = level.rz / level.rx;
		grid.position.y = 0.01;
		group.add(grid);

		// ruined towers, clustered around the dead-city POIs
		const centers = DISTRICTS.filter((d) => d.level === level.id);
		const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
		const edgeGeo = new THREE.EdgesGeometry(boxGeo);
		disposables.push(boxGeo, edgeGeo);
		const towerMat = track(new THREE.MeshBasicMaterial({ color: '#12070a', opacity: 0.85 }), [
			level.id
		]);
		const edgeMat = track(new THREE.LineBasicMaterial({ color: '#7f1d2d', opacity: 0.7 }), [
			level.id
		]);
		const litMat = track(new THREE.LineBasicMaterial({ color: '#fb7185', opacity: 0.9 }), [
			level.id
		]);
		for (let i = 0; i < 140; i++) {
			const c = centers[Math.floor(rand() * centers.length)];
			const r = Math.pow(rand(), 0.7) * (c.kind === 'ruin' ? 7 : 4.5);
			const a = rand() * Math.PI * 2;
			const x = c.x + Math.cos(a) * r;
			const z = c.z + Math.sin(a) * r * 0.8;
			if (Math.abs(x) > level.rx * 1.1 || Math.abs(z) > level.rz * 1.1) continue;
			const h = (c.kind === 'ruin' ? 0.6 + rand() * 4.5 : 0.3 + rand() * 1.4) * (1 - r / 9);
			const w = 0.4 + rand() * 0.8;
			const tower = new THREE.Mesh(boxGeo, towerMat);
			tower.scale.set(w, Math.max(0.2, h), w * (0.6 + rand() * 0.8));
			tower.position.set(x, 0, z);
			tower.rotation.y = rand() * 0.3;
			// some towers lean or are broken
			if (rand() < 0.2) tower.rotation.z = (rand() - 0.5) * 0.4;
			const edges = new THREE.LineSegments(edgeGeo, rand() < 0.12 ? litMat : edgeMat);
			tower.add(edges);
			group.add(tower);
		}

		// drifting machine lights
		for (let i = 0; i < 18; i++) {
			const c = centers[i % centers.length];
			const s = new THREE.Sprite(
				track(
					new THREE.SpriteMaterial({
						map: glow,
						color: '#ff2d55',
						opacity: 0.9,
						blending: THREE.AdditiveBlending,
						depthWrite: false
					}),
					[level.id]
				)
			);
			s.scale.setScalar(0.8);
			group.add(s);
			const r = 2 + rand() * 6;
			const speed = 0.1 + rand() * 0.3;
			const phase = rand() * Math.PI * 2;
			const hy = 0.6 + rand() * 3;
			movers.push({
				obj: s,
				fn: (t) =>
					new THREE.Vector3(
						c.x + Math.cos(t * speed + phase) * r,
						hy + Math.sin(t * 1.3 + phase) * 0.3,
						c.z + Math.sin(t * speed * 1.2 + phase) * r * 0.7
					)
			});
		}

		// toxic haze above the surface
		const hazeGeo = new THREE.PlaneGeometry(level.rx * 2.4, level.rz * 2.4).rotateX(-Math.PI / 2);
		disposables.push(hazeGeo);
		for (let i = 1; i <= 3; i++) {
			const haze = new THREE.Mesh(
				hazeGeo,
				track(
					new THREE.MeshBasicMaterial({
						color: '#7c2d12',
						opacity: 0.05,
						side: THREE.DoubleSide,
						depthWrite: false
					}),
					[level.id]
				)
			);
			haze.position.y = i * 1.8;
			group.add(haze);
		}
	}

	/* ---------------------------------------------------------------- shafts */
	for (const shaft of SHAFTS) {
		const a = levelById(shaft.from);
		const b = levelById(shaft.to);
		const yBottom = levelY(Math.max(a.index, b.index)) - 0.9;
		const yTop = levelY(Math.min(a.index, b.index)) + (b.index === 0 ? 0.6 : 0.3);
		const color = new THREE.Color(SHAFT_COLORS[shaft.status]);
		const spanned = LEVELS.filter(
			(l) => l.index >= Math.min(a.index, b.index) && l.index <= Math.max(a.index, b.index)
		).map((l) => l.id);
		const h = yTop - yBottom;

		if (shaft.status === 'sealed') {
			const geo = new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(shaft.x, yBottom, shaft.z),
				new THREE.Vector3(shaft.x, yTop, shaft.z)
			]);
			disposables.push(geo);
			const line = new THREE.Line(
				geo,
				track(
					new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.3, opacity: 0.9 }),
					spanned
				)
			);
			line.computeLineDistances();
			scene.add(line);
			// seal plates
			for (const yy of [yTop - 0.6, yTop - 1.2]) {
				const plateGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.08, 6);
				disposables.push(plateGeo);
				const plate = new THREE.Mesh(
					plateGeo,
					track(new THREE.MeshBasicMaterial({ color, opacity: 0.6 }), spanned)
				);
				plate.position.set(shaft.x, yy, shaft.z);
				scene.add(plate);
			}
		} else {
			const geo = new THREE.CylinderGeometry(0.2, 0.2, h, 10, 1, true);
			disposables.push(geo);
			const tube = new THREE.Mesh(
				geo,
				track(
					new THREE.MeshBasicMaterial({
						color,
						opacity: shaft.status === 'unregistered' ? 0.35 : 0.5,
						depthWrite: false,
						side: THREE.DoubleSide
					}),
					spanned
				)
			);
			tube.position.set(shaft.x, yBottom + h / 2, shaft.z);
			scene.add(tube);

			// pulses travelling through the shaft
			const n = Math.max(2, Math.round(h / 5));
			for (let i = 0; i < n; i++) {
				const p = new THREE.Sprite(
					track(
						new THREE.SpriteMaterial({
							map: glow,
							color,
							opacity: 0.95,
							blending: THREE.AdditiveBlending,
							depthWrite: false
						}),
						spanned
					)
				);
				p.scale.setScalar(0.9);
				scene.add(p);
				const dir = shaft.id === 'air-trunk' ? -1 : i % 2 === 0 ? 1 : -1;
				const speed = 0.08 + (shaft.status === 'open' ? 0.06 : 0);
				movers.push({
					obj: p,
					fn: (t) => {
						let u = (t * speed + i / n) % 1;
						if (dir < 0) u = 1 - u;
						return new THREE.Vector3(shaft.x, yBottom + u * h, shaft.z);
					}
				});
			}
		}

		// checkpoint rings at each level crossing
		if (shaft.status !== 'unregistered') {
			for (const lid of spanned) {
				const ly = levelY(levelById(lid).index);
				const ringGeo = new THREE.TorusGeometry(0.55, 0.06, 6, 20).rotateX(Math.PI / 2);
				disposables.push(ringGeo);
				const ring = new THREE.Mesh(
					ringGeo,
					track(new THREE.MeshBasicMaterial({ color, opacity: 0.9 }), [lid])
				);
				ring.position.set(shaft.x, ly + 0.05, shaft.z);
				scene.add(ring);
			}
		}

		// fat invisible hit target
		const hitGeo = new THREE.CylinderGeometry(0.7, 0.7, h, 8);
		disposables.push(hitGeo);
		const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
		disposables.push(hitMat);
		const hit = new THREE.Mesh(hitGeo, hitMat);
		hit.position.set(shaft.x, yBottom + h / 2, shaft.z);
		hit.userData.pick = { type: 'shaft', item: shaft } satisfies Selection;
		hit.userData.levels = spanned;
		scene.add(hit);
		pickables.push(hit);

		const lbl = makeLabel(shaft.name, `hl-shaft hl-shaft-${shaft.status}`, spanned, 'district');
		lbl.position.set(shaft.x, yTop + 0.3, shaft.z);
		lbl.center.set(0.5, 1);
		scene.add(lbl);
	}

	/* ------------------------------------------------------------------ dust */
	let dust: THREE.Points;
	{
		const rand = mulberry32(7);
		const count = 1400;
		const pos = new Float32Array(count * 3);
		const col = new Float32Array(count * 3);
		const bottom = levelY(LEVELS.length - 1) - 2;
		for (let i = 0; i < count; i++) {
			const y = bottom + rand() * (-bottom + 1);
			pos[i * 3] = (rand() - 0.5) * 40;
			pos[i * 3 + 1] = y;
			pos[i * 3 + 2] = (rand() - 0.5) * 26;
			const t = Math.min(1, Math.max(0, -y / -bottom));
			const c = TOP_COLOR.clone().lerp(DEEP_COLOR, t);
			col.set([c.r, c.g, c.b], i * 3);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
		const mat = new THREE.PointsMaterial({
			size: 0.08,
			vertexColors: true,
			transparent: true,
			opacity: 0.35,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		});
		disposables.push(geo, mat);
		dust = new THREE.Points(geo, mat);
		scene.add(dust);
	}

	/* -------------------------------------------------------- selection ring */
	const selGeo = new THREE.TorusGeometry(1.5, 0.05, 6, 48).rotateX(Math.PI / 2);
	const selMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 });
	disposables.push(selGeo, selMat);
	const selRing = new THREE.Mesh(selGeo, selMat);
	selRing.visible = false;
	scene.add(selRing);

	/* ------------------------------------------------------------ focus/fade */
	let focused: string | null = null;
	const camGoal = {
		target: HOME_TARGET.clone(),
		offset: null as THREE.Vector3 | null,
		active: false
	};

	function applyFade() {
		for (const f of fadeables) {
			const on = !focused || f.levels.includes(focused);
			f.material.opacity = f.base * (on ? 1 : 0.08);
		}
		for (const l of labels) {
			const on = !focused || l.levels.includes(focused);
			l.el.style.opacity = on ? '1' : l.kind === 'level' ? '0.35' : '0';
			l.el.classList.toggle(
				'hl-active',
				!!focused && l.levels.includes(focused) && l.kind === 'level'
			);
		}
		dust.visible = !focused;
	}

	function focusLevel(id: string | null) {
		focused = id;
		applyFade();
		if (id) {
			const lvl = levelById(id);
			camGoal.target.set(0, levelY(lvl.index), 0);
			camGoal.offset = new THREE.Vector3(18, 22, 26);
		} else {
			camGoal.target.copy(HOME_TARGET);
			camGoal.offset = HOME_OFFSET.clone();
		}
		camGoal.active = true;
	}

	function resetView() {
		select(null);
		focusLevel(null);
	}

	let selected: Selection = null;
	function select(sel: Selection) {
		selected = sel;
		if (sel?.type === 'district') {
			const lvl = levelById(sel.item.level);
			selRing.position.set(sel.item.x, levelY(lvl.index) + 0.05, sel.item.z);
			selRing.scale.setScalar(sel.item.kind === 'farm' ? 1.3 : 1);
			selRing.visible = true;
		} else if (sel?.type === 'shaft') {
			selRing.visible = false;
		} else {
			selRing.visible = false;
		}
	}

	/* ------------------------------------------------------------- picking */
	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	let hovered: THREE.Object3D | null = null;

	function pick(ev: PointerEvent): THREE.Object3D | null {
		const rect = renderer.domElement.getBoundingClientRect();
		pointer.set(
			((ev.clientX - rect.left) / rect.width) * 2 - 1,
			-((ev.clientY - rect.top) / rect.height) * 2 + 1
		);
		raycaster.setFromCamera(pointer, camera);
		const hits = raycaster.intersectObjects(pickables, false).filter((h) => {
			const p = h.object.userData.pick as Selection;
			if (!p || !focused) return true;
			if (p.type === 'district') return p.item.level === focused;
			if (p.type === 'level') return p.item.id === focused;
			return (h.object.userData.levels as string[]).includes(focused);
		});
		// objects beat slabs
		const obj = hits.find((h) => !h.object.userData.isSlab) ?? hits[0];
		return obj?.object ?? null;
	}

	function setHover(obj: THREE.Object3D | null) {
		if (obj === hovered) return;
		if (hovered && districtMeshesHas(hovered)) hovered.scale.setScalar(1);
		hovered = obj;
		if (hovered && districtMeshesHas(hovered)) hovered.scale.setScalar(1.25);
		renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
		opts.onHover?.((hovered?.userData.pick as Selection) ?? null);
	}
	const districtMeshesHas = (o: THREE.Object3D) =>
		(o.userData.pick as Selection)?.type === 'district';

	let downAt: { x: number; y: number } | null = null;
	const onMove = (ev: PointerEvent) => {
		if (ev.buttons) return;
		setHover(pick(ev));
	};
	const onDown = (ev: PointerEvent) => {
		downAt = { x: ev.clientX, y: ev.clientY };
		camGoal.active = false;
	};
	const onUp = (ev: PointerEvent) => {
		if (!downAt) return;
		const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
		downAt = null;
		if (moved > 5) return;
		const obj = pick(ev);
		opts.onSelect((obj?.userData.pick as Selection) ?? null);
	};
	const onWheel = () => (camGoal.active = false);
	renderer.domElement.addEventListener('pointermove', onMove);
	renderer.domElement.addEventListener('pointerdown', onDown);
	renderer.domElement.addEventListener('pointerup', onUp);
	renderer.domElement.addEventListener('wheel', onWheel, { passive: true });
	renderer.domElement.style.cursor = 'grab';

	/* -------------------------------------------------------------- resize */
	const ro = new ResizeObserver(() => {
		const w = width();
		const h = height();
		if (!w || !h) return;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h);
		labelRenderer.setSize(w, h);
	});
	ro.observe(container);

	/* ---------------------------------------------------------------- loop */
	const timer = new THREE.Timer();
	let raf = 0;
	const tmp = new THREE.Vector3();
	function frame() {
		raf = requestAnimationFrame(frame);
		timer.update();
		const t = timer.getElapsed();

		for (const m of movers) m.obj.position.copy(m.fn(t));

		for (const f of flicker) {
			const on = Math.sin(t * 7 + f.seed) + Math.sin(t * 13.3 + f.seed * 2) > 1.4;
			for (const it of f.items) {
				const dim = focused && !it.levels.includes(focused) ? 0.08 : 1;
				it.material.opacity = Math.min(1, it.base * dim * (on ? 3 : 1));
			}
		}

		dust.rotation.y = t * 0.01;

		if (selRing.visible) {
			selRing.rotation.y = t * 0.8;
			const s =
				(selected?.type === 'district' && selected.item.kind === 'farm' ? 1.3 : 1) *
				(1 + Math.sin(t * 3) * 0.05);
			selRing.scale.setScalar(s);
		}

		if (camGoal.active) {
			const d = tmp.copy(camGoal.target).sub(controls.target).multiplyScalar(0.07);
			controls.target.add(d);
			camera.position.add(d);
			if (camGoal.offset) {
				const desired = camGoal.target.clone().add(camGoal.offset);
				camera.position.lerp(desired, 0.05);
			}
			if (
				controls.target.distanceTo(camGoal.target) < 0.02 &&
				(!camGoal.offset ||
					camera.position.distanceTo(camGoal.target.clone().add(camGoal.offset)) < 0.05)
			)
				camGoal.active = false;
		}

		controls.update();
		renderer.render(scene, camera);
		labelRenderer.render(scene, camera);
	}
	applyFade();
	frame();

	return {
		focusLevel,
		select,
		resetView,
		dispose() {
			cancelAnimationFrame(raf);
			timer.dispose();
			ro.disconnect();
			renderer.domElement.removeEventListener('pointermove', onMove);
			renderer.domElement.removeEventListener('pointerdown', onDown);
			renderer.domElement.removeEventListener('pointerup', onUp);
			renderer.domElement.removeEventListener('wheel', onWheel);
			controls.dispose();
			for (const d of disposables) d.dispose();
			renderer.dispose();
			renderer.domElement.remove();
			labelRenderer.domElement.remove();
		}
	};
}
