import type { MapLens } from '#lib/hollow/mapStyle.js';
import type { AlertKind } from '#lib/hollow/alerts.js';
import type { Place } from '#lib/hollow/nav.js';

/** Ids of the sidebar's data-layer cards (see `LAYERS` in app-sidebar.svelte). */
export type LayerId = 'alerts' | 'sickness' | 'water' | 'airflow' | 'tunnels';

/** UI state shared between the sidebar and the map. */
export const home = $state({
	/** The open data-layer card ('' when all are closed). Only one can be open at a time. */
	section: '' as LayerId | '',
	/** Level shown on the map (mirrored from the map view). */
	level: 0,
	/** True while every level is stacked at its depth. */
	overview: false,
	/** Alerts card filter: one kind, or null for all of them. */
	alertFilter: null as AlertKind | null,
	/** The viewer's home block, as a place key ("<level>:<roomId>"); saved in this browser. */
	address: loadAddress(),
	/** True while the next click on the map sets the home block. */
	pickingHome: false
});

const ADDRESS_KEY = 'hollow.home';

function loadAddress(): string | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage.getItem(ADDRESS_KEY);
	} catch {
		return null;
	}
}

/** Set (or clear) the home block and remember it in this browser. */
export function setAddress(key: string | null) {
	home.address = key;
	home.pickingHome = false;
	try {
		if (key) localStorage.setItem(ADDRESS_KEY, key);
		else localStorage.removeItem(ADDRESS_KEY);
	} catch {
		// Storage can be blocked (private windows); the address still holds for this visit.
	}
}

/** How each data-layer card repaints the map while it is open (null: it doesn't). */
export const SECTION_LENS: Record<LayerId, MapLens | null> = {
	alerts: 'alerts',
	sickness: 'sickness',
	water: 'water',
	airflow: 'airflow',
	tunnels: 'tunnels'
};

/** The lens of the open card, if any (the alerts card narrows it by its filter). */
export const openLens = (): MapLens | null =>
	home.section === 'alerts' && home.alertFilter
		? `alerts-${home.alertFilter}`
		: home.section
			? SECTION_LENS[home.section]
			: null;

interface MapNav {
	goTo(index: number): void;
	setOverview(on: boolean): void;
	/** Go to a place's level, select it and fly the camera to it. */
	focusPlace(place: Place): void;
	/** Go to a level and fly the camera to a tile point on it. */
	focus(level: number, x: number, y: number): void;
	/** Show (or clear) a repair crew working at a tile point. */
	crew(at: { level: number; x: number; y: number } | null): void;
	/** Repaint the map after the data behind the lens changed. */
	refresh(): void;
}

let nav: MapNav | null = null;
/** The map view registers its navigation here so the sidebar can drive it. */
export const registerMapNav = (n: MapNav | null) => {
	nav = n;
};
export const mapNav: MapNav = {
	goTo: (index) => nav?.goTo(index),
	setOverview: (on) => nav?.setOverview(on),
	focusPlace: (place) => nav?.focusPlace(place),
	focus: (level, x, y) => nav?.focus(level, x, y),
	crew: (at) => nav?.crew(at),
	refresh: () => nav?.refresh()
};
