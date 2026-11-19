import type { MapLens } from '#lib/hollow/mapStyle.js';

/** Ids of the sidebar's data-layer cards (see `LAYERS` in app-sidebar.svelte). */
export type LayerId = 'sickness';

/** UI state shared between the sidebar and the map. */
export const home = $state({
	/** The open data-layer card ('' when all are closed). Only one can be open at a time. */
	section: '' as LayerId | '',
	/** Level shown on the map (mirrored from the map view). */
	level: 0,
	/** True while every level is stacked at its depth. */
	overview: false
});

/** How each data-layer card repaints the map while it is open (null: it doesn't). */
export const SECTION_LENS: Record<LayerId, MapLens | null> = {
	sickness: 'sickness'
};

/** The lens of the open card, if any. */
export const openLens = () => (home.section ? SECTION_LENS[home.section] : null);

interface MapNav {
	goTo(index: number): void;
	setOverview(on: boolean): void;
}

let nav: MapNav | null = null;
/** The map view registers its navigation here so the sidebar can drive it. */
export const registerMapNav = (n: MapNav | null) => {
	nav = n;
};
export const mapNav: MapNav = {
	goTo: (index) => nav?.goTo(index),
	setOverview: (on) => nav?.setOverview(on)
};
