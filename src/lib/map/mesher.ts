/**
 * Runs `buildMeshes` in a shared Web Worker so building a layer never blocks the UI.
 * Requests are served in order. Without worker support (or if the worker fails) it
 * falls back to building on the main thread.
 */
import { buildMeshes, type MeshInput, type MeshOutput } from './mesh.js';
import type { MeshRequest } from './mesh.worker.js';

interface Pending {
	input: MeshInput;
	resolve: (out: MeshOutput) => void;
}

let worker: Worker | null | undefined;
const pending = new Map<number, Pending>();
/** Grids the worker already holds: they are sent once, then referred to by id. */
const sentGrids = new Set<number>();
let nextId = 0;

function fallBack() {
	worker?.terminate();
	worker = null;
	for (const [id, p] of pending) {
		pending.delete(id);
		p.resolve(buildMeshes(p.input));
	}
}

function getWorker() {
	if (worker !== undefined) return worker;
	try {
		worker = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (e: MessageEvent<{ id: number; out: MeshOutput }>) => {
			const p = pending.get(e.data.id);
			pending.delete(e.data.id);
			p?.resolve(e.data.out);
		};
		worker.onerror = fallBack;
	} catch {
		worker = null;
	}
	return worker;
}

/** Build a layer's meshes off the main thread. */
export function meshAsync(input: MeshInput): Promise<MeshOutput> {
	const w = getWorker();
	if (!w) return Promise.resolve(buildMeshes(input));
	return new Promise((resolve) => {
		const id = nextId++;
		pending.set(id, { input, resolve });
		const { grid } = input;
		const req: MeshRequest = {
			id,
			input: { ...input, grid: sentGrids.has(grid.id) ? { id: grid.id } : grid }
		};
		sentGrids.add(grid.id);
		w.postMessage(req);
	});
}
