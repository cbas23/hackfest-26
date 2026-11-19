<script lang="ts">
	import { LEVELS } from '#lib/hollow/data.js';
	import { ALERT_INFO, ALERT_KINDS, type HollowAlert } from '#lib/hollow/alerts.js';
	import { actionFor, floorState, type Action } from '#lib/hollow/response.js';
	import { STATUS_INFO } from '#lib/hollow/sensors.js';
	import { cn } from '#lib/utils.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import CornerDownRightIcon from '@lucide/svelte/icons/corner-down-right';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import AlertIcon from './alert-icon.svelte';
	import { hollow } from './hollow.js';
	import { home, mapNav } from './home-state.svelte.js';
	import { dispatch, response } from './response-state.svelte.js';

	const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
	const byRank = (a: HollowAlert, b: HollowAlert) =>
		STATUS_INFO[b.severity].rank - STATUS_INFO[a.severity].rank || b.residents - a.residents;

	/** Active alerts (with their next step) and finished ones, for the shown level(s). */
	const view = $derived.by(() => {
		void response.version;
		const floors = home.overview
			? LEVELS.map((l) => hollow.floor(l.index))
			: [hollow.floor(home.level)];
		const active: { alert: HollowAlert; action: Action }[] = [];
		const done: { alert: HollowAlert; byPower: boolean }[] = [];
		for (const f of floors) {
			const st = floorState(f);
			for (const a of st.active) active.push({ alert: a, action: actionFor(f, a, st) });
			for (const a of st.fixed) done.push({ alert: a, byPower: false });
			for (const a of st.cleared) done.push({ alert: a, byPower: true });
		}
		active.sort((x, y) => byRank(x.alert, y.alert));
		return { active, done };
	});
	const all = $derived(view.active.map((v) => v.alert));
	const rows = $derived(
		home.alertFilter ? view.active.filter((v) => v.alert.kind === home.alertFilter) : view.active
	);
	const alerts = $derived(rows.map((v) => v.alert));
	const countOf = (k: (typeof ALERT_KINDS)[number]) => all.filter((a) => a.kind === k).length;
</script>

<div class="flex flex-col gap-2">
	<p>
		Each alert shows why it happened and what to do next. Dispatch a crew to fix it; fixing a
		blackout also clears the air and water alerts it caused.
	</p>

	<div class="flex gap-1" role="group" aria-label="Filter alerts">
		<button
			type="button"
			aria-pressed={!home.alertFilter}
			onclick={() => (home.alertFilter = null)}
			class={cn(
				'rounded-full border px-2.5 py-0.5 text-[11px] whitespace-nowrap transition-colors',
				!home.alertFilter
					? 'border-foreground/60 text-foreground'
					: 'hover:border-muted-foreground/60'
			)}>All {all.length}</button
		>
		{#each ALERT_KINDS as k (k)}
			{@const on = home.alertFilter === k}
			<button
				type="button"
				aria-pressed={on}
				onclick={() => (home.alertFilter = on ? null : k)}
				class="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap transition-colors"
				style="color:{on ? ALERT_INFO[k].color : ''};border-color:{on
					? ALERT_INFO[k].color
					: ''};background:{on
					? `color-mix(in oklab, ${ALERT_INFO[k].color} 14%, transparent)`
					: ''}"
			>
				<span style="color:{ALERT_INFO[k].color}"><AlertIcon kind={k} class="size-3" /></span>
				{ALERT_INFO[k].label}
				<span class="tabular-nums opacity-70">{countOf(k)}</span>
			</button>
		{/each}
	</div>

	<div class="flex items-center justify-between text-xs">
		<span
			>{home.overview
				? 'All levels'
				: `${LEVELS[home.level].code} ${LEVELS[home.level].name}`}</span
		>
		<span class="tabular-nums">{alerts.length} active</span>
	</div>

	{#if alerts.length === 0}
		<p class="rounded-md border border-dashed p-3 text-center text-xs">All clear here.</p>
	{:else}
		<ul class="flex max-h-96 flex-col gap-1.5 overflow-y-auto pr-1">
			{#each rows as { alert: a, action }, i (a.id)}
				{@const info = STATUS_INFO[a.severity]}
				{@const busy = response.working === (action.cause ?? a).id}
				<li class="alert-in" style="animation-delay:{Math.min(i, 12) * 40}ms">
					<div
						class={cn(
							'relative overflow-hidden rounded-md border bg-background/60 transition-all hover:-translate-y-px hover:bg-background',
							a.severity === 'critical' && 'alert-critical',
							busy && 'ring-2 ring-emerald-500/60'
						)}
						style="--sev:{info.color};border-color:color-mix(in oklab, {info.color} 45%, var(--border))"
					>
						<span class="absolute inset-y-0 left-0 w-1" style="background:{info.color}"></span>
						<button
							type="button"
							onclick={() => mapNav.focus(a.floor, a.x, a.y)}
							class="flex w-full items-start gap-2.5 p-2 pb-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
						>
							<span
								class="relative mt-0.5 ml-1 grid size-7 shrink-0 place-items-center rounded-full"
								style="color:{ALERT_INFO[a.kind].color};background:color-mix(in oklab, {ALERT_INFO[
									a.kind
								].color} 18%, transparent)"
							>
								{#if a.severity === 'critical'}
									<span
										class="absolute inset-0 animate-ping rounded-full opacity-40"
										style="background:{info.color}"
									></span>
								{/if}
								<AlertIcon kind={a.kind} />
							</span>
							<span class="flex min-w-0 flex-1 flex-col gap-0.5">
								<span class="flex items-center justify-between gap-2">
									<span class="truncate text-sm font-medium text-foreground">{a.title}</span>
									<span
										class="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase"
										style="color:{info.color};background:color-mix(in oklab, {info.color} 15%, transparent)"
										>{info.label}</span
									>
								</span>
								<span class="truncate text-xs">{a.where}</span>
								<span class="truncate text-[11px]">
									{a.detail} ·
									<span class="font-semibold text-foreground tabular-nums"
										>{compact.format(a.residents)}</span
									> residents
								</span>
								{#if a.chain.length}
									<!-- Cause → effect, each step lighting up in turn. -->
									<span class="mt-1 flex flex-wrap items-center gap-0.5" aria-label="Cause chain">
										{#each a.chain as step, j (j)}
											{#if j}<ChevronRightIcon
													class="size-3 text-muted-foreground/60"
													aria-hidden="true"
												/>{/if}
											<span
												class="chain-step flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-medium"
												style="color:{ALERT_INFO[step.kind]
													.color};background:color-mix(in oklab, {ALERT_INFO[step.kind]
													.color} 12%, transparent);animation-delay:{j * 0.12}s, {j * 0.35}s"
											>
												<AlertIcon kind={step.kind} class="size-2.5" />
												{step.label}
											</span>
										{/each}
									</span>
								{/if}
							</span>
						</button>
						<!-- Next step: what to do about it, and what that fixes. -->
						<div
							class="ml-3 flex items-center gap-2 border-t border-dashed px-2 py-1.5 text-[11px]"
						>
							<CornerDownRightIcon class="size-3 shrink-0 text-emerald-500" aria-hidden="true" />
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="truncate font-medium text-foreground"
									>{action.verb}{#if action.cause}<span class="font-normal text-muted-foreground">
											· {action.cause.where.split(' · ')[0]}</span
										>{/if}</span
								>
								<span class="truncate text-[10px]"
									>{#if action.clears.length > 1}Clears {action.clears.length} alerts ·
									{/if}{action.advice}</span
								>
							</span>
							<button
								type="button"
								disabled={!!response.working}
								onclick={() => dispatch(action)}
								class="flex shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white transition-colors outline-none hover:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
							>
								<WrenchIcon class={cn('size-3', busy && 'animate-spin')} aria-hidden="true" />
								{busy ? 'Working' : action.type === 'cause' ? 'Fix cause' : 'Dispatch'}
							</button>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
	{#if view.done.length}
		<details class="group rounded-md border border-emerald-500/30 bg-emerald-500/5">
			<summary
				class="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-xs text-emerald-600 dark:text-emerald-400"
			>
				<CircleCheckIcon class="size-3.5" aria-hidden="true" />
				Resolved {view.done.length}
				<ChevronRightIcon class="ml-auto size-3 transition-transform group-open:rotate-90" />
			</summary>
			<ul class="flex flex-col gap-1 px-2 pb-2">
				{#each view.done as { alert: a, byPower } (a.id)}
					<li class="alert-in flex items-center gap-1.5 text-[11px]">
						<CircleCheckIcon class="size-3 shrink-0 text-emerald-500" aria-hidden="true" />
						<span class="truncate text-foreground line-through decoration-emerald-500/60"
							>{a.title}</span
						>
						<span class="truncate">{a.where.split(' · ')[0]}</span>
						{#if byPower}<span class="ml-auto shrink-0 text-emerald-600 dark:text-emerald-400"
								>by power fix</span
							>{/if}
					</li>
				{/each}
			</ul>
		</details>
	{/if}
	{#if home.alertFilter !== 'blackout' && alerts.some((a) => a.chain[0]?.kind === 'blackout')}
		<p class="text-[11px]">
			<span class="font-semibold text-foreground"
				>{alerts.filter((a) => a.chain[0]?.kind === 'blackout').length}</span
			> of these start with a power cut. Fixing the blackout fixes them too.
		</p>
	{/if}
	<p class="text-[10px]">Simulated alerts</p>
</div>
