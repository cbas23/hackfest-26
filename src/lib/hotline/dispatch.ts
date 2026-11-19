/**
 * Dash Agent: turns a scored hotline call into supply runs a person can approve.
 *
 * - An outbreak warning on the caller's level → resupply every clinic on that level from the
 *   nearest clinic above it.
 * - The caller can't reach a clinic → a runner takes supplies from the nearest clinic straight
 *   to the building they called from.
 *
 * Routes come from the real tunnel pathfinder; directions are generated from the route.
 */
import { LEVELS, SHAFTS } from '#lib/hollow/data.js';
import type { RouteDraw } from '#lib/hollow/scene/route.js';
import { findRoute, placesOn, type Place, type Route } from '#lib/hollow/nav.js';
import type { Point } from '#lib/tunnels/generate.js';
import type { Band, Report } from './engine.js';
import { hollowWorld } from './places.js';

export type StepIcon = 'start' | 'walk' | 'left' | 'right' | 'lift' | 'end';
export interface Step {
	icon: StepIcon;
	text: string;
}

export interface Task {
	id: string;
	kind: 'clinics' | 'doorstep';
	title: string;
	body: string;
	from: Place;
	to: Place;
	/** Other stops on the same run (the clinics task can cover several). */
	alsoTo: Place[];
	minutes: number | null;
	route: Route | null;
	draw: RouteDraw | null;
	steps: Step[];
}

const places = (level0: number) => placesOn(hollowWorld().floor(level0));
const centre = (p: Place) => ({ x: p.room.x + p.room.w / 2, y: p.room.y + p.room.h / 2 });
const dist = (a: Place, b: { x: number; y: number }) =>
	Math.hypot(centre(a).x - b.x, centre(a).y - b.y);

function route(from: Place, to: Place) {
	return findRoute(hollowWorld(), from, to, { permit: false, unregistered: false });
}

export function toDraw(r: Route): RouteDraw {
	const h = hollowWorld();
	return {
		legs: r.legs.map((l) => ({ level: l.floor, path: l.path })),
		rides: r.rides.map((ride) => {
			const g = h.floor(ride.from).shaftGates[ride.shaft];
			return { x: g.x + g.w / 2, y: g.y + g.h / 2, from: ride.from, to: ride.to };
		})
	};
}

const HEADING = ['north', 'east', 'south', 'west'];
const headingOf = (d: Point) => (d.y < 0 ? 0 : d.x > 0 ? 1 : d.y > 0 ? 2 : 3);

/** Turn-by-turn directions from a route's tile paths. */
export function directions(r: Route, toLabel = r.to.label): Step[] {
	const tiles = r.legs.reduce((n, l) => n + Math.max(0, l.path.length - 1), 0) || 1;
	const mPerTile = r.walkMeters / tiles;
	const steps: Step[] = [{ icon: 'start', text: `Leave ${r.from.label}` }];

	r.legs.forEach((leg, i) => {
		// Straight runs of the path; short jogs (under 5 tiles) fold into the run around them.
		const runs: { dir: Point; len: number }[] = [];
		for (let k = 1; k < leg.path.length; k++) {
			const dir = {
				x: Math.sign(leg.path[k].x - leg.path[k - 1].x),
				y: Math.sign(leg.path[k].y - leg.path[k - 1].y)
			};
			const last = runs.at(-1);
			if (last && last.dir.x === dir.x && last.dir.y === dir.y) last.len++;
			else runs.push({ dir, len: 1 });
		}
		const main: { dir: Point; len: number }[] = [];
		for (const run of runs) {
			const last = main.at(-1);
			if (last && (run.len < 5 || (last.dir.x === run.dir.x && last.dir.y === run.dir.y)))
				last.len += run.len;
			else main.push({ ...run });
		}
		main.forEach((run, k) => {
			const m = Math.max(10, Math.round((run.len * mPerTile) / 10) * 10);
			if (k === 0) {
				steps.push({ icon: 'walk', text: `Head ${HEADING[headingOf(run.dir)]} for ${m} m` });
				return;
			}
			const prev = main[k - 1].dir;
			const cross = prev.x * run.dir.y - prev.y * run.dir.x;
			steps.push({
				icon: cross > 0 ? 'right' : 'left',
				text: `Turn ${cross > 0 ? 'right' : 'left'}, continue ${m} m`
			});
		});
		const ride = r.rides[i];
		if (ride)
			steps.push({
				icon: 'lift',
				text: `Take ${SHAFTS[ride.shaft].name} ${ride.to > ride.from ? 'down' : 'up'} to ${LEVELS[ride.to].code} ${LEVELS[ride.to].name}`
			});
	});
	steps.push({ icon: 'end', text: `Arrive at ${toLabel}` });
	return steps;
}

function task(
	id: string,
	kind: Task['kind'],
	title: string,
	body: string,
	from: Place,
	to: Place,
	alsoTo: Place[] = [],
	toLabel = to.label
): Task {
	const r = route(from, to);
	return {
		id,
		kind,
		title,
		body,
		from,
		to,
		alsoTo,
		minutes: r ? Math.max(1, Math.round(r.seconds / 60)) : null,
		route: r,
		draw: r ? toDraw(r) : null,
		steps: r ? directions(r, toLabel) : []
	};
}

/** Supply runs the agent suggests after a call has been scored. */
export function planTasks(report: Report, outbreak: Band): Task[] {
	const lv = report.level - 1;
	const level = LEVELS[lv];
	const out: Task[] = [];

	// 1. Outbreak on the caller's level: resupply all its clinics from the nearest clinic above.
	if (outbreak.risk >= 60 && report.level >= outbreak.lo && report.level <= outbreak.hi) {
		const clinics = places(lv).filter((p) => p.kind === 'clinic');
		let donor: Place | undefined;
		for (let up = lv - 1; up >= 0 && !donor; up--)
			donor = places(up).find((p) => p.kind === 'clinic');
		if (clinics.length && donor)
			out.push(
				task(
					`clinics-${level.code}`,
					'clinics',
					`Coordinate a supply run to ${clinics.length === 1 ? 'the clinic' : `all ${clinics.length} clinics`} on ${level.code}`,
					`Outbreak warning on Levels ${outbreak.lo} to ${outbreak.hi} (${Math.floor(outbreak.risk)}%). Send oxygen and inhalers from ${donor.label} on ${LEVELS[donor.floor].code} to ${clinics.map((c) => c.label).join(', ')} before demand spikes.`,
					donor,
					clinics[0],
					clinics.slice(1)
				)
			);
	}

	// 2. Caller can't reach a clinic: deliver from the nearest clinic to their building.
	if (report.cantReachClinic && report.building) {
		const b = report.building;
		const target = places(lv).find((p) => p.key === b.key);
		const clinic = places(lv)
			.filter((p) => p.kind === 'clinic')
			.sort((x, y) => dist(x, b) - dist(y, b))[0];
		if (target && clinic)
			out.push(
				task(
					`doorstep-${b.key}`,
					'doorstep',
					`Deliver supplies to ${b.label}`,
					`The caller can't get to a clinic: ${report.people} ${report.people === 1 ? 'person' : 'people'} with ${report.categories.includes('lungs') ? 'a cough' : 'symptoms'}. Send a runner from ${clinic.label} with inhalers and water tablets.`,
					clinic,
					target,
					[],
					b.label
				)
			);
	}
	return out;
}
