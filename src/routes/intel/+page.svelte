<script lang="ts">
	import { resolve } from '$app/paths';
	import { LEVELS } from '#lib/hollow/data.js';
	import { assessLevel, sectorRisk, type Severity } from '#lib/intel/detect.js';
	import { clinicProposalFor, people, REACH_MINUTES } from '#lib/intel/clinics.js';
	import { CURRENT_WEEK, historyFor } from '#lib/intel/history.js';
	import { session, undo } from '#lib/intel/orders.svelte.js';
	import { allClinicStock } from '#lib/intel/stock.js';
	import { LOW_DAYS, planAll, TARGET_DAYS } from '#lib/intel/supply.js';
	import DaysRing from '#lib/intel/ui/DaysRing.svelte';
	import { fly } from 'svelte/transition';
	import AgentPipeline from '#lib/intel/ui/AgentPipeline.svelte';
	import AgentUpdates from '#lib/intel/ui/AgentUpdates.svelte';
	import type { Pipeline } from '#lib/intel/pipeline.js';
	import { REPORTS } from '#lib/intel/reports.js';
	import type { LevelCode } from '#lib/intel/types.js';
	import Icon from '#lib/intel/ui/Icon.svelte';
	import TrendChart from '#lib/intel/ui/TrendChart.svelte';
	import MapView from '#lib/intel/ui/MapView.svelte';
	import Sidebar from '#lib/intel/ui/Sidebar.svelte';

	// Every number on this page comes from plain code in `#lib/intel`. No AI, no network.
	const assessed = LEVELS.map((l) => ({
		...assessLevel(l.code as LevelCode, REPORTS),
		name: l.name
	}));
	const RANK: Record<Severity | 'none', number> = { alert: 3, watch: 2, normal: 1, none: 0 };
	const sev = (a: (typeof assessed)[number]) => a.patients?.severity ?? 'none';
	const top = [...assessed].sort((a, b) => RANK[sev(b)] - RANK[sev(a)])[0];
	const alerts = assessed.filter((a) => sev(a) === 'alert').length;
	// Inhaler stock for every clinic; an uploaded clinic sheet replaces its clinic's figure.
	const stock = $derived(allClinicStock(session.sheet?.stock));
	const plans = $derived(planAll(stock));

	let code = $state<LevelCode>(top.level);
	/** Latest agent pipeline run, shared between the pipeline and the update cards. */
	let pipe = $state<Pipeline>();
	let pipeStage = $state<number>();
	/** The map fills in once Intake has merged the report; alerts and insights once the Investigator is done. */
	const mapped = $derived((pipeStage ?? 0) >= 3);
	const alerted = $derived((pipeStage ?? 0) >= 4);

	const cur = $derived(assessed.find((a) => a.level === code) ?? top);
	const points = $derived([
		...historyFor(code).map((w) => ({
			week: w.isoWeek,
			value: w.clinicPatients,
			...(w.incidentId ? { incident: w.incidentId } : {})
		})),
		{
			week: CURRENT_WEEK.isoWeek,
			...(alerted && cur.patients ? { value: cur.patients.value } : {}),
			now: true
		}
	]);
	const baseline = $derived.by(() => {
		if (cur.patients) return cur.patients.baseline;
		const v = historyFor(code).map((w) => w.clinicPatients);
		const mean = Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
		return {
			level: code,
			metric: 'clinicPatients' as const,
			weeks: v.length,
			mean,
			sd: 0,
			low: Math.min(...v),
			high: Math.max(...v)
		};
	});
	const pct = (v: number, mean: number) => Math.round((v / mean - 1) * 100);

	const reports = $derived(REPORTS.filter((r) => r.location.level === code));
	const sectors = $derived(sectorRisk(code, REPORTS));
	const levelStock = $derived(stock.find((s) => s.level === code));
	const clinicPlan = $derived(clinicProposalFor(LEVELS.findIndex((l) => l.code === code)));
	const reorder = $derived(plans.find((p) => p.target.place === levelStock?.place));
	/** Reorders approved this session (shared with MedDash; demo only, not saved). */
	const done = $derived(levelStock ? session.approved[levelStock.place] : undefined);

	const NO_SEVERITY = Object.fromEntries(LEVELS.map((l) => [l.code, 'none'])) as Record<
		LevelCode,
		Severity | 'none'
	>;
	const severities = Object.fromEntries(assessed.map((a) => [a.level, sev(a)])) as Record<
		LevelCode,
		Severity | 'none'
	>;
	const mapPlaces = $derived(
		[...new Set(reports.flatMap((r) => (r.location.place ? [r.location.place] : [])))].map(
			(name) => {
				const from = reports.filter((r) => r.location.place === name);
				const tone: 'alert' | 'issue' | 'info' =
					from.some((r) => r.source === 'clinic') && cur.patients?.severity === 'alert'
						? 'alert'
						: from.some((r) => ['maintenance', 'sensor', 'power'].includes(r.source))
							? 'issue'
							: 'info';
				return { name, tone };
			}
		)
	);

	const MONTHS = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];
	const when = (s: string) => {
		const [, m, d] = s.slice(0, 10).split('-');
		return `${Number(d)} ${MONTHS[Number(m) - 1]}${s.length > 10 ? `, ${s.slice(11, 16)}` : ''}`;
	};

	const card = 'rounded-2xl border border-white/10 bg-[#141b2d]/90 p-4 shadow-xl shadow-black/20';
</script>

<svelte:head>
	<title>Intelligence Center · Hollow Guardian</title>
</svelte:head>

<div class="min-h-screen bg-[#0b1020] font-sans text-slate-200 lg:flex">
	<Sidebar
		active="intel"
		week="{CURRENT_WEEK.isoWeek} · {when(CURRENT_WEEK.start)}–{when(CURRENT_WEEK.end)}"
	/>

	<main class="min-w-0 flex-1 space-y-4 p-4 lg:p-5">
		<!-- Header -->
		<header class="{card} flex flex-wrap items-center justify-between gap-3 py-3">
			<div class="flex items-center gap-3">
				<span class="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/15 text-blue-300">
					<Icon name="intel" class="h-6 w-6" />
				</span>
				<div>
					<h1 class="text-xl font-semibold text-slate-100 sm:text-2xl">Intelligence Center</h1>
					<p class="text-sm text-slate-400">Evidence-backed alerts from {REPORTS.length} reports</p>
				</div>
			</div>
			<div class="flex items-center gap-4 text-sm">
				<span class="hidden items-center gap-2 text-slate-300 sm:flex">
					<Icon name="pulse" class="h-5 w-5 text-emerald-400" />
					Week {CURRENT_WEEK.isoWeek}, 2087
				</span>
				<span class="flex items-center gap-2 text-slate-300">
					Alerts
					<span
						class="grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs font-bold {alerted &&
						alerts
							? 'bg-red-500 text-white'
							: 'bg-white/10'}">{alerted ? alerts : 0}</span
					>
				</span>
				<a
					href={resolve('/hollow')}
					class="rounded-lg border border-white/10 px-3 py-1.5 text-slate-200 hover:border-blue-400"
					>Open map</a
				>
			</div>
		</header>

		<!-- Alert banner -->
		{#if alerted && top.patients?.severity === 'alert'}
			<div
				transition:fly={{ y: -12, duration: 400 }}
				class="flex flex-wrap items-center gap-4 rounded-2xl border border-red-500/50 bg-gradient-to-r from-red-950/80 to-red-900/20 px-5 py-4"
			>
				<Icon name="alert" class="h-10 w-10 shrink-0 text-red-400" />
				<div class="min-w-0 flex-1">
					<div class="text-lg font-semibold text-red-300">
						Unusual respiratory spike detected: {top.level}
						{top.name}
					</div>
					<div class="text-sm text-slate-300">
						{top.patients.value} clinic patients this week, +{pct(
							top.patients.value,
							top.patients.baseline.mean
						)}% vs normal ({top.patients.baseline.mean}/week).
						{#if top.gap?.flagged}Directorate reports {top.gap.confirmed}.{/if}
					</div>
				</div>
			</div>
		{/if}

		<!-- AI agents: report in → merge → graph and summary → Supply and Dash -->
		<AgentPipeline bind:result={pipe} bind:progress={pipeStage} />

		<!-- Row: map + key insights -->
		<div class="grid gap-4 xl:grid-cols-12">
			<section class="{card} flex flex-col xl:col-span-7">
				<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 class="flex items-center gap-2 text-lg font-semibold text-slate-100">
							<Icon name="map" class="h-5 w-5 text-blue-400" /> Hollow map
						</h2>
						<p class="text-xs text-slate-400">
							{cur.level}
							{cur.name}: housing tinted by risk, places from this week's reports
						</p>
					</div>
					<a
						href={resolve('/hollow')}
						class="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 hover:border-blue-400"
						>Open full map →</a
					>
				</div>
				<div class="h-[380px] xl:h-auto xl:min-h-[380px] xl:flex-1">
					<MapView
						level={code}
						sectors={mapped ? sectors : []}
						places={mapped ? mapPlaces : []}
						severities={mapped ? severities : NO_SEVERITY}
						proposed={clinicPlan}
						onLevel={(c) => (code = c)}
					/>
				</div>
				{#if mapped && cur.range.sources.length}
					<div class="mt-3 grid grid-cols-3 gap-2 text-center">
						<div class="rounded-xl bg-white/[0.03] p-2">
							<div class="text-lg font-semibold text-emerald-300">{cur.range.verified}</div>
							<div class="text-[11px] text-slate-400">verified</div>
						</div>
						<div class="rounded-xl bg-white/[0.03] p-2">
							<div class="text-lg font-semibold text-amber-300">{cur.range.likely}</div>
							<div class="text-[11px] text-slate-400">largest source</div>
						</div>
						<div class="rounded-xl bg-white/[0.03] p-2">
							<div class="text-lg font-semibold text-slate-200">≤{cur.range.high}</div>
							<div class="text-[11px] text-slate-400">if no overlap</div>
						</div>
					</div>
					{#if cur.range.sources.length > 1}
						<p class="mt-2 text-xs text-slate-500">
							{cur.range.sources.length} sources overlap, so they're shown as a range, never added up.
						</p>
					{/if}
				{/if}
			</section>

			<section class="{card} xl:col-span-5">
				<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
					<h2 class="flex items-center gap-2 text-lg font-semibold text-slate-100">
						<Icon name="pulse" class="h-5 w-5 text-blue-400" /> Health trends · {cur.level}
					</h2>
					{#if alerted && cur.patients}
						<span
							class="rounded-full px-2 py-0.5 text-xs font-semibold {cur.patients.severity ===
							'alert'
								? 'bg-red-500/20 text-red-300'
								: cur.patients.severity === 'watch'
									? 'bg-amber-500/20 text-amber-300'
									: 'bg-emerald-500/15 text-emerald-300'}"
							>{cur.patients.ratio}× normal · {cur.patients.severity}</span
						>
					{/if}
				</div>
				<div class="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
					<span class="flex items-center gap-1.5"
						><span class="h-0.5 w-4 rounded bg-blue-500"></span>Clinic patients per week</span
					>
					<span class="flex items-center gap-1.5"
						><span class="h-2.5 w-4 rounded-sm border border-slate-300/40 bg-slate-400/25"
						></span>Normal range ({Math.round(baseline.low)}–{Math.round(baseline.high)})</span
					>
					<span class="flex items-center gap-1.5"
						><span class="w-4 border-t-2 border-dashed border-slate-200"></span>Average ({baseline.mean})</span
					>
					<span class="flex items-center gap-1.5"
						><span class="h-2.5 w-2.5 rounded-full bg-amber-500"></span>Past incident</span
					>
					<span class="flex items-center gap-1.5"
						><span class="h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500"></span>This
						week</span
					>
				</div>
				<TrendChart
					{points}
					{baseline}
					severity={alerted ? cur.patients?.severity : undefined}
					label="Weekly clinic patients on {cur.level}"
				/>
				<div class="mt-4 border-t border-white/5 pt-4">
					<h2 class="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-100">
						<Icon name="bulb" class="h-5 w-5 text-amber-300" /> Key insights
					</h2>
					{#if !alerted}
						<p class="rounded-xl bg-white/[0.03] p-3 text-sm text-slate-400">
							Submit a clinic report above. Insights appear once the agents finish.
						</p>
					{/if}
					<div class="space-y-2.5 {alerted ? '' : 'hidden'}">
						{#if cur.patients}
							{@const up = cur.patients.severity !== 'normal'}
							<div class="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3">
								<span
									class="grid h-11 w-11 shrink-0 place-items-center rounded-full {up
										? 'bg-red-500/20 text-red-400'
										: 'bg-emerald-500/15 text-emerald-300'}"><Icon name="up" /></span
								>
								<div class="min-w-0 flex-1">
									<div class="font-semibold {up ? 'text-red-300' : 'text-emerald-300'}">
										{up
											? `Respiratory patients up ${pct(cur.patients.value, cur.patients.baseline.mean)}%`
											: 'Respiratory patients normal'}
									</div>
									<div class="text-sm text-slate-400">
										{cur.patients.value} this week vs {cur.patients.baseline.mean} normal on {cur.level}{cur
											.patients.exceedsIncident
											? `, more than ${cur.patients.exceedsIncident.id}`
											: ''}.
									</div>
								</div>
							</div>
						{:else}
							<div class="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3">
								<span
									class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-slate-400"
									><Icon name="file" /></span
								>
								<div>
									<div class="font-semibold text-slate-300">No clinic report yet</div>
									<div class="text-sm text-slate-400">Shown as missing, not as zero.</div>
								</div>
							</div>
						{/if}

						{#if cur.gap}
							{@const g = cur.gap}
							<div class="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3">
								<span
									class="grid h-11 w-11 shrink-0 place-items-center rounded-full {g.flagged
										? 'bg-blue-500/20 text-blue-300'
										: 'bg-emerald-500/15 text-emerald-300'}"><Icon name="scale" /></span
								>
								<div>
									<div class="font-semibold {g.flagged ? 'text-blue-300' : 'text-emerald-300'}">
										{g.flagged ? "Government numbers don't match" : 'Government numbers match'}
									</div>
									<div class="text-sm text-slate-400">
										{g.confirmed} confirmed vs {g.local} verified patients{g.flagged
											? `: ${g.unexplainedGap} unexplained.`
											: '.'}
									</div>
								</div>
							</div>
						{/if}

						{#if levelStock}
							{@const low = !done && levelStock.daysLeft < LOW_DAYS}
							<div
								class="flex items-center gap-3 rounded-xl p-3 {done
									? 'border border-emerald-500/30 bg-emerald-500/10'
									: 'bg-white/[0.03]'}"
							>
								<DaysRing
									days={done ? done.daysAfter : Math.min(levelStock.daysLeft, 99)}
									target={TARGET_DAYS}
									ok={!low}
								/>
								<div class="min-w-0 flex-1">
									{#if done}
										<div class="font-semibold text-emerald-300">
											Sustainable for ~{done.daysAfter} days
										</div>
										<div class="text-sm text-slate-400">
											{done.stockAfter} inhalers at {levelStock.place} after {done.amount} from {done.from}.
											<button
												onclick={() => levelStock && undo(levelStock.place)}
												class="ml-1 text-slate-500 underline hover:text-slate-300">Undo</button
											>
										</div>
									{:else}
										<div class="font-semibold {low ? 'text-violet-300' : 'text-emerald-300'}">
											{low
												? `Inhalers run out in ~${levelStock.daysLeft} day${levelStock.daysLeft === 1 ? '' : 's'}`
												: 'Inhaler stock is fine'}
										</div>
										<div class="text-sm text-slate-400">
											{#if levelStock.reportId.startsWith('SHEET:')}
												{levelStock.inStock} left at {levelStock.place}, ~{Math.round(
													levelStock.dispensedThisWeek / 7
												)}/day (from clinic sheet).
											{:else}
												{levelStock.inStock} left at {levelStock.place}{cur.inhalers
													? `, ${cur.inhalers.value} dispensed vs ${cur.inhalers.baseline.mean} normal`
													: ''}.
											{/if}
											{#if low && reorder}
												<span class="text-slate-300"
													>Suggested: {reorder.amount} from {reorder.from}.</span
												>
											{/if}
										</div>
									{/if}
								</div>
								{#if low && reorder}
									<span
										title="MedDash comes in the next PR"
										class="shrink-0 cursor-not-allowed rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-slate-400"
										>MedDash · soon</span
									>
								{:else if done}
									<span
										class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-300"
										title="Approved"><Icon name="check" class="h-5 w-5" /></span
									>
								{/if}
							</div>
						{/if}

						{#if clinicPlan}
							{@const c = clinicPlan}
							<div class="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3">
								<span
									class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300"
									><Icon name="clinic" /></span
								>
								<div>
									<div class="font-semibold text-emerald-300">Proposed: {c.name}</div>
									<div class="text-sm text-slate-400">
										{c.reason}. Average walk {c.avgWalkBefore} → {c.avgWalkAfter} min{c.outOfReachBefore >
										c.outOfReachAfter
											? `; ${people(c.outOfReachBefore - c.outOfReachAfter)} people back within ${REACH_MINUTES} min`
											: ''}.
									</div>
								</div>
							</div>
						{/if}

						{#if !cur.completeness.complete}
							<div class="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm">
								<div class="font-semibold text-violet-200">Data may be incomplete</div>
								<div class="text-violet-200/80">
									{cur.completeness.reasons.join(' · ')}. Counts may still rise.
								</div>
							</div>
						{/if}
					</div>
				</div>
			</section>
		</div>
		<!-- What the Supply and Dash agents updated -->
		{#if pipe}<AgentUpdates p={pipe} stage={pipeStage ?? 5} />{/if}

		<p class="pb-2 text-center text-xs text-slate-500">
			All figures are fictional. Counts, alerts and gaps are calculated by code; the AI only reads
			and explains.
		</p>
	</main>
</div>
