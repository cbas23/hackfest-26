import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { blackout, checkLevel, checkRadius } from './model';

export const list = query({
	args: {},
	handler: (ctx) => ctx.db.query('blackouts').collect()
});

export const add = mutation({
	args: blackout.omit('resolvedAt'),
	handler: (ctx, args) => {
		checkLevel(args.level);
		checkRadius(args.radius);
		return ctx.db.insert('blackouts', args);
	}
});

export const update = mutation({
	args: { id: v.id('blackouts'), patch: blackout.pick('x', 'y', 'radius', 'note').partial() },
	handler: async (ctx, { id, patch }) => {
		if (patch.radius !== undefined) checkRadius(patch.radius);
		await ctx.db.patch(id, patch);
	}
});
