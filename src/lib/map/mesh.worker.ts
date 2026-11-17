/** Builds layer meshes off the main thread; see `mesher.ts`. */
import { buildMeshes, transferables, type FlatGrid, type MeshInput } from './mesh.js';

/** A request; `grid` carries only its id once the worker has that grid. */
export interface MeshRequest {
	id: number;
	input: Omit<MeshInput, 'grid'> & { grid: FlatGrid | { id: number } };
}

const scope = self as unknown as {
	onmessage: ((e: MessageEvent<MeshRequest>) => void) | null;
	postMessage(message: unknown, transfer: Transferable[]): void;
};

const grids = new Map<number, FlatGrid>();

scope.onmessage = (e) => {
	const { id, input } = e.data;
	if ('road' in input.grid) grids.set(input.grid.id, input.grid);
	const grid = grids.get(input.grid.id);
	if (!grid) throw new Error(`Unknown grid ${input.grid.id}`);
	const out = buildMeshes({ ...input, grid });
	scope.postMessage({ id, out }, transferables(out));
};
