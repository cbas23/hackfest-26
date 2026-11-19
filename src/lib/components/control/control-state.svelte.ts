/**
 * State and actions of the control center (`/control`): which level and kind of event is
 * being edited, the tool settings, and the mutations that write events to Convex. The
 * control center is public for now; every change shows up live on the main map.
 */
import { api } from '#convex/_generated/api.js';
import type { Id } from '#convex/_generated/dataModel.js';
import { SIM } from '#lib/hollow/simConfig.js';
import type {
	AirMetric,
	EventRef,
	EventTable,
	Severity,
	SicknessSettings,
	Tile,
	WaterMetric
} from '#lib/hollow/events.js';
import { getHollow } from '#lib/hollow/simulation.js';
import { starterScenario } from '#lib/hollow/scenario.js';
import { mutate, reopenEvents, resolveEvents } from '#lib/live/events.svelte.js';

/** The tabs: one per event table, plus sickness. */
export type ControlTab = EventTable | 'sickness';
export type FacilityTable = 'airQuality' | 'waterCuts';

export const control = $state({
	level: 0,
	tab: 'blackouts' as ControlTab,
	/** New blackouts' radius, in tiles. */
	radius: 12,
	/** New blocked tunnels' length and reason. */
	tunnelLength: 3,
	reason: SIM.scenario.blockedReasons[0] as string,
	/** Selected facility (place key) per tab (air, water). */
	facility: { airQuality: null, waterCuts: null } as Record<FacilityTable, string | null>,
	/** New facility events' metric per tab, and severity. */
	metric: { airQuality: 'co2', waterCuts: 'turbidity' } as Record<FacilityTable, string>,
	severity: 'high' as Severity,
	/** Unpublished sickness settings (null: none, the map shows the live ones). */
	sicknessDraft: null as SicknessSettings | null,
	/** A mutation in flight. */
	busy: false
});

/** Run a mutation, flagging `busy`; errors land in `live.error`, so they're swallowed here. */
async function run(fn: () => Promise<unknown>) {
	control.busy = true;
	try {
		await fn();
	} catch {
		// Shown from live.error.
	} finally {
		control.busy = false;
	}
}

export const addBlackout = (x: number, y: number) =>
	run(() => mutate(api.blackouts.add, { level: control.level, x, y, radius: control.radius }));

export const setBlackoutRadius = (id: string, radius: number) =>
	run(() => mutate(api.blackouts.update, { id: id as Id<'blackouts'>, patch: { radius } }));

export const addBlockedTunnel = (tiles: Tile[]) =>
	run(() =>
		mutate(api.blockedTunnels.add, { level: control.level, tiles, reason: control.reason })
	);

export function addFacilityEvent(table: FacilityTable, facility: string) {
	const base = { level: control.level, facility, severity: control.severity };
	const metric = control.metric[table];
	return run(() =>
		table === 'airQuality'
			? mutate(api.airQuality.add, { ...base, metric: metric as AirMetric })
			: mutate(api.waterCuts.add, { ...base, metric: metric as WaterMetric })
	);
}

export const setFacilitySeverity = (ref: EventRef, severity: Severity) =>
	run(() =>
		ref.table === 'airQuality'
			? mutate(api.airQuality.update, {
					id: ref.id as Id<'airQuality'>,
					patch: { severity }
				})
			: mutate(api.waterCuts.update, {
					id: ref.id as Id<'waterCuts'>,
					patch: { severity }
				})
	);

export const resolve = (refs: EventRef[]) => run(() => resolveEvents(refs));
export const reopen = (refs: EventRef[]) => run(() => reopenEvents(refs));

export const removeEvent = (ref: EventRef) =>
	run(() => mutate(api.events.remove, { id: ref.id as Id<EventTable> }));

export const publishSickness = (settings: SicknessSettings) =>
	run(async () => {
		await mutate(api.sickness.set, settings);
		control.sicknessDraft = null;
	});

/** Replace every event with the starter scenario drawn from the city seed. */
export const loadStarterScenario = () =>
	run(() => mutate(api.events.loadScenario, starterScenario(getHollow())));

export const clearEvents = () => run(() => mutate(api.events.clearEvents, {}));
