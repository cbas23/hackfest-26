import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { checkLevel, checkRadius, checkStrength, point } from './model';

export const list = query({
	args: {},
	handler: (ctx) => ctx.db.query('points').collect()
});

export const add = mutation({
	args: point,
	handler: (ctx, args) => {
		checkLevel(args.level);
		checkRadius(args.radius);
		checkStrength(args.strength);
		return ctx.db.insert('points', args);
	}
});

export const update = mutation({
	args: {
		id: v.id('points'),
		patch: point.pick('x', 'y', 'radius', 'strength', 'note').partial()
	},
	handler: async (ctx, { id, patch }) => {
		if (patch.radius !== undefined) checkRadius(patch.radius);
		checkStrength(patch.strength);
		await ctx.db.patch(id, patch);
	}
});

export const remove = mutation({
	args: { id: v.id('points') },
	handler: (ctx, { id }) => ctx.db.delete(id)
});
