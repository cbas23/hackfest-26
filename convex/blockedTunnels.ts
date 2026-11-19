import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { blockedTunnel, checkLevel, checkTiles } from './model';

export const list = query({
	args: {},
	handler: (ctx) => ctx.db.query('blockedTunnels').collect()
});

export const add = mutation({
	args: blockedTunnel.omit('resolvedAt'),
	handler: (ctx, args) => {
		checkLevel(args.level);
		checkTiles(args.tiles);
		return ctx.db.insert('blockedTunnels', args);
	}
});

export const update = mutation({
	args: {
		id: v.id('blockedTunnels'),
		patch: blockedTunnel.pick('tiles', 'reason', 'note').partial()
	},
	handler: async (ctx, { id, patch }) => {
		if (patch.tiles) checkTiles(patch.tiles);
		await ctx.db.patch(id, patch);
	}
});
