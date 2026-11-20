import { LEVELS } from '#lib/hollow/data.js';
import { findRoute, placesOn, type Place, type PlaceKind, type Route } from '#lib/hollow/nav.js';
import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
import { live } from '#lib/live/state.svelte.js';
import { placeByKey } from './address.js';
import { home } from './home-state.svelte.js';

export type End = 'from' | 'to';

/**
 * Directions on the Main Map: a walking route between two places, possibly across levels by
 * shaft. The sidebar card edits it, the map draws it. Ends are place keys, so the state stays
 * small and the places come from the shared city.
 */
class Directions {
	/** True while the directions card is open. */
	open = $state(false);
	from = $state<string | null>(null);
	to = $state<string | null>(null);
	/** The end the next map click sets, if any. */
	picking = $state<End | null>(null);
	/** Directorate permit (ride restricted shafts up) and the unmapped Old Mine Vent. */
	permit = $state(false);
	unregistered = $state(false);

	fromPlace = $derived(placeByKey(this.from));
	toPlace = $derived(placeByKey(this.to));
	homePlace = $derived(placeByKey(home.address));
	/** The route, null when there is none, undefined until both ends are set. */
	route = $derived.by<Route | null | undefined>(() => {
		const a = this.fromPlace;
		const b = this.toPlace;
		if (!a || !b) return undefined;
		// Re-route when the blocked tunnels change.
		void live.version;
		const hollow = getHollow();
		return findRoute(hollow, a, b, {
			permit: this.permit,
			unregistered: this.unregistered,
			blocked: (f) => simulateFloor(hollow.floor(f)).blocked
		});
	});

	/** Open the card, starting from the saved home when there is one. */
	start() {
		this.open = true;
		home.pickingHome = false;
		if (!this.from && home.address) this.from = home.address;
		if (!this.to) this.picking = this.from ? 'to' : 'from';
	}

	/** Set one end, then ask for whichever end is still missing. */
	set(end: End, place: Place) {
		this.open = true;
		this[end] = place.key;
		this.picking = !this.from ? 'from' : !this.to ? 'to' : null;
	}

	/** Pick an end by clicking the map. */
	pick(end: End) {
		home.pickingHome = false;
		this.picking = this.picking === end ? null : end;
	}

	swap() {
		[this.from, this.to] = [this.to, this.from];
	}

	close() {
		this.open = false;
		this.from = null;
		this.to = null;
		this.picking = null;
	}
}

export const directions = new Directions();

const KIND_ORDER: Record<PlaceKind, number> = {
	shaft: 0,
	directorate: 1,
	air: 1,
	water: 1,
	clinic: 1,
	market: 1,
	farm: 2,
	plant: 3,
	block: 4
};

/**
 * Places matching a search, landmarks first and the current level before others. With no
 * query, the current level's landmarks.
 */
export function searchPlaces(query: string, level: number, limit = 8): Place[] {
	const hollow = getHollow();
	const q = query.trim().toLowerCase();
	if (!q)
		return placesOn(hollow.floor(level))
			.filter((p) => p.kind !== 'block')
			.slice(0, limit);
	const words = q.split(/\s+/);
	return LEVELS.flatMap((l) => placesOn(hollow.floor(l.index)))
		.filter((p) => {
			const hay = `${p.label} ${p.sub}`.toLowerCase();
			return words.every((w) => hay.includes(w));
		})
		.sort(
			(a, b) =>
				KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
				Number(b.floor === level) - Number(a.floor === level) ||
				a.floor - b.floor
		)
		.slice(0, limit);
}
