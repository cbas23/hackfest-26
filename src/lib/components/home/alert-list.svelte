<script lang="ts">
	import { LEVELS } from '#lib/hollow/data.js';
	import { ALERT_INFO, ALERT_KINDS, alertsOn, type HollowAlert } from '#lib/hollow/alerts.js';
	import { STATUS_INFO } from '#lib/hollow/sensors.js';
	import { cn } from '#lib/utils.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import AlertIcon from './alert-icon.svelte';
	import { hollow } from './hollow.js';
	import { home, mapNav } from './home-state.svelte.js';

	const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

	/** Alerts for the shown level, or every level in the stacked view. */
	const all = $derived<HollowAlert[]>(
		home.overview
			? LEVELS.flatMap((l) => alertsOn(hollow.floor(l.index)).alerts).sort(
					(a, b) =>
						STATUS_INFO[b.severity].rank - STATUS_INFO[a.severity].rank || b.residents - a.residents
				)
			: alertsOn(hollow.floor(home.level)).alerts
	);
	const alerts = $derived(home.alertFilter ? all.filter((a) => a.kind === home.alertFilter) : all);
	const countOf = (k: (typeof ALERT_KINDS)[number]) => all.filter((a) => a.kind === k).length;
</script>

<div class="flex flex-col gap-2">
	<p>
		Live power, air and water alerts. Each one traces its cause: a blackout stalls the fans and
		pumps, and the air and water go bad. Pick an alert to fly to it.
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
			{#each alerts as a, i (a.id)}
				{@const info = STATUS_INFO[a.severity]}
				<li class="alert-in" style="animation-delay:{Math.min(i, 12) * 40}ms">
					<button
						type="button"
						onclick={() => mapNav.focus(a.floor, a.x, a.y)}
						class={cn(
							'group relative flex w-full items-start gap-2.5 overflow-hidden rounded-md border bg-background/60 p-2 text-left transition-all outline-none hover:-translate-y-px hover:bg-background focus-visible:ring-2 focus-visible:ring-ring',
							a.severity === 'critical' && 'alert-critical'
						)}
						style="--sev:{info.color};border-color:color-mix(in oklab, {info.color} 45%, var(--border))"
					>
						<span class="absolute inset-y-0 left-0 w-1" style="background:{info.color}"></span>
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
				</li>
			{/each}
		</ul>
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
