import type { MapLens } from '#lib/hollow/mapStyle.js';
import type { AlertKind } from '#lib/hollow/alerts.js';

/** UI state shared between the sidebar and the map. */
export const home = $state({
	/** The open sidebar section ('' when all are closed). Only one can be open at a time. */
	section: '',
	/** Level shown on the map (mirrored from the map view). */
	level: 0,
	/** True while every level is stacked at its depth. */
	overview: false,
	/** Alerts card filter: one kind, or null for all of them. */
	alertFilter: null as AlertKind | null
});

/** The map lens for the open section (the alerts card narrows by its filter). */
export const lensFor = (section: string, filter: AlertKind | null): MapLens | null =>
	section === 'alerts' && filter ? `alerts-${filter}` : (SECTION_LENS[section] ?? null);

/** Sidebar sections that repaint the map while they are open. */
export const SECTION_LENS: Record<string, MapLens> = {
	sickness: 'sickness',
	alerts: 'alerts'
};

interface MapNav {
	goTo(index: number): void;
	setOverview(on: boolean): void;
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
	focus: (level, x, y) => nav?.focus(level, x, y),
	crew: (at) => nav?.crew(at),
	refresh: () => nav?.refresh()
};
