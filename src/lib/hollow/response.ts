import type { AlertKind, BlockAlert, HollowAlert } from './alerts.js';
import type { Status } from './sensors.js';
import { simulateFloor } from './simulation.js';
import type { Floor } from './world.js';

/**
 * The Respond step (simulated): what to do about each alert, and which fix helps the most
 * people first. Fixing an alert resolves the events behind it (in Convex, through
 * `#lib/live`), so every viewer sees it fixed. Alert kinds are independent: a fix only
 * clears its own alert. Nothing here is measured.
 */

export interface FloorState {
	/** Still needs action. */
	active: HollowAlert[];
	/** Fixed: every event behind it is resolved. */
	fixed: HollowAlert[];
	/** What the alerts lens paints, active alerts only. */
	blocks: Map<number, BlockAlert>;
	sources: Map<number, AlertKind>;
}

/** A floor's alerts, split by state. */
export function floorState(floor: Floor): FloorState {
	const { alerts, resolved, blocks, sources } = simulateFloor(floor).alerts;
	return { active: alerts, fixed: resolved, blocks, sources };
}

export type ActionType = 'restore' | 'crew';

export interface Action {
	alert: HollowAlert;
	type: ActionType;
	/** Short imperative, e.g. "Restore power". */
	verb: string;
	/** What residents are told meanwhile. */
	advice: string;
	/** Every alert this fix resolves. */
	clears: HollowAlert[];
	/** Residents helped by the fix. */
	residents: number;
}

const WATER_ADVICE: Record<Status, string> = {
	normal: '',
	warning: 'Tell residents to boil water before drinking',
	high: 'Tell residents not to drink tap water',
	critical: 'Shut the supply and truck in clean water'
};
const SUPPLY_ADVICE: Record<Status, string> = {
	normal: '',
	warning: 'Ask residents to save water',
	high: 'Ration water by block',
	critical: 'Truck in water to the dry blocks'
};
const AIR_ADVICE: Record<Status, string> = {
	normal: '',
	warning: 'Tell residents to limit hard work',
	high: 'Hand out masks and keep doors shut',
	critical: 'Move residents to clean-air blocks'
};

/** The recommended action for an active alert. */
export function actionFor(a: HollowAlert): Action {
	const base = { alert: a, clears: [a], residents: a.residents };
	if (a.kind === 'blackout')
		return {
			...base,
			type: 'restore',
			verb: 'Restore power',
			advice: 'Open lit shelters for residents in the dark'
		};
	const supply = a.metric === 'output';
	const advice = (a.kind === 'air' ? AIR_ADVICE : supply ? SUPPLY_ADVICE : WATER_ADVICE)[
		a.severity
	];
	return {
		...base,
		type: 'crew',
		verb:
			a.kind === 'air' ? 'Send vent crew' : supply ? 'Send pump crew' : 'Send purification crew',
		advice
	};
}

/** The single fix that helps the most residents across the given floors. */
export function bestAction(floors: Floor[]): (Action & { floor: Floor }) | null {
	let best: (Action & { floor: Floor }) | null = null;
	for (const f of floors)
		for (const a of floorState(f).active) {
			const act = actionFor(a);
			if (!best || act.residents > best.residents) best = { ...act, floor: f };
		}
	return best;
}
