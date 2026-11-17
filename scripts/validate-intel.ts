/** Check the fictional intel data against the Hollow map data. Run: `bun scripts/validate-intel.ts`. */
import { assessLevel } from '../src/lib/intel/detect.ts';
import { HISTORY, historyFor } from '../src/lib/intel/history.ts';
import { REPORTS } from '../src/lib/intel/reports.ts';
import {
	validateDetection,
	validateHistory,
	validateReports,
	validateVocabulary
} from '../src/lib/intel/validate.ts';
import type { LevelCode } from '../src/lib/intel/types.ts';

const checks = {
	reports: validateReports(REPORTS),
	vocabulary: validateVocabulary(REPORTS),
	history: validateHistory(HISTORY),
	detection: validateDetection(REPORTS)
};

let failed = false;
for (const [name, problems] of Object.entries(checks)) {
	if (problems.length === 0) {
		console.log(`✓ ${name}`);
		continue;
	}
	failed = true;
	console.error(`✗ ${name}: ${problems.length} problem(s)`);
	for (const p of problems) console.error(`  - ${p}`);
}

const l3 = historyFor('L3')
	.map((w) => `${w.isoWeek}:${w.clinicPatients}${w.incidentId ? '*' : ''}`)
	.join(' ');
console.log(`\nL3 clinic patients by ISO week (* = past incident): ${l3}`);
console.log(`${REPORTS.length} reports, ${HISTORY.length} history weeks`);

console.log('\nThis week (ISO 46):');
for (const code of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'] as LevelCode[]) {
	const a = assessLevel(code, REPORTS);
	const parts: string[] = [];
	if (a.patients) {
		const p = a.patients;
		parts.push(`${p.value} patients = ${p.ratio}× normal (${p.baseline.mean}) → ${p.severity}`);
	}
	if (a.range.sources.length > 1) {
		parts.push(`range ${a.range.verified} verified · ${a.range.likely} likely · ≤${a.range.high}`);
	}
	if (a.gap) {
		const g = a.gap;
		parts.push(
			`Directorate ${g.confirmed}: ${g.expectedGap} expected gap + ${g.unexplainedGap} unexplained${g.flagged ? ' ⚑' : ''}`
		);
	}
	if (!a.completeness.complete) parts.push(`incomplete: ${a.completeness.reasons.join(', ')}`);
	console.log(`  ${code}  ${parts.join(' | ')}`);
}

if (failed) process.exit(1);
