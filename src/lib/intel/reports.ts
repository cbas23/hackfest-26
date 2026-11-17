import type { Report } from './types.js';

/**
 * FICTIONAL DATA. Twelve simulated documents from the week of 10–14 November 2087.
 *
 * The story they tell (and that the app should be able to find on its own):
 * - L3 The Warrens: local sources report 31–58 people with respiratory symptoms, the
 *   Directorate reports 12 confirmed cases. Clinic and coordinator counts overlap, so they
 *   form a range, not a sum.
 * - Environmental evidence points at the air: a fan failure at Stackhouse Vents, critical CO₂
 *   at Warrens Air Exchange, and a 31-hour blackout that stopped ventilation.
 * - Clinic Nine is running out of inhalers; Commons Clinic on L2 has stock to spare.
 * - L2 Lampline is the control: local and official numbers agree there.
 * - L4 Lowmarch shows a smaller rise worth watching.
 * - One tally arrived three days late, after the blackout, to test late-data handling.
 *
 * Places must exist in `hollow/data.ts`; `validate.ts` checks this.
 */
export const REPORTS: Report[] = [
	{
		id: 'DOC-CLN-009',
		title: 'Clinic Nine shift report',
		source: 'clinic',
		author: 'Nurse lead R. Okafor, Clinic Nine',
		method: 'clinic-intake-log',
		location: { level: 'L3', place: 'Clinic Nine' },
		period: { start: '2087-11-10', end: '2087-11-14' },
		submittedAt: '2087-11-14T22:00',
		receivedAt: '2087-11-14T22:40',
		verification: 'verified',
		figures: [
			{
				label: 'Patients with respiratory symptoms',
				value: 31,
				unit: 'patients',
				countType: 'patients'
			},
			{ label: 'Patients admitted for oxygen', value: 4, unit: 'patients', countType: 'patients' },
			{ label: 'Clinic beds', value: 12, unit: 'beds', countType: 'signal' }
		],
		body: 'Week of 10–14 Nov. We saw 31 patients with cough, chest tightness or shortness of breath, logged by resident ID. Four needed oxygen and were admitted. Most live in the north-west and north blocks near the Stackhouse stairs. Usual week is under ten. We are at capacity in the evenings and running low on inhalers (see pharmacy note).'
	},
	{
		id: 'DOC-COM-004',
		title: 'Warrens coordinator health tally',
		source: 'community',
		author: 'Block coordinator T. Vance, north Warrens',
		method: 'coordinator-tally',
		location: { level: 'L3', sectors: ['North-West', 'North'] },
		period: { start: '2087-11-10', end: '2087-11-14' },
		submittedAt: '2087-11-14T18:30',
		receivedAt: '2087-11-14T21:10',
		verification: 'unverified',
		figures: [
			{
				label: 'Residents reporting respiratory symptoms',
				value: 46,
				unit: 'reports',
				countType: 'reports'
			},
			{
				label: 'Households asking for help reaching a clinic',
				value: 9,
				unit: 'households',
				countType: 'reports'
			}
		],
		body: 'Door-to-door tally, north-west and north blocks, 10–14 Nov. 46 residents told us they have a bad cough or trouble breathing. Some have already been to Clinic Nine, some say the queue is too long. Nine households asked for help getting an elder to the clinic. Air feels thick at night since the fans at Stackhouse went quiet.'
	},
	{
		id: 'DOC-KSK-011',
		title: 'Old Line Junction kiosk self-reports',
		source: 'kiosk',
		author: 'Anonymous residents via ration kiosk',
		method: 'kiosk-form',
		location: { level: 'L3', place: 'Old Line Junction' },
		period: { start: '2087-11-10', end: '2087-11-14' },
		submittedAt: '2087-11-14T23:59',
		receivedAt: '2087-11-15T00:15',
		verification: 'unverified',
		figures: [
			{
				label: 'Anonymous respiratory symptom reports',
				value: 19,
				unit: 'reports',
				countType: 'reports'
			}
		],
		body: 'Automated weekly export from the ration kiosk health form. 19 anonymous submissions selected "cough" or "trouble breathing". 11 of them also selected "did not visit a clinic". Free-text answers mention fear of quarantine and losing ration days.'
	},
	{
		id: 'DOC-DIR-021',
		title: 'Directorate health bulletin 21: The Warrens',
		source: 'directorate',
		author: 'Directorate Office of Public Health',
		method: 'official-bulletin',
		location: { level: 'L3' },
		period: { start: '2087-11-10', end: '2087-11-14' },
		submittedAt: '2087-11-15T09:00',
		receivedAt: '2087-11-15T09:00',
		verification: 'official',
		figures: [
			{
				label: 'Confirmed respiratory infection cases',
				value: 12,
				unit: 'cases',
				countType: 'confirmed'
			}
		],
		body: 'Bulletin 21, Level 3. Twelve laboratory-confirmed cases of respiratory infection were recorded this week. The situation is under control. Residents should continue normal routines and report to Directorate clinics for testing. Unverified community claims should not be shared.'
	},
	{
		id: 'DOC-PHR-009',
		title: 'Clinic Nine pharmacy stock note',
		source: 'pharmacy',
		author: 'Pharmacist A. Mbeki, Clinic Nine',
		method: 'dispensing-record',
		location: { level: 'L3', place: 'Clinic Nine' },
		period: { start: '2087-11-10', end: '2087-11-14' },
		submittedAt: '2087-11-14T20:00',
		receivedAt: '2087-11-14T20:25',
		verification: 'verified',
		figures: [
			{ label: 'Inhalers dispensed this week', value: 42, unit: 'inhalers', countType: 'signal' },
			{
				label: 'Inhalers dispensed, usual week',
				value: 14,
				unit: 'inhalers',
				countType: 'signal'
			},
			{ label: 'Inhalers in stock', value: 18, unit: 'inhalers', countType: 'signal' },
			{ label: 'Filter masks in stock', value: 140, unit: 'masks', countType: 'signal' }
		],
		body: 'Dispensed 42 bronchodilator inhalers this week against a usual 14. 18 left on the shelf. At this rate we run out in about three days. Restock request sent on 12 Nov, no delivery date yet. Masks holding at 140.'
	},
	{
		id: 'DOC-MNT-037',
		title: 'Stackhouse Vents maintenance log',
		source: 'maintenance',
		author: 'Ventilation crew 3, Warrens',
		method: 'maintenance-log',
		location: { level: 'L3', place: 'Stackhouse Vents', sectors: ['North-West', 'North'] },
		period: { start: '2087-11-09', end: '2087-11-13' },
		submittedAt: '2087-11-13T16:00',
		receivedAt: '2087-11-13T16:45',
		verification: 'verified',
		figures: [
			{ label: 'Main fans offline', value: 2, unit: 'fans', countType: 'signal' },
			{ label: 'Main fans total', value: 3, unit: 'fans', countType: 'signal' }
		],
		body: 'Fans 1 and 2 tripped during the 9 Nov blackout and did not restart. Fan 3 running at reduced speed. Replacement motor requested from Directorate stores on 10 Nov; status: pending approval. Mould growth noted on filter housings. North-west and north blocks have reduced airflow until repaired.'
	},
	{
		id: 'DOC-SEN-031',
		title: 'Warrens Air Exchange sensor summary',
		source: 'sensor',
		author: 'Automated sensor feed, Warrens Air Exchange',
		method: 'sensor-feed',
		location: { level: 'L3', place: 'Warrens Air Exchange' },
		period: { start: '2087-11-09', end: '2087-11-14' },
		submittedAt: '2087-11-14T23:00',
		receivedAt: '2087-11-14T23:00',
		verification: 'verified',
		figures: [
			{ label: 'Peak CO₂', value: 2350, unit: 'ppm', countType: 'signal' },
			{ label: 'Average CO₂, usual week', value: 900, unit: 'ppm', countType: 'signal' },
			{ label: 'Average temperature', value: 38, unit: '°C', countType: 'signal' },
			{ label: 'Average humidity', value: 81, unit: '%', countType: 'signal' }
		],
		body: 'CO₂ crossed the critical threshold on 11 Nov and peaked at 2,350 ppm (usual average 900). Temperature averaged 38 °C, humidity 81%. Readings missing for 31 hours on 9–10 Nov during the blackout.'
	},
	{
		id: 'DOC-PWR-030',
		title: 'Level 3 power outage notice',
		source: 'power',
		author: 'Geothermal grid office, deep levels',
		method: 'outage-notice',
		location: { level: 'L3' },
		period: { start: '2087-11-09T04:00', end: '2087-11-10T11:00' },
		submittedAt: '2087-11-10T12:00',
		receivedAt: '2087-11-10T12:05',
		verification: 'official',
		figures: [{ label: 'Outage length', value: 31, unit: 'hours', countType: 'signal' }],
		body: 'Rolling blackout on Level 3 from 04:00 on 9 Nov to 11:00 on 10 Nov (31 hours) to protect supply to upper levels. Ventilation and network service were interrupted. Some equipment may need manual restart.'
	},
	{
		id: 'DOC-CLN-002',
		title: 'Commons Clinic shift report',
		source: 'clinic',
		author: 'Nurse lead J. Park, Commons Clinic',
		method: 'clinic-intake-log',
		location: { level: 'L2', place: 'Commons Clinic' },
		period: { start: '2087-11-10', end: '2087-11-14' },
		submittedAt: '2087-11-14T21:00',
		receivedAt: '2087-11-14T21:05',
		verification: 'verified',
		figures: [
			{
				label: 'Patients with respiratory symptoms',
				value: 6,
				unit: 'patients',
				countType: 'patients'
			},
			{ label: 'Inhalers in stock', value: 160, unit: 'inhalers', countType: 'signal' }
		],
		body: 'Quiet week. Six patients with mild respiratory symptoms, in line with usual. Pharmacy holds 160 inhalers, well above our needs; we can release stock to other clinics if the Directorate approves transport.'
	},
	{
		id: 'DOC-DIR-020',
		title: 'Directorate health bulletin 21: Lampline',
		source: 'directorate',
		author: 'Directorate Office of Public Health',
		method: 'official-bulletin',
		location: { level: 'L2' },
		period: { start: '2087-11-10', end: '2087-11-14' },
		submittedAt: '2087-11-15T09:00',
		receivedAt: '2087-11-15T09:00',
		verification: 'official',
		figures: [
			{
				label: 'Confirmed respiratory infection cases',
				value: 5,
				unit: 'cases',
				countType: 'confirmed'
			}
		],
		body: 'Bulletin 21, Level 2. Five laboratory-confirmed cases of respiratory infection were recorded this week. No unusual activity.'
	},
	{
		id: 'DOC-CLN-004',
		title: 'Lowmarch Clinic shift report',
		source: 'clinic',
		author: 'Medic S. Reyes, Lowmarch Clinic',
		method: 'clinic-intake-log',
		location: { level: 'L4', place: 'Lowmarch Clinic' },
		period: { start: '2087-11-10', end: '2087-11-14' },
		submittedAt: '2087-11-14T23:30',
		receivedAt: '2087-11-15T02:10',
		verification: 'verified',
		figures: [
			{
				label: 'Patients with respiratory symptoms',
				value: 14,
				unit: 'patients',
				countType: 'patients'
			}
		],
		body: '14 patients with respiratory symptoms this week, a little above our usual 9 to 11. Several work shifts on Level 3. Nothing urgent yet; flagging so someone keeps an eye on it.'
	},
	{
		id: 'DOC-COM-005',
		title: 'West Warrens coordinator tally (late)',
		source: 'community',
		author: 'Block coordinator M. Ilunga, west Warrens',
		method: 'coordinator-tally',
		location: { level: 'L3', sectors: ['West'] },
		period: { start: '2087-11-10', end: '2087-11-12' },
		submittedAt: '2087-11-12T19:00',
		receivedAt: '2087-11-15T14:00',
		verification: 'unverified',
		figures: [
			{
				label: 'Residents reporting respiratory symptoms',
				value: 9,
				unit: 'reports',
				countType: 'reports'
			}
		],
		body: 'Paper tally carried up by runner, network still unreliable after the blackout. West blocks, 10–12 Nov: nine residents with cough or chest pain. Fewer than north side but rising.'
	}
];

export function reportById(id: string): Report | undefined {
	return REPORTS.find((r) => r.id === id);
}
