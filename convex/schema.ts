import { defineSchema, defineTable } from 'convex/server';
import { blockedTunnel, point } from './model';

/** The city's shared state: points (bad power, water, air; sickness outbreaks) and blocked tunnels. */
export default defineSchema({
	points: defineTable(point.fields).index('by_level', ['level']),
	blockedTunnels: defineTable(blockedTunnel.fields).index('by_level', ['level'])
});
