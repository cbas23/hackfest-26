<script lang="ts">
	import { LEVELS } from '#lib/hollow/data.js';
	import type { HollowAlert } from '#lib/hollow/alerts.js';
	import { formatCompact } from '#lib/hollow/format.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { STATUS_INFO } from '#lib/hollow/sensors.js';
	import { cn } from '#lib/utils.js';
	import ZapOffIcon from '@lucide/svelte/icons/zap-off';
	import WindIcon from '@lucide/svelte/icons/wind';
	import { home, mapNav } from './home-state.svelte.js';

	const hollow = getHollow();
	const alertsAt = (level: number) => simulateFloor(hollow.floor(level)).alerts.alerts;

	/** Alerts for the shown level, or every level in the stacked view. */
	const alerts = $derived<HollowAlert[]>(
		home.overview
			? LEVELS.flatMap((l) => alertsAt(l.index)).sort(
					(a, b) =>
						STATUS_INFO[b.severity].rank - STATUS_INFO[a.severity].rank || b.residents - a.residents
				)
			: alertsAt(home.level)
	);
</script>

<div class="flex flex-col gap-2">
	<p>
		Live blackout and air-quality alerts. Dark blocks have lost power; glowing blocks breathe air
		from a failing vent. Pick an alert to fly to it.
	</p>
	<div class="flex items-center justify-between text-xs">
		<span
			>{home.overview
				? 'All levels'
				: `${LEVELS[home.level].code} ${LEVELS[home.level].name}`}</span
		>
		<span class="tabular-nums">{alerts.length} active</span>
	</div>
	{#if alerts.length === 0}
		<p class="rounded-md border border-dashed p-3 text-center text-xs">All clear on this level.</p>
	{:else}
		<ul class="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
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
							style="color:{info.color};background:color-mix(in oklab, {info.color} 18%, transparent)"
							aria-hidden="true"
						>
							{#if a.severity === 'critical'}
								<span
									class="absolute inset-0 animate-ping rounded-full opacity-40"
									style="background:{info.color}"
								></span>
							{/if}
							{#if a.kind === 'blackout'}<ZapOffIcon class="size-3.5" />{:else}<WindIcon
									class="size-3.5"
								/>{/if}
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
									>{formatCompact(a.residents)}</span
								> residents
							</span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<p class="text-[10px]">Simulated alerts</p>
</div>
