/**
 * Contact Agent: when a call mentions bad water, draft a letter to the water infrastructure team
 * with the evidence behind it. A person reads it and presses send; nothing goes out on its own.
 *
 * Answers "How would you catch bad water before people drink it?": the hotline turns resident
 * reports into an inspection request, with tap telemetry and the residents inside the radar.
 */
import { LEVELS } from '#lib/hollow/data.js';
import { placesOn } from '#lib/hollow/nav.js';
import { findKeywords, hottestBand, levelRisk, type Report } from './engine.js';
import { SYSTEMS } from './telemetry.js';
import { buildings, hollowWorld, type Building } from './places.js';

/** Rough residents per housing block, for the affected-residents estimate. */
const PER_BLOCK = 120;
const HOUR = 3_600_000;

export interface RadarDot {
	label: string;
	count: number;
	/** Offset from the centre building, as a fraction of the radar radius (-1..1). */
	dx: number;
	dy: number;
}

export interface WaterLetter {
	id: string;
	/** Short reference the water team can quote back. */
	ticket: string;
	level: number;
	building: Building | null;
	to: string;
	team: string;
	subject: string;
	summary: string;
	/** What the caller said about the water, with the water keywords to highlight. */
	quote: string;
	keywords: string[];
	evidence: { label: string; value: string; warn?: boolean }[];
	radar: { radius: number; dots: RadarDot[]; reports: number; blocks: number; residents: number };
	actions: string[];
}

/** Draft the letter for a call that mentioned water, or null if it didn't. */
export function buildWaterLetter(
	report: Report,
	all: Report[],
	radius: number,
	now = Date.now()
): WaterLetter | null {
	if (!report.categories.includes('water')) return null;
	const lv = report.level;
	const level = LEVELS[lv - 1];
	const sys = SYSTEMS[lv - 1];
	const named = buildings()[lv - 1] ?? [];
	const works = named.find((b) => /water/i.test(b.label));
	const at = report.building;

	// The caller's own words about the water.
	const said = report.transcript
		.filter((l) => l.role === 'caller')
		.map((l) => l.text)
		.join(' ');
	const sentences = said
		.split(/(?<=[.!?])\s+/)
		.filter((s) => findKeywords(s).some((m) => m.cat === 'water'));
	const quote = sentences.join(' ') || said;
	const keywords = findKeywords(quote)
		.filter((m) => m.cat === 'water')
		.map((m) => quote.slice(m.start, m.end));

	// Radar: water reports in the last 3 days, per building, around where the caller is.
	const centre = at ?? (works ? { x: works.x, y: works.y } : null);
	const recentWater = all.filter(
		(r) => r.level === lv && r.categories.includes('water') && now - r.t < 72 * HOUR
	);
	const dots: RadarDot[] = [];
	let reports = 0;
	if (centre) {
		const counts = new Map<string, { b: Building; n: number }>();
		for (const r of recentWater) {
			const b = r.building;
			if (!b || Math.hypot(b.x - centre.x, b.y - centre.y) > radius) continue;
			counts.set(b.key, { b, n: (counts.get(b.key)?.n ?? 0) + 1 });
			reports++;
		}
		for (const { b, n } of counts.values())
			dots.push({
				label: b.label,
				count: n,
				dx: (b.x - centre.x) / radius,
				dy: (b.y - centre.y) / radius
			});
		dots.sort((a, b) => b.count - a.count);
	}
	const blocks = centre
		? placesOn(hollowWorld().floor(lv - 1)).filter(
				(p) =>
					p.kind === 'block' &&
					Math.hypot(p.room.x + p.room.w / 2 - centre.x, p.room.y + p.room.h / 2 - centre.y) <=
						radius
			).length
		: 0;
	const residents = Math.round((blocks * PER_BLOCK) / 50) * 50;

	const where = at ? `${at.label}, Level ${lv} (${level.name})` : `Level ${lv} (${level.name})`;
	const band = hottestBand(all, 'water');
	const inBand = lv >= band.lo && lv <= band.hi;
	const risk = Math.round(inBand ? band.risk : levelRisk(all, 'water', lv));
	const rising = sys.turbidityNTU > sys.turbidity3dAgoNTU;

	return {
		id: `WW-${lv}${at ? `-${at.key}` : ''}-${report.id}`,
		ticket: `WW-${lv}${String(Math.floor(report.t / 1000) % 10000).padStart(4, '0')}`,
		level: lv,
		building: at,
		to: works?.label ?? `${level.name} water works`,
		team: 'Water Infrastructure Team',
		subject: `Suspected contaminated tap water near ${at?.label ?? level.name}: inspection requested`,
		summary: `Residents near ${where} are reporting tap water that looks and tastes wrong, and some are getting sick. Tap telemetry on this level agrees: the water is getting cloudier while disinfectant runs low. We ask for an inspection before more people drink from these taps.`,
		quote,
		keywords,
		evidence: [
			{ label: 'Water reports within radar (3 days)', value: String(reports), warn: reports >= 3 },
			{
				label: inBand
					? `Water risk score, Levels ${band.lo} to ${band.hi}`
					: 'Water risk score, this level',
				value: `${risk}%`,
				warn: risk >= 60
			},
			{
				label: 'Turbidity',
				value: `${sys.turbidityNTU} NTU (was ${sys.turbidity3dAgoNTU} three days ago)`,
				warn: sys.turbidityNTU >= 1 && rising
			},
			{
				label: 'Chlorine left in pipes',
				value: `${sys.chlorineMgL} mg/L`,
				warn: sys.chlorineMgL <= 0.2
			},
			{
				label: 'Water recycler',
				value: `${sys.waterRecycler}% capacity`,
				warn: sys.waterRecycler < 70
			},
			...(report.categories.includes('lungs')
				? [{ label: 'Also reported', value: 'coughing in the same households', warn: true }]
				: [])
		],
		radar: { radius, dots, reports, blocks, residents },
		actions: [
			`Inspect filters and chlorine dosing at ${works?.label ?? 'the level water works'}.`,
			`Flush and sample the lines serving ${at?.label ?? 'the reporting blocks'}${dots.length > 1 ? ` and ${dots.length - 1} nearby buildings` : ''}.`,
			`Issue a boil-water notice for the ${blocks} blocks inside the radar until samples come back clean.`,
			'Check showers and cooling vents too: coughing alongside bad water can mean bacteria spreading through mist.'
		]
	};
}
