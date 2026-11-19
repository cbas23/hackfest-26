import { mutation, query } from './_generated/server';
import { sicknessSettings } from './model';

/** The sickness settings, or null before anyone set them (the map then uses its defaults). */
export const get = query({
	args: {},
	handler: (ctx) => ctx.db.query('sickness').first()
});

/** Replace the settings (there is only ever one document). */
export const set = mutation({
	args: sicknessSettings,
	handler: async (ctx, settings) => {
		const doc = await ctx.db.query('sickness').first();
		if (doc) await ctx.db.replace(doc._id, settings);
		else await ctx.db.insert('sickness', settings);
	}
});
