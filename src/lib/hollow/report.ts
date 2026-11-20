/**
 * Resident reports: a resident writes what's wrong at their home, and the report agent
 * (`#lib/server/reportAgent.ts`, behind `POST /api/report`) reads it next to the city's current
 * state and edits that state to match (adds, moves or clears points, blocks or reopens tunnels).
 * All of it is fictional. These are the plain shapes shared by the sidebar and the server.
 */
import type { PointKind } from './state.js';

/** What the sidebar sends. */
export interface ReportRequest {
	/** The resident's words. */
	message: string;
	/** Their home block, as a place key ("<level>:<roomId>"). */
	home: string;
}

/** One edit the agent made to the shared state. */
export interface ReportChange {
	action: 'added' | 'updated' | 'removed' | 'blocked' | 'reopened';
	/** The data layer it shows on. */
	layer: PointKind | 'tunnels';
	level: number;
	/** One line for the resident, e.g. "Bad air near Block L3-42 (reach 8, strength 0.7)". */
	text: string;
}

/** What the agent answers. */
export interface ReportResult {
	/** A short reply to the resident. */
	reply: string;
	/** What it changed (empty when the report needed no change). */
	changes: ReportChange[];
}

export const REPORT_MAX_LENGTH = 600;
