import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { blockedTunnel, checkLevel, checkTiles } from './model';

export const list = query({
	args: {},
	handler: (ctx) => ctx.db.query('blockedTunnels').collect()
});

export const add = mutation({
	args: blockedTunnel,
	handler: (ctx, args) => {
		checkLevel(args.level);
		checkTiles(args.tiles);
		return ctx.db.insert('blockedTunnels', args);
	}
});

export const remove = mutation({
	args: { id: v.id('blockedTunnels') },
	handler: (ctx, { id }) => ctx.db.delete(id)
});
