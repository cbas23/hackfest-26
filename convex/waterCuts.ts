import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { waterEvent, checkFacility, checkLevel } from './model';

export const list = query({
	args: {},
	handler: (ctx) => ctx.db.query('waterCuts').collect()
});

export const add = mutation({
	args: waterEvent.omit('resolvedAt'),
	handler: (ctx, args) => {
		checkLevel(args.level);
		checkFacility(args.level, args.facility);
		return ctx.db.insert('waterCuts', args);
	}
});

export const update = mutation({
	args: {
		id: v.id('waterCuts'),
		patch: waterEvent.pick('metric', 'severity', 'value', 'note').partial()
	},
	handler: async (ctx, { id, patch }) => {
		// A new severity drops the old exact reading, so the value follows the severity.
		const value = patch.severity && patch.value === undefined ? { value: undefined } : {};
		await ctx.db.patch(id, { ...patch, ...value });
	}
});
