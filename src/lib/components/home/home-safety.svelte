<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { CONDITION_STEPS, conditionStep } from '#lib/hollow/conditions.js';
	import type { Place } from '#lib/hollow/nav.js';
	import { SICK_STEPS, sickStep } from '#lib/hollow/sickness.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { STATUS_INFO, type Status } from '#lib/hollow/status.js';
	import { live } from '#lib/live/state.svelte.js';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { directions } from './directions.svelte.js';
	import { home, type LayerId } from './home-state.svelte.js';

	/**
	 * The home block's safety in one small section: a verdict set by the worst reading, a small
	 * chart of the four readings (power, water, air, lung sickness; clicking one opens its data
	 * layer) and a button for the route to the nearest safe block.
	 */
	let { place }: { place: Place } = $props();

	/** Sickness steps in the shape `StepScale` takes. */
	const SICK_SCALE = SICK_STEPS.map((s) => ({ ...s, label: s.range }));

	const parts = $derived.by(() => {
		void live.version;
		const sim = simulateFloor(getHollow().floor(place.floor));
		const id = place.room.id;
		const cond = (kind: 'power' | 'water' | 'air', label: string) => {
			const steps = CONDITION_STEPS[kind];
			const step = conditionStep(sim.score(kind)[id] ?? 0);
			return { id: kind as LayerId, label, steps, step, reading: steps[step].label };
		};
		const sick = sim.sickness[id];
		const sStep = sick ? sickStep(sick.score) : 0;
		return [
			cond('power', 'Power'),
			cond('water', 'Water'),
			cond('air', 'Air'),
			{
				id: 'sickness' as LayerId,
				label: 'Sickness',
				steps: SICK_SCALE,
				step: sStep,
				reading: sick ? SICK_STEPS[sStep].short : 'None'
			}
		];
	});

	/** The worst reading decides the verdict, on the same scale as the notices. */
	const worst = $derived(Math.max(...parts.map((p) => p.step)));
	const status = $derived<Status>(
		worst >= 4 ? 'critical' : worst >= 3 ? 'high' : worst >= 2 ? 'warning' : 'normal'
	);
	const VERDICT: Record<Status, string> = {
		normal: 'Safe',
		warning: 'Caution',
		high: 'Unsafe',
		critical: 'Danger'
	};
</script>

<section
	class="flex flex-col gap-2 border-b border-sidebar-border px-4 pt-4 pb-5"
	aria-labelledby="safety-heading"
>
	<div class="flex items-center justify-between">
		<h2 id="safety-heading" class="text-xs font-medium text-muted-foreground">Your block</h2>
		<span class="text-xs font-semibold" style:color={STATUS_INFO[status].color}
			>{VERDICT[status]}</span
		>
	</div>

	<!-- Same chart as the place card: one five-step scale per reading, the current step ringed. -->
	<ul class="flex flex-col">
		{#each parts as p (p.id)}
			{@const c = p.steps[p.step].color}
			<li>
				<button
					type="button"
					class="-mx-1.5 grid w-[calc(100%+0.75rem)] grid-cols-[4rem_1fr_4.5rem] items-center gap-x-3 rounded-md px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					aria-label="{p.label}: {p.reading}. Show the {p.label.toLowerCase()} layer"
					onclick={() => (home.section = p.id)}
				>
					<span class="font-medium text-foreground">{p.label}</span>
					<!-- Steps split by 1px gaps that show the background; the white marker sits on top. -->
					<span class="relative flex h-2.5 gap-px" aria-hidden="true">
						{#each p.steps as s (s.color)}
							<span class="flex-1 first:rounded-l-sm last:rounded-r-sm" style:background={s.color}
							></span>
						{/each}
						<span
							class="absolute -inset-y-0.5 rounded-sm border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)] transition-[left] duration-300"
							style:left="calc((100% - {p.steps.length - 1}px) / {p.steps.length} * {p.step} + {p.step}px
							- 2px)"
							style:width="calc((100% - {p.steps.length - 1}px) / {p.steps.length} + 4px)"
						></span>
					</span>
					<span
						class="justify-self-end truncate rounded-full px-2 py-0.5 font-semibold"
						style="color:{c};background:color-mix(in oklab, {c} 13%, transparent)">{p.reading}</span
					>
				</button>
			</li>
		{/each}
	</ul>

	<Button variant="default" size="sm" class="mt-1 w-full" onclick={() => directions.escape()}>
		<ShieldCheckIcon /> Find safe block
	</Button>
	{#if directions.escapeFailed}
		<p class="text-xs text-destructive">
			No safe block can be reached right now. Every way out is blocked.
		</p>
	{/if}
</section>
