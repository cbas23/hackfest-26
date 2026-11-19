/**
 * The Hollow's events: what is going wrong in the city right now. Unlike the map (tunnels,
 * rooms, facilities, residents), events change over time and are shared: they live in Convex
 * (`convex/`), are edited from the control center (`/control`) and are read by the main map
 * through `#lib/live`. Every kind is independent of the others.
 *
 * All of it is fictional. These are plain types so `#lib/hollow` doesn't depend on Convex;
 * `id` is the Convex document id (or a local id for the offline starter scenario).
 */
import type { Status } from './simConfig.js';

/** An event's severity: events are never "normal" (that's the absence of one). */
export type Severity = Exclude<Status, 'normal'>;
export const SEVERITIES: Severity[] = ['warning', 'high', 'critical'];

export interface Tile {
	x: number;
	y: number;
}

interface EventBase {
	id: string;
	/** Level index, 0 (L1) to 6 (L7). */
	level: number;
	note?: string;
	/** When it was created (ms since epoch), if known. */
	createdAt?: number;
	/** When a crew fixed it; unset while it is active. */
	resolvedAt?: number;
}

/** A power cut over a round area: every housing block whose centre is inside goes dark. */
export interface BlackoutEvent extends EventBase {
	x: number;
	y: number;
	/** In tiles. */
	radius: number;
}

export type AirMetric = 'co2' | 'pm25' | 'airflow';
export type WaterMetric = 'turbidity' | 'chlorine' | 'output';

/** A monitored facility reading badly on one metric. */
export interface FacilityEvent<M extends string = string> extends EventBase {
	/** The facility's place key, `"<level>:<roomId>"`. */
	facility: string;
	metric: M;
	severity: Severity;
	/** Exact reading; when unset it sits inside the severity's band. */
	value?: number;
}

export type AirEvent = FacilityEvent<AirMetric>;
/** Bad water quality (turbidity, chlorine) or a supply cut (output). */
export type WaterEvent = FacilityEvent<WaterMetric>;

/** A short stretch of tunnel (2–5 tiles) that can't be passed. */
export interface BlockedTunnelEvent extends EventBase {
	tiles: Tile[];
	reason: string;
}

/** Where lung sickness is: the hotspots' seed plus a few dials. */
export interface SicknessSettings {
	seed: number;
	/** Hotspots on L1; each level down has `hotspotsDrop` fewer (at least one). */
	hotspots: number;
	hotspotsDrop: number;
	/** Multiplier on hotspot radius. */
	spread: number;
	/** Multiplier on how sick a hotspot's centre is. */
	intensity: number;
	/** Background sick share on L1. */
	background: number;
	/** Share of hotspot size, heat and background each level down keeps (1: same on every level). */
	depthFalloff: number;
}

/** The event tables, as named in Convex. */
export type EventTable = 'blackouts' | 'airQuality' | 'waterCuts' | 'blockedTunnels';
export const EVENT_TABLES: EventTable[] = [
	'blackouts',
	'airQuality',
	'waterCuts',
	'blockedTunnels'
];

/** Points at one event. */
export interface EventRef {
	table: EventTable;
	id: string;
}

/** Every event in the city. Each list is replaced (not mutated) when it changes. */
export interface HollowEvents {
	blackouts: BlackoutEvent[];
	airQuality: AirEvent[];
	waterCuts: WaterEvent[];
	blockedTunnels: BlockedTunnelEvent[];
	sickness: SicknessSettings;
}

export const BLOCKED_TILES = { min: 2, max: 5 } as const;
export const BLACKOUT_RADIUS = { min: 2, max: 60 } as const;

export const isActive = (e: { resolvedAt?: number }) => e.resolvedAt === undefined;

/** Facility place key → its level and room id. */
export function parseFacilityKey(key: string) {
	const [level, room] = key.split(':').map(Number);
	return { level, room };
}
