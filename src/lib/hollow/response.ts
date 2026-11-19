import { alertsOn, STARVED, type AlertKind, type BlockAlert, type HollowAlert } from './alerts.js';
import type { Status } from './sensors.js';
import type { Floor } from './world.js';

/**
 * The Respond step (simulated): what to do about each alert, what fixing it would clear,
 * and which fix helps the most people first.
 *
 * Fixes are tracked as a set of resolved alert ids. Fixing a blackout restores power to its
 * blocks; any air or water alert that was failing *because* of the power cut (its chain
 * starts with "Power cuts") clears by itself once less than STARVED of its area is dark.
 * Other air and water alerts need their own crew. Nothing here is measured.
 */

/** Alert ids fixed in this session's simulation. Read by the alerts lens. */
export const resolved = new Set<string>();

export interface FloorState {
	/** Still needs action. */
	active: HollowAlert[];
	/** Fixed directly by a crew. */
	fixed: HollowAlert[];
	/** Cleared on its own because its root cause (a power cut) was fixed. */
	cleared: HollowAlert[];
	/** What the alerts lens paints, active alerts only. */
	blocks: Map<number, BlockAlert>;
	sources: Map<number, AlertKind>;
}

/** Whether a power-starved air/water alert still lacks power, given the dark blackouts. */
function stillStarved(floor: Floor, a: HollowAlert, darkIds: ReadonlySet<string>) {
	const { owner } = alertsOn(floor);
	let dark = 0;
	for (const b of a.blocks) {
		const bo = owner.get(b)?.blackout;
		if (bo && darkIds.has(bo)) dark += floor.residents[b];
	}
	return dark / Math.max(1, a.dependents) >= STARVED;
}

const starvedByPower = (a: HollowAlert) => a.chain[0]?.kind === 'blackout';

/** Split a floor's alerts by state for a given set of fixes. */
export function floorState(floor: Floor, fixes: ReadonlySet<string> = resolved): FloorState {
	const raw = alertsOn(floor);
	const dark = new Set(
		raw.alerts.filter((a) => a.kind === 'blackout' && !fixes.has(a.id)).map((a) => a.id)
	);
	const active: HollowAlert[] = [];
	const fixed: HollowAlert[] = [];
	const cleared: HollowAlert[] = [];
	for (const a of raw.alerts) {
		if (fixes.has(a.id)) fixed.push(a);
		else if (a.kind !== 'blackout' && starvedByPower(a) && !stillStarved(floor, a, dark))
			cleared.push(a);
		else active.push(a);
	}
	const live = new Set(active.map((a) => a.id));
	const blocks = new Map<number, BlockAlert>();
	for (const [id, b] of raw.blocks) {
		const o = raw.owner.get(id) ?? {};
		const keep: BlockAlert = {};
		for (const k of Object.keys(b) as AlertKind[]) if (o[k] && live.has(o[k]!)) keep[k] = b[k];
		if (Object.keys(keep).length) blocks.set(id, keep);
	}
	const sources = new Map<number, AlertKind>();
	for (const [room, kind] of raw.sources)
		if (live.has(raw.sourceOwner.get(room)!)) sources.set(room, kind);
	return { active, fixed, cleared, blocks, sources };
}

export type ActionType = 'restore' | 'crew' | 'cause';

export interface Action {
	alert: HollowAlert;
	type: ActionType;
	/** Short imperative, e.g. "Restore power". */
	verb: string;
	/** What residents are told meanwhile. */
	advice: string;
	/** Every alert this fix resolves: the alert itself plus anything that clears with it. */
	clears: HollowAlert[];
	/** Residents helped by the fix. */
	residents: number;
	/** For 'cause': the blackout to fix first. */
	cause?: HollowAlert;
}

const WATER_ADVICE: Record<Status, string> = {
	normal: '',
	warning: 'Tell residents to boil water before drinking',
	high: 'Tell residents not to drink tap water',
	critical: 'Shut the supply and truck in clean water'
};
const AIR_ADVICE: Record<Status, string> = {
	normal: '',
	warning: 'Tell residents to limit hard work',
	high: 'Hand out masks and keep doors shut',
	critical: 'Move residents to clean-air blocks'
};

/** What fixing `a` (on top of the current fixes) would resolve. */
function simulate(floor: Floor, a: HollowAlert, before: FloorState) {
	const after = floorState(floor, new Set([...resolved, a.id]));
	const was = new Set(before.active.map((x) => x.id));
	return [a, ...after.cleared.filter((x) => was.has(x.id) && x.id !== a.id)];
}

/** The recommended action for an active alert. */
export function actionFor(floor: Floor, a: HollowAlert, state = floorState(floor)): Action {
	if (a.kind === 'blackout') {
		const clears = simulate(floor, a, state);
		return {
			alert: a,
			type: 'restore',
			verb: 'Restore power',
			advice: 'Open lit shelters for residents in the dark',
			clears,
			residents: clears.reduce((s, x) => s + x.residents, 0)
		};
	}
	const advice = (a.kind === 'air' ? AIR_ADVICE : WATER_ADVICE)[a.severity];
	if (starvedByPower(a)) {
		// The real fix is upstream: the blackout whose repair helps this alert the most.
		let cause: HollowAlert | undefined;
		let best = -1;
		const { owner } = alertsOn(floor);
		for (const b of state.active) {
			if (b.kind !== 'blackout') continue;
			const overlap = a.blocks.reduce(
				(s, id) => s + (owner.get(id)?.blackout === b.id ? floor.residents[id] : 0),
				0
			);
			if (overlap > best) {
				best = overlap;
				cause = b;
			}
		}
		if (cause) {
			const clears = simulate(floor, cause, state);
			return {
				alert: a,
				type: 'cause',
				verb: 'Fix the power first',
				advice,
				clears,
				residents: clears.reduce((s, x) => s + x.residents, 0),
				cause
			};
		}
	}
	return {
		alert: a,
		type: 'crew',
		verb: a.kind === 'air' ? 'Send vent crew' : 'Send purification crew',
		advice,
		clears: [a],
		residents: a.residents
	};
}

/** The single fix that helps the most residents across the given floors. */
export function bestAction(floors: Floor[]): (Action & { floor: Floor }) | null {
	let best: (Action & { floor: Floor }) | null = null;
	for (const f of floors) {
		const state = floorState(f);
		for (const a of state.active) {
			const act = actionFor(f, a, state);
			if (act.type === 'cause') continue; // its cause is scored on its own
			if (!best || act.residents > best.residents) best = { ...act, floor: f };
		}
	}
	return best;
}
