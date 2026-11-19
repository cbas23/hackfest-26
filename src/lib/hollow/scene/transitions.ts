/**
 * The veil animations between views. A level change slides the old level away under a
 * veil and the new one in from the other side; switching to or from the stacked view is a
 * plain veil dip that swaps the layout while the veil is fully closed. Both advance by
 * wall-clock time, so slow frames can't stretch them, and a new request mid-way picks up
 * from wherever the veil is.
 */
import type { MapLayer, TunnelMapView } from '#lib/map/index.js';

const OUT_MS = 170;
const IN_MS = 280;
/** How far a level slides during the change, in blocks. */
const SLIDE = 12;

const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

interface Slide {
	from: MapLayer | null;
	to: MapLayer;
	dir: number;
	start: number;
}

interface Dip {
	/** The layout this dip lands on, applied while the veil is fully closed. */
	stacked: boolean;
	apply: () => void;
	start: number;
	applied: boolean;
}

export type Transitions = ReturnType<typeof createTransitions>;

/** `notify(true)` when an animation starts, `notify(false)` when the scene settles. */
export function createTransitions(map: TunnelMapView, notify: (active: boolean) => void) {
	let slide: Slide | null = null;
	let dip: Dip | null = null;
	let veil = 0;

	const showOnly = (only: MapLayer | null) => {
		for (const l of map.layers()) l.set({ visible: l === only });
	};
	/** The out phase eases with t², so invert that to resume at the current veil level. */
	const resumeAt = (now: number) => now - Math.sqrt(veil) * OUT_MS;

	const stepSlide = (now: number) => {
		if (!slide) return;
		const { from, to, dir } = slide;
		const t = now - slide.start;
		const outMs = from ? OUT_MS : 0;
		if (from && t < outMs) {
			// Out: the level you're leaving slides away (up when going deeper) as the veil closes.
			const p = easeIn(t / outMs);
			showOnly(from);
			from.set({ y: dir * SLIDE * p });
			veil = p;
		} else {
			// In: the new level slides into place from the other side as the veil lifts.
			const p = Math.min(1, (t - outMs) / IN_MS);
			const e = easeOut(p);
			showOnly(to);
			from?.set({ y: 0 });
			to.set({ y: -dir * SLIDE * (1 - e) });
			veil = from ? 1 - e : 0;
			if (p >= 1) {
				slide = null;
				veil = 0;
				notify(false);
			}
		}
		map.setVeil(veil);
	};

	const stepDip = (now: number) => {
		if (!dip) return;
		const t = now - dip.start;
		if (t < OUT_MS) veil = easeIn(t / OUT_MS);
		else {
			if (!dip.applied) {
				dip.apply();
				dip.applied = true;
			}
			const p = Math.min(1, (t - OUT_MS) / IN_MS);
			veil = 1 - easeOut(p);
			if (p >= 1) {
				dip = null;
				veil = 0;
				notify(false);
			}
		}
		map.setVeil(veil);
	};

	return {
		showOnly,
		/** A level slide is running. */
		get sliding() {
			return slide !== null;
		},
		/** The layout a dip is about to swap to under its closing veil, or null if none is. */
		pendingLayout(): boolean | null {
			return dip && !dip.applied ? dip.stacked : null;
		},
		/** Dip the veil and run `apply` while it is closed, landing on the `stacked` layout. */
		dip(stacked: boolean, apply: () => void) {
			// Finish any level slide first so the two animations never fight.
			if (slide) {
				showOnly(slide.to);
				slide.to.set({ y: 0 });
				slide = null;
			}
			// A dip whose veil is still closing just retargets: the newest request wins.
			if (dip && !dip.applied) Object.assign(dip, { stacked, apply });
			else dip = { stacked, apply, start: resumeAt(performance.now()), applied: false };
			notify(true);
		},
		/** Show `layer` at once, dropping whatever is running. */
		jump(layer: MapLayer) {
			const busy = !!(slide || dip);
			slide = null;
			dip = null;
			showOnly(layer);
			layer.set({ y: 0 });
			veil = 0;
			map.setVeil(0);
			if (busy) notify(false);
		},
		/** Slide from whatever is on screen to `layer`; `dir` > 0 is going deeper. */
		slide(layer: MapLayer, dir: number) {
			// Any dip left is lifting off a single level; the slide takes over its veil.
			dip = null;
			// Whatever is on screen now is what slides away, starting where the veil is, so
			// changing level again mid-change stays smooth.
			const visible = slide
				? veil > 0 && slide.from?.visible
					? slide.from
					: slide.to
				: (map.layers().find((l) => l.visible && l !== layer) ?? null);
			const now = performance.now();
			slide = {
				from: visible && visible !== layer ? visible : null,
				to: layer,
				dir: Math.sign(dir),
				start: resumeAt(now)
			};
			slide.from?.set({ y: dir * SLIDE * veil });
			notify(true);
			stepSlide(now);
		},
		step(now: number) {
			stepSlide(now);
			stepDip(now);
		}
	};
}
