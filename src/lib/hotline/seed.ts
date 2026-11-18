/**
 * Earlier (fictional) hotline reports, so the dashboard opens mid-crisis: the outbreak score for
 * Levels 3–5 sits at 57% and the water score just under the 60% warning line. The demo call
 * then lands next to two recent lung and water reports and tips both.
 */
import { buildReport, type Line, type Report } from './engine.js';
import { buildings, type Building } from './places.js';

interface Seed {
	level: number;
	ageHours: number;
	text: string;
}

const RECENT: Seed[] = [
	{ level: 3, ageHours: 20, text: 'Level 3. The water smells bad and it comes out cloudy.' },
	{
		level: 4,
		ageHours: 9,
		text: "I'm on level 4. Two of us keep coughing and my son has a fever."
	},
	{
		level: 5,
		ageHours: 15,
		text: 'Level 5 here. Coughing all night, my chest hurts, and the tap water is cloudy.'
	},
	{ level: 6, ageHours: 4, text: 'Deep level 6, the lights keep flickering and it is so hot.' },
	{ level: 7, ageHours: 7, text: 'Level 7. Blackout again since this morning. The air is stale.' },
	{ level: 2, ageHours: 11, text: 'Level 2, our lights flickered for an hour.' },
	// The first scattered reports, over a week ago, more than a day apart.
	{ level: 4, ageHours: 200, text: 'Level 4. Two of us are coughing and wheezing.' },
	{ level: 5, ageHours: 290, text: 'Level 5. I have a cough.' },
	{
		level: 4,
		ageHours: 230,
		text: 'Level 4. My whole family got sick after drinking from the tap.'
	},
	{
		level: 3,
		ageHours: 260,
		text: 'Level 3. My whole family got sick after drinking from the tap.'
	}
];

/** Older reports (1–5 days ago) that built up the cluster. */
const OLD_TEXTS = [
	'Level {L}. My whole family has a cough and the water tastes metallic.',
	"Level {L}, I've been wheezing for a week. The water is cloudy.",
	'Level {L}. Two of us are coughing and short of breath.',
	'Level {L} here, my chest hurts and the tap water is brown water.',
	'I am on level {L}. Coughing, fever, and the water smells awful.',
	'Level {L}. Kids are coughing. Water looks cloudy and contaminated.'
];
const OLD_LEVELS = [4, 3, 5, 4, 5, 3, 4, 5, 4, 3, 5, 4, 3, 4, 5, 4, 3, 5, 4, 2, 3];
/** Older water-only complaints. */
const WATER_TEXTS = [
	'Level {L}. My whole family got sick after drinking from the block tap.',
	'Level {L}, the water is filthy and smells bad.',
	'Level {L}. Brown water again, everyone in my house is boiling it.'
];
const WATER_LEVELS = [4, 3, 5, 4, 3];

/** The stage demo: five agent turns, five caller turns, about 55 seconds at reading pace. */
export const DEMO_CALL: Line[] = [
	{
		role: 'agent',
		text: 'Hollow Hotline. This line is independent and you can stay anonymous. Where are you right now?'
	},
	{ role: 'caller', text: "I'm at the Johnson Center on level 3. I'd rather stay anonymous." },
	{ role: 'agent', text: "Got it. Tell me what's going wrong: water, sickness, anything." },
	{
		role: 'caller',
		text: 'Our water is cloudy and tastes metallic, and my daughter and I have been coughing for two days.'
	},
	{ role: 'agent', text: 'Is anyone else in your household or on your corridor sick?' },
	{ role: 'caller', text: 'Just the two of us so far.' },
	{ role: 'agent', text: 'Can you make it to a clinic, or do you need supplies brought to you?' },
	{ role: 'caller', text: "I can't get to the clinic. She's too sick to walk." },
	{
		role: 'agent',
		text: "So: Johnson Center, level 3, cloudy metallic water, coughing, two people, and you need supplies brought to you. A runner is on the way. Don't drink the tap water until then."
	},
	{ role: 'caller', text: 'Thank you so much.' }
];

export function seedReports(now = Date.now()): Report[] {
	const seeds: Seed[] = [
		...OLD_LEVELS.map((level, i) => ({
			level,
			ageHours: 30 + i * 7,
			text: OLD_TEXTS[i % OLD_TEXTS.length].replace('{L}', String(level))
		})),
		...WATER_LEVELS.map((level, i) => ({
			level,
			ageHours: 27 + i * 9,
			text: WATER_TEXTS[i % WATER_TEXTS.length].replace('{L}', String(level))
		})),
		...RECENT
	].sort((a, b) => b.ageHours - a.ageHours);

	// Pin each earlier report to a named building. On level 3 they cluster around the
	// Johnson Center, so the demo call's radar finds them.
	const all = buildings();
	const jc = all[2].find((b) => b.label === 'Johnson Center')!;
	const near = (list: Building[]) =>
		list === all[2]
			? [...list]
					.sort((a, b) => Math.hypot(a.x - jc.x, a.y - jc.y) - Math.hypot(b.x - jc.x, b.y - jc.y))
					.slice(0, 6)
			: list;
	const turn: Record<number, number> = {};

	const out: Report[] = [];
	for (const s of seeds) {
		const list = near(all[s.level - 1] ?? []);
		const i = (turn[s.level] = (turn[s.level] ?? -1) + 1);
		out.push(
			buildReport(
				{
					transcript: [{ role: 'caller', text: s.text }],
					t: now - s.ageHours * 3_600_000,
					source: 'seed',
					buildingKey: list.length ? list[i % list.length].key : undefined
				},
				out,
				now
			)
		);
	}
	return out;
}
