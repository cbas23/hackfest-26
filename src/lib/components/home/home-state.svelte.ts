import type { MapLens } from '#lib/hollow/mapStyle.js';

/** UI state shared between the sidebar and the map. */
export const home = $state({
	/** The open sidebar section ('' when all are closed). Only one can be open at a time. */
	section: ''
});

/** Sidebar sections that repaint the map while they are open. */
export const SECTION_LENS: Record<string, MapLens> = {
	'item-2': 'sickness'
};
