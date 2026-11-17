/** Check the fictional intel data against the Hollow map data. Run: `bun scripts/validate-intel.ts`. */
import { HISTORY, historyFor } from '../src/lib/intel/history.ts';
import { REPORTS } from '../src/lib/intel/reports.ts';
import { validateHistory, validateReports, validateVocabulary } from '../src/lib/intel/validate.ts';

const checks = {
	reports: validateReports(REPORTS),
	vocabulary: validateVocabulary(REPORTS),
	history: validateHistory(HISTORY)
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

if (failed) process.exit(1);
