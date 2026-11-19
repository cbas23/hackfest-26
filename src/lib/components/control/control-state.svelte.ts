/**
 * State and actions of the control center (`/control`): which level and kind of state is
 * being edited, the tool settings, and the mutations that write it to Convex. The control
 * center is public for now; every change shows up live on the main map.
 */
import { api } from '#convex/_generated/api.js';
import type { Id } from '#convex/_generated/dataModel.js';
import { SIM } from '#lib/hollow/simConfig.js';
import type { PointKind, SicknessSettings, Tile } from '#lib/hollow/state.js';
import { getHollow } from '#lib/hollow/simulation.js';
import { starterScenario } from '#lib/hollow/scenario.js';
import { mutate } from '#lib/live/state.svelte.js';

/** The tabs: one per point kind, plus blocked tunnels and sickness. */
export type ControlTab = PointKind | 'tunnels' | 'sickness';

export const isPointTab = (tab: ControlTab): tab is PointKind =>
	tab === 'power' || tab === 'water' || tab === 'air';

export const control = $state({
	level: 0,
	tab: 'power' as ControlTab,
	/** New points' reach, in tiles (along the tunnels for power and water), and strength. */
	radius: 24,
	strength: 0.8,
	/** New blocked tunnels' length and reason. */
	tunnelLength: 3,
	reason: SIM.scenario.blockedReasons[0] as string,
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

export const addPoint = (kind: PointKind, x: number, y: number) =>
	run(() =>
		mutate(api.points.add, {
			kind,
			level: control.level,
			x,
			y,
			radius: control.radius,
			strength: control.strength
		})
	);

export const updatePoint = (id: string, patch: { radius?: number; strength?: number }) =>
	run(() => mutate(api.points.update, { id: id as Id<'points'>, patch }));

export const removePoint = (id: string) =>
	run(() => mutate(api.points.remove, { id: id as Id<'points'> }));

export const addBlockedTunnel = (tiles: Tile[]) =>
	run(() =>
		mutate(api.blockedTunnels.add, { level: control.level, tiles, reason: control.reason })
	);

export const removeBlockedTunnel = (id: string) =>
	run(() => mutate(api.blockedTunnels.remove, { id: id as Id<'blockedTunnels'> }));

export const publishSickness = (settings: SicknessSettings) =>
	run(async () => {
		await mutate(api.sickness.set, settings);
		control.sicknessDraft = null;
	});

/** Replace the whole state with the starter scenario drawn from the city seed. */
export const loadStarterScenario = () =>
	run(() => mutate(api.scenario.load, starterScenario(getHollow())));

/** Delete every point and blocked tunnel. */
export const clearMap = () => run(() => mutate(api.scenario.clearMap, {}));
