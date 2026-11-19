/** Whole-city actions: load a scenario, or clear the map. */
import { v } from 'convex/values';
import { mutation, type MutationCtx } from './_generated/server';
import {
	blockedTunnel,
	checkLevel,
	checkRadius,
	checkStrength,
	checkTiles,
	point,
	sicknessSettings
} from './model';

async function clear(ctx: MutationCtx, tables: ('points' | 'blockedTunnels' | 'sickness')[]) {
	for (const table of tables)
		for (const doc of await ctx.db.query(table).collect()) await ctx.db.delete(doc._id);
}

/**
 * Replace the whole state with a scenario (the control center builds the starter one from
 * the city seed). Sickness settings are replaced too.
 */
export const load = mutation({
	args: {
		points: v.array(point),
		blockedTunnels: v.array(blockedTunnel),
		sickness: sicknessSettings
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
		await clear(ctx, ['points', 'blockedTunnels', 'sickness']);
		for (const p of s.points) await ctx.db.insert('points', p);
		for (const t of s.blockedTunnels) await ctx.db.insert('blockedTunnels', t);
		await ctx.db.insert('sickness', s.sickness);
	}
});

/** Delete every point and blocked tunnel (sickness settings stay). */
export const clearMap = mutation({
	args: {},
	handler: (ctx) => clear(ctx, ['points', 'blockedTunnels'])
});
