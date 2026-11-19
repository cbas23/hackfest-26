/**
 * The Hollow's simulated data, in one place: the shared city, its seeds and tuning, and
 * every simulated dataset. All of it is fictional and deterministic: the same city seed
 * always gives the same data.
 *
 * - Seeds and tuning: `SIM` / `streamSeed` (defined in `simConfig.ts`).
 * - Inputs and lore: levels, facilities and shafts in `data.ts`, including the sensor
 *   readings pinned to the facility notes.
 * - The models: `world.ts` (power, residents, facility placement), `nav.ts` (places),
 *   `sickness.ts`, `sensors.ts`, `impact.ts` and `alerts.ts`.
 *
 * Pages read the data through `getHollow()` and `simulateFloor()`. `snapshot()` dumps all of
 * it as plain data, for tests and debugging.
 */
import { alertsOn, type FloorAlerts } from './alerts.js';
import { HOLLOW_SEED, LEVELS } from './data.js';
import { assessImpact, type ImpactAssessment } from './impact.js';
import { placesOn, type Place } from './nav.js';
import { facilityStatus, type FacilityStatus } from './sensors.js';
import { sicknessOf, type BlockSickness } from './sickness.js';
import { createHollow, perFloor, type Floor, type Hollow } from './world.js';

export { SIM, streamSeed, type SimStream } from './simConfig.js';

let shared: Hollow | null = null;

/** The city every page shows, seeded with `HOLLOW_SEED`. Created once and shared. */
export const getHollow = (): Hollow => (shared ??= createHollow(HOLLOW_SEED));

/** Everything simulated about one floor. Each part is computed on first use and cached. */
export interface FloorSimulation {
	readonly floor: Floor;
	/** Every named place on the floor. */
	readonly places: Place[];
	/** Room id → lung-sickness reports (null for rooms that aren't housing). */
	readonly sickness: (BlockSickness | null)[];
	/** Sensor readings of a place on this floor, or null if it has no sensors. */
	status(place: Place): FacilityStatus | null;
	/** What a monitored facility's status means for the residents who depend on it. */
	impact(place: Place): ImpactAssessment | null;
	/** Blackout and air alerts on the floor, worst first. */
	readonly alerts: FloorAlerts;
}

export const simulateFloor = perFloor((floor): FloorSimulation => ({
	floor,
	get places() {
		return placesOn(floor);
	},
	get sickness() {
		return sicknessOf(floor);
	},
	status: (place) => facilityStatus(floor, place),
	impact: (place) => assessImpact(floor, place),
	get alerts() {
		return alertsOn(floor);
	}
}));

/**
 * Every simulated number for a city as plain, JSON-ready data. Builds every floor, so it is
 * slow the first time.
 */
export function snapshot(city: Hollow = getHollow()) {
	return {
		seed: city.seed,
		levels: LEVELS.map((level) => {
			const sim = simulateFloor(city.floor(level.index));
			const { floor } = sim;
			return {
				level: level.code,
				powered: floor.lit,
				residents: floor.residents,
				facilities: [...floor.facilities].map(([room, spec]) => ({ room, name: spec.name })),
				sickness: sim.sickness,
				sensors: sim.places.flatMap((place) => {
					const status = sim.status(place);
					if (!status) return [];
					const impact = sim.impact(place);
					return [
						{
							place: place.key,
							name: place.label,
							...status,
							dependent: impact?.dependentTotal ?? 0,
							affected: impact?.affectedTotal ?? 0
						}
					];
				})
			};
		})
	};
}
