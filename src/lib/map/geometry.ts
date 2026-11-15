import * as THREE from 'three';
import type { Point } from '#lib/tunnels/generate.js';

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

/** Accumulates flat-shaded, vertex-coloured quads into one BufferGeometry. */
export class Builder {
	private pos: number[] = [];
	private nor: number[] = [];
	private col: number[] = [];
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
		const cs = Array.isArray(color) ? color : [color, color, color, color];
		const order = flip ? [3, 2, 1, 3, 1, 0] : [0, 1, 2, 0, 2, 3];
		const pts = [a, b, c, d];
		for (const i of order) {
			const p = pts[i];
			this.pos.push(p[0], p[1] + this.lift, p[2]);
			if (flip) this.nor.push(-n[0], -n[1], -n[2]);
			else this.nor.push(n[0], n[1], n[2]);
			this.col.push(cs[i].r, cs[i].g, cs[i].b);
		}
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

	build() {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
		g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
		g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
		return g;
	}
}

export const hash01 = (n: number) => {
	let h = Math.imul(n + 0x9e3779b9, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
};

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
