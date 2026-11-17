/**
 * Session state shared by the Intelligence and MedDash pages: the uploaded clinic sheet and the
 * reorders a person approved. Demo only; it resets on reload and nothing is sent anywhere.
 */
import type { ClinicSheet } from './sheet.js';
import { nowIso, type LedgerEntry } from './supply.js';

export const session = $state<{
	sheet?: ClinicSheet;
	/** Approved reorders keyed by receiving clinic. */
	approved: Record<string, LedgerEntry>;
}>({ approved: {} });

export function approve(entry: Omit<LedgerEntry, 'approvedAt'>) {
	session.approved[entry.to] = { ...entry, approvedAt: nowIso() };
}

export function undo(place: string) {
	delete session.approved[place];
}
