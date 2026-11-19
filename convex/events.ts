/** Actions shared by every event table: resolve, reopen, delete, and loading a whole scenario. */
import { v } from 'convex/values';
import { mutation, type MutationCtx } from './_generated/server';
import {
	airEvent,
	blackout,
	blockedTunnel,
	checkFacility,
	checkLevel,
	checkRadius,
	checkTiles,
	sicknessSettings,
	waterEvent
} from './model';

const EVENT_TABLES = ['blackouts', 'airQuality', 'waterCuts', 'blockedTunnels'] as const;

const eventId = v.union(
	v.id('blackouts'),
	v.id('airQuality'),
	v.id('waterCuts'),
	v.id('blockedTunnels')
);

/** Mark events fixed (a crew resolved them). */
export const resolve = mutation({
	args: { ids: v.array(eventId) },
	handler: async (ctx, { ids }) => {
		const now = Date.now();
		for (const id of ids) await ctx.db.patch(id, { resolvedAt: now });
	}
});

/** Make fixed events active again. */
export const reopen = mutation({
	args: { ids: v.array(eventId) },
	handler: async (ctx, { ids }) => {
		for (const id of ids) await ctx.db.patch(id, { resolvedAt: undefined });
	}
});

/** Reopen every fixed event, optionally only on some levels. */
export const reopenAll = mutation({
	args: { levels: v.optional(v.array(v.number())) },
	handler: async (ctx, { levels }) => {
		for (const table of EVENT_TABLES)
			for (const doc of await ctx.db.query(table).collect())
				if (doc.resolvedAt !== undefined && (!levels || levels.includes(doc.level)))
					await ctx.db.patch(doc._id, { resolvedAt: undefined });
	}
});

export const remove = mutation({
	args: { id: eventId },
	handler: (ctx, { id }) => ctx.db.delete(id)
});

async function clear(ctx: MutationCtx) {
	for (const table of [...EVENT_TABLES, 'sickness'] as const)
		for (const doc of await ctx.db.query(table).collect()) await ctx.db.delete(doc._id);
}

/**
 * Replace every event with a scenario (the control center builds the starter one from the
 * city seed). Sickness settings are replaced too.
 */
export const loadScenario = mutation({
	args: {
		blackouts: v.array(blackout),
		airQuality: v.array(airEvent),
		waterCuts: v.array(waterEvent),
		blockedTunnels: v.array(blockedTunnel),
		sickness: sicknessSettings
	},
	handler: async (ctx, s) => {
		for (const b of s.blackouts) {
			checkLevel(b.level);
			checkRadius(b.radius);
		}
		for (const a of [...s.airQuality, ...s.waterCuts]) {
			checkLevel(a.level);
			checkFacility(a.level, a.facility);
		}
		for (const t of s.blockedTunnels) {
			checkLevel(t.level);
			checkTiles(t.tiles);
		}
		await clear(ctx);
		for (const b of s.blackouts) await ctx.db.insert('blackouts', b);
		for (const a of s.airQuality) await ctx.db.insert('airQuality', a);
		for (const w of s.waterCuts) await ctx.db.insert('waterCuts', w);
		for (const t of s.blockedTunnels) await ctx.db.insert('blockedTunnels', t);
		await ctx.db.insert('sickness', s.sickness);
	}
});

/** Delete every event (sickness settings stay). */
export const clearEvents = mutation({
	args: {},
	handler: async (ctx) => {
		for (const table of EVENT_TABLES)
			for (const doc of await ctx.db.query(table).collect()) await ctx.db.delete(doc._id);
	}
});
