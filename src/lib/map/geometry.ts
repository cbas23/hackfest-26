import * as THREE from 'three';
import type { Point } from '#lib/tunnels/generate.js';
import { hash01 } from '#lib/random.js';

export type V3 = [number, number, number];
export type Dir = 'n' | 's' | 'w' | 'e';

/** The four tile neighbours: face, dx, dy. */
export const SIDES: [Dir, number, number][] = [
	['n', 0, -1],
	['s', 0, 1],
	['w', -1, 0],
	['e', 1, 0]
];

export const toColor = (c: THREE.ColorRepresentation) =>
	c instanceof THREE.Color ? c : new THREE.Color(c);

/** Built faces as compact typed arrays: cloneable, and transferable out of a worker. */
export interface MeshArrays {
	position: Float32Array;
	/** Unit normals scaled to ±127 (normalized). */
	normal: Int8Array;
	/** Linear colours scaled to 0–65535 (normalized; 8 bits would band the dark tones). */
	color: Uint16Array;
	index: Uint16Array | Uint32Array;
	/** Bounding sphere, so the renderer never has to walk the vertices for it. */
	sphere: [number, number, number, number];
}

/**
 * Accumulates flat-shaded, vertex-coloured quads into one indexed geometry: four
 * vertices and two triangles per quad.
 */
export class Builder {
	private pos: number[] = [];
	private nor: number[] = [];
	private col: number[] = [];
	private idx: number[] = [];
	/** Added to every vertex height, to draw a whole object raised or sunk. */
	lift = 0;

	get empty() {
		return this.pos.length === 0;
	}

	/**
	 * Counter-clockwise quad (front face toward `n`); `flip` turns it to face the other way.
	 * `color` is one colour or one per corner (a, b, c, d).
	 */
	private quad(
		a: V3,
		b: V3,
		c: V3,
		d: V3,
		n: V3,
		color: THREE.Color | THREE.Color[],
		flip = false
	) {
		const base = this.pos.length / 3;
		const s = flip ? -1 : 1;
		const pts = [a, b, c, d];
		for (let i = 0; i < 4; i++) {
			const p = pts[i];
			const k = Array.isArray(color) ? color[i] : color;
			this.pos.push(p[0], p[1] + this.lift, p[2]);
			this.nor.push(n[0] * s, n[1] * s, n[2] * s);
			this.col.push(k.r, k.g, k.b);
		}
		if (flip) this.idx.push(base + 3, base + 2, base + 1, base + 3, base + 1, base);
		else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}

	/** Horizontal face at height y, facing up (or down when `flip`). */
	top(x0: number, z0: number, x1: number, z1: number, y: number, c: THREE.Color, flip = false) {
		this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], c, flip);
	}

	/**
	 * Vertical face on side `dir` of the cell [x0,x1]×[z0,z1]. Faces outward by default;
	 * `inward` makes it face into the cell.
	 */
	side(
		dir: Dir,
		x0: number,
		z0: number,
		x1: number,
		z1: number,
		y0: number,
		y1: number,
		c: THREE.Color,
		inward = false,
		bottom = c
	) {
		// Every variant lists its corners bottom, top, top, bottom.
		const cs = [bottom, c, c, bottom];
		if (dir === 'n')
			this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], cs, inward);
		else if (dir === 's')
			this.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1], cs, inward);
		else if (dir === 'w')
			this.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0], cs, inward);
		else this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], cs, inward);
	}

	/** A solid box standing in the air. */
	box(
		x0: number,
		z0: number,
		x1: number,
		z1: number,
		y0: number,
		y1: number,
		wall: THREE.Color,
		roof = wall
	) {
		for (const d of ['n', 's', 'w', 'e'] as const) this.side(d, x0, z0, x1, z1, y0, y1, wall);
		this.top(x0, z0, x1, z1, y1, roof);
	}

	arrays(): MeshArrays {
		const { pos, nor, col, idx } = this;
		const n = pos.length / 3;
		const position = new Float32Array(pos.length);
		const normal = new Int8Array(nor.length);
		const color = new Uint16Array(col.length);
		let minX = Infinity,
			minY = Infinity,
			minZ = Infinity,
			maxX = -Infinity,
			maxY = -Infinity,
			maxZ = -Infinity;
		for (let i = 0; i < pos.length; i += 3) {
			const x = (position[i] = pos[i]);
			const y = (position[i + 1] = pos[i + 1]);
			const z = (position[i + 2] = pos[i + 2]);
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}
		for (let i = 0; i < nor.length; i++) normal[i] = Math.round(nor[i] * 127);
		for (let i = 0; i < col.length; i++) {
			const c = col[i];
			color[i] = c >= 1 ? 65535 : c <= 0 ? 0 : (c * 65535 + 0.5) | 0;
		}
		// Centre of the box, and its half-diagonal as the radius (a snug enough bound).
		const sphere: MeshArrays['sphere'] = n
			? [
					(minX + maxX) / 2,
					(minY + maxY) / 2,
					(minZ + maxZ) / 2,
					Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2
				]
			: [0, 0, 0, 0];
		const index = n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
		return { position, normal, color, index, sphere };
	}

	build() {
		return toGeometry(this.arrays());
	}
}

/** Wrap built arrays in a geometry (no copy, bounds included). */
export function toGeometry(a: MeshArrays) {
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3, true));
	g.setAttribute('color', new THREE.BufferAttribute(a.color, 3, true));
	g.setIndex(new THREE.BufferAttribute(a.index, 1));
	const [x, y, z, r] = a.sphere;
	g.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y, z), r);
	return g;
}

export { hash01 };

/** Brightness jitter, so faces read as individual blocks. */
export const shade = (c: THREE.Color, seed: number, amount = 0.1) =>
	amount ? c.clone().multiplyScalar(1 - amount / 2 + hash01(seed) * amount) : c.clone();

/** A path reduced to its turning points. */
export function corners(path: Point[]) {
	if (path.length < 3) return path;
	const out = [path[0]];
	for (let i = 1; i < path.length - 1; i++) {
		const a = path[i - 1];
		const b = path[i];
		const c = path[i + 1];
		if (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y) out.push(b);
	}
	out.push(path[path.length - 1]);
	return out;
}

export function disposeTree(root: THREE.Object3D) {
	root.traverse((o) => {
		const m = o as THREE.Mesh;
		m.geometry?.dispose();
		const mat = m.material;
		if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
		else mat?.dispose();
	});
}
