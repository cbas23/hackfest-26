import { defineSchema, defineTable } from 'convex/server';
import { airEvent, blackout, blockedTunnel, sicknessSettings, waterEvent } from './model';

/** Each kind of event is its own table, so they change (and are queried) independently. */
export default defineSchema({
	blackouts: defineTable(blackout.fields).index('by_level', ['level']),
	airQuality: defineTable(airEvent.fields).index('by_level', ['level']),
	waterCuts: defineTable(waterEvent.fields).index('by_level', ['level']),
	blockedTunnels: defineTable(blockedTunnel.fields).index('by_level', ['level']),
	sickness: defineTable(sicknessSettings.fields)
});
