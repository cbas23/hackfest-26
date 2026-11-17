/** Check the fictional report dataset against the Hollow map data. Run: `bun scripts/validate-intel.ts`. */
import { REPORTS } from '../src/lib/intel/reports.ts';
import { validateReports } from '../src/lib/intel/validate.ts';

const problems = validateReports(REPORTS);
if (problems.length > 0) {
	console.error(`${problems.length} problem(s) in the report dataset:`);
	for (const p of problems) console.error(`  - ${p}`);
	process.exit(1);
}
console.log(`All ${REPORTS.length} reports are valid.`);
