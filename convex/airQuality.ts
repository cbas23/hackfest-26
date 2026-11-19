import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { airEvent, checkFacility, checkLevel } from './model';

export const list = query({
	args: {},
	handler: (ctx) => ctx.db.query('airQuality').collect()
});

export const add = mutation({
	args: airEvent.omit('resolvedAt'),
	handler: (ctx, args) => {
		checkLevel(args.level);
		checkFacility(args.level, args.facility);
		return ctx.db.insert('airQuality', args);
	}
});

export const update = mutation({
	args: {
		id: v.id('airQuality'),
		patch: airEvent.pick('metric', 'severity', 'value', 'note').partial()
	},
	handler: async (ctx, { id, patch }) => {
		// A new severity drops the old exact reading, so the value follows the severity.
		const value = patch.severity && patch.value === undefined ? { value: undefined } : {};
		await ctx.db.patch(id, { ...patch, ...value });
	}
});
