/**
 * The theme's CSS variables (`src/routes/layout.css`) as three.js colours, so the 3D map is
 * painted from the same palette as the UI around it. The map reads the `--map-*` variables,
 * which are themselves mixed from the shadcn tokens; tweak them in CSS, not here.
 *
 * Values are resolved by the browser (so `oklch()`, `color-mix()` and nested `var()` all
 * work) and cached until the theme changes. Browser only.
 */
import * as THREE from 'three';

export type Token =
	| 'background'
	| 'foreground'
	| 'map-background'
	| 'map-tunnel'
	| 'map-tunnel-wall'
	| 'map-room-wall'
	| 'map-room-roof'
	| 'map-room-dark-wall'
	| 'map-room-dark-roof'
	| 'map-farm-wall'
	| 'map-farm-roof'
	| 'map-crop'
	| 'map-plant-wall'
	| 'map-plant-roof'
	| 'map-plant-core'
	| 'map-warm'
	| 'map-shaft'
	| 'map-well'
	| 'map-muted-wall'
	| 'map-muted-roof'
	| 'map-lens-tunnel'
	| `map-sick-${1 | 2 | 3 | 4 | 5}`
	| 'map-alert-dark-roof'
	| 'map-alert-dark-wall'
	| `map-alert-${'air' | 'water'}-${1 | 2 | 3}`
	| 'map-route'
	| 'map-route-border'
	| 'map-route-dim'
	| 'map-highlight'
	| 'map-radar'
	| 'map-light-sky'
	| 'map-light-ground';

const cache = new Map<Token, string>();
let probe: HTMLElement | null = null;
let paint: CanvasRenderingContext2D | null = null;

/** Resolve a CSS variable to `#rrggbb`: let CSS compute it, then paint it to read sRGB back. */
function resolve(name: Token): string {
	if (!probe) {
		probe = document.createElement('span');
		probe.style.display = 'none';
		probe.setAttribute('aria-hidden', 'true');
	}
	// Re-attach each time: the body may have been replaced since the last read.
	if (!probe.isConnected) document.body.appendChild(probe);
	probe.style.color = '';
	probe.style.color = `var(--${name}, #000)`;
	const css = getComputedStyle(probe).color;
	paint ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext(
		'2d',
		{ willReadFrequently: true }
	)!;
	paint.clearRect(0, 0, 1, 1);
	paint.fillStyle = '#000';
	paint.fillStyle = css;
	paint.fillRect(0, 0, 1, 1);
	const [r, g, b] = paint.getImageData(0, 0, 1, 1).data;
	return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** A theme variable as `#rrggbb`. */
export function tokenHex(name: Token): string {
	let hex = cache.get(name);
	if (!hex) cache.set(name, (hex = resolve(name)));
	return hex;
}

/** A theme variable as a fresh three.js colour (safe to mutate). */
export const token = (name: Token) => new THREE.Color(tokenHex(name));

/** Two theme variables blended: `t` = 0 is `a`, 1 is `b`. */
export const blend = (a: Token, b: Token, t: number) => token(a).lerp(token(b), t);

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
let pending = 0;
/** Last resolved palette, to skip notifying when a mutation changed nothing visible. */
let signature = '';
const sample: Token[] = ['background', 'foreground', 'map-tunnel', 'map-room-roof', 'map-route'];

function check() {
	pending = 0;
	cache.clear();
	const next = sample.map(tokenHex).join();
	if (next === signature) return;
	signature = next;
	for (const fn of listeners) fn();
}

/**
 * Call `fn` whenever the theme changes: a `.dark` toggle, inline variables on `<html>`, or a
 * stylesheet swapped in `<head>` (e.g. a live theme editor). Returns the unsubscribe.
 */
export function onThemeChange(fn: () => void): () => void {
	listeners.add(fn);
	if (!observer) {
		signature = sample.map(tokenHex).join();
		observer = new MutationObserver(() => (pending ||= requestAnimationFrame(check)));
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class', 'style', 'data-theme']
		});
		observer.observe(document.head, { childList: true, subtree: true, characterData: true });
	}
	return () => {
		listeners.delete(fn);
		if (listeners.size || !observer) return;
		observer.disconnect();
		observer = null;
		if (pending) cancelAnimationFrame(pending);
		pending = 0;
	};
}
