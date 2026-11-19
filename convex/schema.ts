import { defineSchema, defineTable } from 'convex/server';
import { blockedTunnel, point, sicknessSettings } from './model';

/** The city's shared state: bad points (power, water, air), blocked tunnels, sickness dials. */
export default defineSchema({
	points: defineTable(point.fields).index('by_level', ['level']),
	blockedTunnels: defineTable(blockedTunnel.fields).index('by_level', ['level']),
	sickness: defineTable(sicknessSettings.fields)
});
