/** Keyboard control of the map: held keys pan, single keys run actions. */

export interface MapKeyActions {
	/** Pan direction from the held keys, each axis -1, 0 or 1. */
	pan(x: number, y: number): void;
	/** One level deeper (+1) or shallower (-1). */
	step(delta: number): void;
	/** A level by index (the number keys). */
	goTo(index: number): void;
	zoom(factor: number): void;
	north(): void;
	fit(): void;
	toggleOverview(): void;
	escape(): void;
}

/** Zoom factor of one zoom step (keys and buttons). */
export const ZOOM_STEP = 1.5;

/** The hints shown on the map. */
export const KEY_HINTS: [keys: string[], action: string][] = [
	[['Drag'], 'pan'],
	[['Right-drag'], 'rotate'],
	[['Scroll'], 'zoom'],
	[['Q', 'E'], 'change level'],
	[['O'], 'all levels'],
	[['F'], 'fit level']
];

const PAN_KEYS: Record<string, [number, number]> = {
	arrowleft: [-1, 0],
	a: [-1, 0],
	arrowright: [1, 0],
	d: [1, 0],
	arrowup: [0, -1],
	w: [0, -1],
	arrowdown: [0, 1],
	s: [0, 1]
};

/**
 * Listen on the window, but only steer the map while focus is on the page itself or inside
 * `scope` (not in the sidebar or another widget). `levels` is how many number keys jump to
 * a level. Returns the cleanup.
 */
export function bindMapKeys(scope: HTMLElement, levels: number, act: MapKeyActions) {
	const held = new Set<string>();
	const syncPan = () => {
		let x = 0;
		let y = 0;
		for (const k of held) {
			x += PAN_KEYS[k][0];
			y += PAN_KEYS[k][1];
		}
		act.pan(Math.sign(x), Math.sign(y));
	};
	const forMap = (e: KeyboardEvent) =>
		!(e.metaKey || e.ctrlKey || e.altKey) &&
		(e.target === document.body || (e.target instanceof Node && scope.contains(e.target)));

	const onKeyDown = (e: KeyboardEvent) => {
		if (!forMap(e)) return;
		const k = e.key.toLowerCase();
		if (k in PAN_KEYS) {
			held.add(k);
			syncPan();
			e.preventDefault();
		} else if (k === 'pagedown' || k === 'e' || k === ']') act.step(1);
		else if (k === 'pageup' || k === 'q' || k === '[') act.step(-1);
		else if (k >= '1' && k <= String(levels)) act.goTo(+k - 1);
		else if (k === '+' || k === '=') act.zoom(ZOOM_STEP);
		else if (k === '-' || k === '_') act.zoom(1 / ZOOM_STEP);
		else if (k === 'n') act.north();
		else if (k === 'f') act.fit();
		else if (k === 'o') act.toggleOverview();
		else if (k === 'escape') act.escape();
		else return;
		if (k.startsWith('page')) e.preventDefault();
	};
	const onKeyUp = (e: KeyboardEvent) => {
		if (held.delete(e.key.toLowerCase())) syncPan();
	};
	const onBlur = () => {
		held.clear();
		syncPan();
	};
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', onBlur);
	return () => {
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);
		window.removeEventListener('blur', onBlur);
	};
}
