/**
 * Report types for Hollow Guardian's Intelligence Center.
 *
 * Every report is fictional and simulated. The fields exist so the app can be honest about
 * where a number came from and what it actually counts:
 * - a clinic counts patients (with resident IDs, so duplicates can be removed),
 * - a coordinator counts reports (the same person may appear twice),
 * - the Directorate counts only lab-confirmed cases,
 * - a pharmacy or sensor gives an indirect signal, not a count of sick people.
 * Numbers with different count types must never be added together.
 *
 * Locations use level codes, named places and sectors, never map grid coordinates, so reports
 * stay valid if the generated map changes size.
 */

/** Who produced the document. */
export type ReportSource =
	| 'clinic'
	| 'community'
	| 'kiosk'
	| 'directorate'
	| 'pharmacy'
	| 'maintenance'
	| 'sensor'
	| 'power';

/** How the information reached the system. */
export type CollectionMethod =
	| 'clinic-intake-log'
	| 'coordinator-tally'
	| 'kiosk-form'
	| 'official-bulletin'
	| 'dispensing-record'
	| 'maintenance-log'
	| 'sensor-feed'
	| 'outage-notice';

/**
 * What a figure counts.
 * - `patients`: individual people seen, identifiable, can be de-duplicated
 * - `reports`: symptom reports, may include the same person more than once
 * - `confirmed`: lab-confirmed cases only (the Directorate's definition)
 * - `signal`: indirect evidence such as dispensing, sensor readings or outages
 */
export type CountType = 'patients' | 'reports' | 'confirmed' | 'signal';

/** The nine districts of a floor (its 3×3 compass sectors, e.g. "North-East"). */
export type Sector =
	| 'North-West'
	| 'North'
	| 'North-East'
	| 'West'
	| 'Central'
	| 'East'
	| 'South-West'
	| 'South'
	| 'South-East';

/** Level codes L1–L7, matching `LEVELS` in `hollow/data.ts`. */
export type LevelCode = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7';

export type Verification = 'verified' | 'unverified' | 'official';

export interface ReportLocation {
	level: LevelCode;
	/** Facility name from `hollow/data.ts` (e.g. "Clinic Nine"), when the report is about one. */
	place?: string;
	/** Districts the report covers, when it names them. */
	sectors?: Sector[];
}

/** One figure stated in a report, always tagged with what it counts. */
export interface ReportFigure {
	label: string;
	value: number;
	unit: string;
	countType: CountType;
}

/** ISO date (YYYY-MM-DD) or date-time strings, in the Hollow's year 2087. */
export interface ReportPeriod {
	start: string;
	end: string;
}

export interface Report {
	/** Document ID, e.g. "DOC-CLN-009". */
	id: string;
	title: string;
	source: ReportSource;
	/** The person or office that wrote it. Fictional. */
	author: string;
	method: CollectionMethod;
	location: ReportLocation;
	period: ReportPeriod;
	/** When the author sent it. */
	submittedAt: string;
	/** When Hollow Guardian received it. Later than `submittedAt` after blackouts or by runner. */
	receivedAt: string;
	verification: Verification;
	figures: ReportFigure[];
	/** The document's own wording, as it would arrive. The AI reads this text later. */
	body: string;
}
