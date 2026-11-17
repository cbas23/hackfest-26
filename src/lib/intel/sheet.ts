/**
 * Clinic spreadsheets: the offline path for data when the network is down.
 *
 * Clinics keep a daily log in whatever spreadsheet they have (saved as CSV) and a runner carries
 * it between levels. This reads it deterministically: column names are mapped through the shared
 * vocabulary, dates in mixed formats are normalized, duplicate days are dropped and blank cells
 * stay missing (never zero). Later the Intake agent maps columns this can't recognize; its
 * mapping is checked against the same vocabulary.
 */
import { LEVELS } from '#lib/hollow/data.js';
import type { InhalerStock } from './detect.js';
import type { LevelCode } from './types.js';
import { conceptsIn } from './vocabulary.js';

export type SheetField =
	'date' | 'site' | 'respiratoryPatients' | 'inhalersDispensed' | 'inhalersInStock' | 'notes';

export const FIELD_LABEL: Record<SheetField, string> = {
	date: 'date',
	site: 'clinic',
	respiratoryPatients: 'respiratory patients',
	inhalersDispensed: 'inhalers dispensed',
	inhalersInStock: 'inhalers in stock',
	notes: 'notes'
};

export interface SheetColumn {
	header: string;
	field?: SheetField;
}

export interface SheetRow {
	/** ISO date, e.g. 2087-11-14. */
	date: string;
	respiratoryPatients?: number;
	inhalersDispensed?: number;
	inhalersInStock?: number;
	notes?: string;
}

export interface SheetIssue {
	/** 1-based spreadsheet row (the header is row 1). */
	row: number;
	message: string;
}

export interface ClinicSheet {
	fileName: string;
	place?: string;
	level?: LevelCode;
	columns: SheetColumn[];
	rows: SheetRow[];
	issues: SheetIssue[];
	/** Stock picture from the sheet, in the same shape the dashboard uses for reports. */
	stock?: InhalerStock;
}

const DEFAULT_YEAR = 2087;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUMBER_WORDS = [
	'zero',
	'one',
	'two',
	'three',
	'four',
	'five',
	'six',
	'seven',
	'eight',
	'nine',
	'ten'
];

/** Minimal CSV reader: commas, quoted cells with commas or doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			row.push(cell);
			cell = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else cell += ch;
	}
	if (cell || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows.filter((r) => r.some((c) => c.trim()));
}

/** Which field a column holds, from its header wording. */
export function fieldFor(header: string): SheetField | undefined {
	const h = header.toLowerCase();
	const concepts = conceptsIn(h);
	if (/\bdate\b|\bday\b/.test(h)) return 'date';
	if (/\bsite\b|\bclinic\b|\bpost\b|\blocation\b/.test(h)) return 'site';
	if (/\bnotes?\b|\bcomments?\b|\bremarks?\b/.test(h)) return 'notes';
	if (concepts.includes('inhaler')) {
		if (/\b(given|dispensed|handed|issued|used|out)\b/.test(h)) return 'inhalersDispensed';
		if (/\b(left|shelf|stock|on hand|remaining)\b/.test(h)) return 'inhalersInStock';
	}
	if (concepts.includes('respiratory') && /\b(pts|patients|seen|cases)\b/.test(h))
		return 'respiratoryPatients';
	return undefined;
}

/** "2087-11-10", "11 Nov", "12/11/2087" (day first) → ISO date, or undefined. */
export function parseDate(raw: string): string | undefined {
	const s = raw.trim().toLowerCase();
	const pad = (n: number) => String(n).padStart(2, '0');
	let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
	if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
	m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
	if (m) return `${m[3] ?? DEFAULT_YEAR}-${pad(+m[2])}-${pad(+m[1])}`;
	m = s.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*(?:\s+(\d{4}))?$/);
	if (m && MONTHS.includes(m[2]))
		return `${m[3] ?? DEFAULT_YEAR}-${pad(MONTHS.indexOf(m[2]) + 1)}-${pad(+m[1])}`;
	return undefined;
}

const normalizeName = (s: string) =>
	s
		.toLowerCase()
		.replace(/\b(\d{1,2})\b/g, (d) => NUMBER_WORDS[+d] ?? d)
		.replace(/[^a-z ]/g, '')
		.trim();

/** "Clinic 9" → Clinic Nine on L3, matched against the clinics in `hollow/data.ts`. */
export function clinicFor(site: string): { place: string; level: LevelCode } | undefined {
	const want = normalizeName(site);
	for (const l of LEVELS)
		for (const f of l.facilities)
			if (f.kind === 'clinic' && normalizeName(f.name) === want)
				return { place: f.name, level: l.code as LevelCode };
	return undefined;
}

function number(raw: string | undefined): number | undefined | 'bad' {
	const s = (raw ?? '').trim();
	if (!s) return undefined;
	const n = Number(s.replace(/,/g, ''));
	return Number.isFinite(n) && n >= 0 ? n : 'bad';
}

export function readClinicSheet(text: string, fileName: string): ClinicSheet {
	const [header = [], ...body] = parseCsv(text);
	const columns: SheetColumn[] = header.map((h) => {
		const field = fieldFor(h);
		return field ? { header: h.trim(), field } : { header: h.trim() };
	});
	const col = (f: SheetField) => columns.findIndex((c) => c.field === f);
	const issues: SheetIssue[] = [];
	for (const c of columns)
		if (!c.field) issues.push({ row: 1, message: `Column "${c.header}" not recognized, skipped` });

	const byDate = new Map<string, SheetRow>();
	let site: string | undefined;
	body.forEach((cells, i) => {
		const row = i + 2;
		const date = parseDate(cells[col('date')] ?? '');
		if (!date) {
			issues.push({ row, message: `Unreadable date "${cells[col('date')] ?? ''}", row skipped` });
			return;
		}
		if (col('site') >= 0 && cells[col('site')]?.trim()) site ??= cells[col('site')].trim();
		const out: SheetRow = { date };
		for (const f of ['respiratoryPatients', 'inhalersDispensed', 'inhalersInStock'] as const) {
			if (col(f) < 0) continue;
			const v = number(cells[col(f)]);
			if (v === 'bad') issues.push({ row, message: `${FIELD_LABEL[f]} isn't a number` });
			else if (v === undefined)
				issues.push({ row, message: `${FIELD_LABEL[f]} blank: kept as missing, not zero` });
			else out[f] = v;
		}
		const note = cells[col('notes')]?.trim();
		if (note) out.notes = note;
		const prev = byDate.get(date);
		if (prev && JSON.stringify(prev) === JSON.stringify(out)) {
			issues.push({ row, message: `Duplicate of ${date}, counted once` });
			return;
		}
		if (prev) issues.push({ row, message: `Second entry for ${date}, later one kept` });
		byDate.set(date, out);
	});

	const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
	const clinic = site ? clinicFor(site) : undefined;
	if (site && !clinic) issues.push({ row: 2, message: `Clinic "${site}" not found on the map` });

	// Stock: latest count on the shelf, rate from the last 7 logged days.
	let stock: InhalerStock | undefined;
	const latest = [...rows].reverse().find((r) => r.inhalersInStock !== undefined);
	const recent = rows.slice(-7).filter((r) => r.inhalersDispensed !== undefined);
	if (clinic && latest && recent.length) {
		const perDay = recent.reduce((s, r) => s + r.inhalersDispensed!, 0) / recent.length;
		stock = {
			level: clinic.level,
			place: clinic.place,
			inStock: latest.inhalersInStock!,
			dispensedThisWeek: Math.round(perDay * 7),
			daysLeft: perDay > 0 ? Math.round(latest.inhalersInStock! / perDay) : Infinity,
			reportId: `SHEET:${fileName}`
		};
	}

	return { fileName, ...(clinic ?? {}), columns, rows, issues, ...(stock ? { stock } : {}) };
}
