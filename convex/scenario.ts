/** Whole-city actions: load a scenario, or clear the map. */
import { v } from 'convex/values';
import { mutation, type MutationCtx } from './_generated/server';
import { blockedTunnel, checkLevel, checkRadius, checkStrength, checkTiles, point } from './model';

async function clear(ctx: MutationCtx, tables: ('points' | 'blockedTunnels')[]) {
	for (const table of tables)
		for (const doc of await ctx.db.query(table).collect()) await ctx.db.delete(doc._id);
}

/**
 * Replace the whole state with a scenario (the control center builds the starter one from
 * the city seed).
 */
export const load = mutation({
	args: {
		points: v.array(point),
		blockedTunnels: v.array(blockedTunnel)
	},
	handler: async (ctx, s) => {
		for (const p of s.points) {
			checkLevel(p.level);
			checkRadius(p.radius);
			checkStrength(p.strength);
		}
		for (const t of s.blockedTunnels) {
			checkLevel(t.level);
			checkTiles(t.tiles);
		}
		await clear(ctx, ['points', 'blockedTunnels']);
		for (const p of s.points) await ctx.db.insert('points', p);
		for (const t of s.blockedTunnels) await ctx.db.insert('blockedTunnels', t);
	}
});

/** Delete every point (sickness outbreaks too) and blocked tunnel. */
export const clearMap = mutation({
	args: {},
	handler: (ctx) => clear(ctx, ['points', 'blockedTunnels'])
});
