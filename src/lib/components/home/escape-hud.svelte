<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { CONDITION_STEPS, conditionStep } from '#lib/hollow/conditions.js';
	import { LEVELS } from '#lib/hollow/data.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { POINT_INFO, POINT_KINDS } from '#lib/hollow/state.js';
	import { live } from '#lib/live/state.svelte.js';
	import { cn } from '#lib/utils.js';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import SirenIcon from '@lucide/svelte/icons/siren';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import XIcon from '@lucide/svelte/icons/x';
	import { directions } from './directions.svelte.js';

	let {
		status,
		arrived,
		class: className = ''
	}: {
		/** What the playback is doing right now, if anything. */
		status: string | null;
		/** True once the route has reached the safe block. */
		arrived: boolean;
		class?: string;
	} = $props();

	const route = $derived(directions.route);
	const dest = $derived(directions.toPlace);
	/** The safe block's readings, to show why it's safe. */
	const readings = $derived.by(() => {
		void live.version;
		if (!dest) return [];
		const sim = simulateFloor(getHollow().floor(dest.floor));
		return POINT_KINDS.map((k) => {
			const score = sim.score(k)[dest.room.id] ?? 0;
			return {
				kind: k,
				label: POINT_INFO[k].label,
				step: CONDITION_STEPS[k][conditionStep(score)]
			};
		});
	});
	const minutes = (s: number) => Math.max(1, Math.round(s / 60));
	const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
</script>

{#if route && dest}
	<div
		class={cn(
			'alert-in w-[min(24rem,calc(100%-2rem))] overflow-hidden rounded-xl border bg-background/95 shadow-2xl backdrop-blur',
			arrived ? 'border-emerald-500/70' : 'border-destructive/60',
			className
		)}
		role="status"
		aria-live="polite"
	>
		<div
			class={cn(
				'flex items-center gap-2 px-3 py-1.5 text-xs font-bold tracking-[0.18em] uppercase',
				arrived ? 'bg-emerald-500/15 text-emerald-500' : 'bg-destructive/15 text-destructive'
			)}
		>
			{#if arrived}
				<ShieldCheckIcon class="size-4" /> You've reached safety
			{:else}
				<SirenIcon class="size-4 animate-pulse" /> Escape route
			{/if}
			<span class="ml-auto font-medium tracking-normal normal-case opacity-80">
				{status ?? (directions.danger[0]?.title || 'Nearest safe block')}
			</span>
		</div>

		<div class="flex items-end gap-3 px-3 pt-2.5">
			<div class="min-w-0 flex-1">
				<p class="text-[11px] text-muted-foreground">Nearest safe block</p>
				<p class="truncate text-sm font-semibold">
					{dest.label}
					<span class="font-normal text-muted-foreground"
						>· {LEVELS[dest.floor].code} {LEVELS[dest.floor].name}</span
					>
				</p>
			</div>
			<p class="shrink-0 text-right leading-none">
				<span class="text-3xl font-bold text-emerald-500 tabular-nums"
					>{minutes(route.seconds)}</span
				>
				<span class="text-sm font-semibold text-emerald-500">min</span>
			</p>
		</div>

		<p class="px-3 pt-1 text-xs text-muted-foreground">
			{km(route.walkMeters)} on foot{route.rides.length
				? ` · ${route.rides.length} shaft ride${route.rides.length === 1 ? '' : 's'}`
				: ''}{directions.escapeAvoided
				? ` · avoids all ${directions.escapeAvoided} blocked tunnel${directions.escapeAvoided === 1 ? '' : 's'}`
				: ''}
		</p>

		<ul class="flex flex-wrap gap-1.5 px-3 pt-2" aria-label="Conditions at the safe block">
			{#each readings as r (r.kind)}
				<li
					class="rounded-full px-2 py-0.5 text-[11px] font-semibold"
					style="color:{r.step.color};background:color-mix(in oklab, {r.step
						.color} 14%, transparent)"
				>
					{r.label}: {r.step.label}
				</li>
			{/each}
		</ul>

		<div class="flex gap-2 p-3">
			<Button size="sm" variant="outline" class="flex-1" onclick={() => directions.escape()}>
				<RotateCcwIcon /> Replay
			</Button>
			<Button size="sm" variant="ghost" class="flex-1" onclick={() => directions.close()}>
				<XIcon /> End
			</Button>
		</div>
	</div>
{/if}
