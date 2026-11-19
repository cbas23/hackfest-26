import { HOLLOW_SEED } from '#lib/hollow/data.js';
import { createHollow } from '#lib/hollow/world.js';

/** The one Hollow the Main Map shows, shared by the map and the sidebar. Browser only. */
export const hollow = createHollow(HOLLOW_SEED);
