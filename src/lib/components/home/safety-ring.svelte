<script lang="ts">
	import { CONDITION_STEPS, conditionStep } from '#lib/hollow/conditions.js';
	import type { Place } from '#lib/hollow/nav.js';
	import { SICK_STEPS, sickStep } from '#lib/hollow/sickness.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { STATUS_INFO, type Status } from '#lib/hollow/status.js';
	import { live } from '#lib/live/state.svelte.js';
	import DropletsIcon from '@lucide/svelte/icons/droplets';
	import FanIcon from '@lucide/svelte/icons/fan';
	import WindIcon from '@lucide/svelte/icons/wind';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import { home, type LayerId } from './home-state.svelte.js';

	/**
	 * The home block at a glance: a ring in four parts (power, water, air, lung sickness), each
	 * coloured by its step, around one verdict for the whole block. Clicking a part opens its
	 * data layer.
	 */
	let { place }: { place: Place } = $props();

	const parts = $derived.by(() => {
		void live.version;
		const sim = simulateFloor(getHollow().floor(place.floor));
		const id = place.room.id;
		const cond = (kind: 'power' | 'water' | 'air', label: string, icon: typeof ZapIcon) => {
			const step = conditionStep(sim.score(kind)[id] ?? 0);
			const s = CONDITION_STEPS[kind][step];
			return { id: kind as LayerId, label, icon, step, color: s.color, reading: s.label };
		};
		const sick = sim.sickness[id];
		const sStep = sick ? sickStep(sick.score) : 0;
		return [
			cond('power', 'Power', ZapIcon),
			cond('water', 'Water', DropletsIcon),
			cond('air', 'Air', FanIcon),
			{
				id: 'sickness' as LayerId,
				label: 'Sickness',
				icon: WindIcon,
				step: sStep,
				color: SICK_STEPS[sStep].color,
				reading: sick ? SICK_STEPS[sStep].short : 'No reports'
			}
		];
	});

	/** The worst part decides the verdict, on the same scale as the notices. */
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

	// Four arcs of a circle with small gaps between them, drawn clockwise from the top.
	const R = 42;
	const C = 2 * Math.PI * R;
	const GAP = 6;
	const ARC = C / 4 - GAP;
</script>

<div class="flex items-center gap-4 px-3">
	<div class="relative size-28 shrink-0">
		{#key place.key}
			<svg viewBox="0 0 100 100" class="size-full -rotate-90" aria-hidden="true">
				<circle cx="50" cy="50" r={R} fill="none" class="stroke-muted" stroke-width="9" />
				{#each parts as p, i (p.id)}
					<circle
						cx="50"
						cy="50"
						r={R}
						fill="none"
						stroke={p.color}
						stroke-width="9"
						stroke-linecap="round"
						stroke-dasharray="{ARC} {C - ARC}"
						stroke-dashoffset={-(i * (C / 4) + GAP / 2)}
						class="ring-arc"
						class:ring-bad={p.step >= 3}
						style="--delay:{i * 120}ms;color:{p.color}"
					/>
				{/each}
			</svg>
		{/key}
		<div class="absolute inset-0 grid place-items-center text-center">
			<div class="flex flex-col items-center leading-none">
				<span
					class="text-[15px] font-black tracking-wide uppercase"
					class:ring-pulse={status === 'critical' || status === 'high'}
					style="color:{STATUS_INFO[status].color}">{VERDICT[status]}</span
				>
				<span class="mt-1 text-[9px] tracking-widest text-muted-foreground uppercase"
					>Your block</span
				>
			</div>
		</div>
	</div>

	<ul class="flex min-w-0 flex-1 flex-col gap-1">
		{#each parts as p (p.id)}
			<li>
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					aria-label="{p.label}: {p.reading}. Show the {p.label.toLowerCase()} layer"
					onclick={() => (home.section = p.id)}
				>
					<p.icon class="size-3.5 shrink-0" style="color:{p.color}" />
					<span class="text-muted-foreground">{p.label}</span>
					<!-- Readings that are fine stay plain; bad ones take their step colour. -->
					<span class="ml-auto truncate font-semibold" style:color={p.step >= 2 ? p.color : null}
						>{p.reading}</span
					>
				</button>
			</li>
		{/each}
	</ul>
</div>

<style>
	/* Each part draws itself in, one after another. */
	.ring-arc {
		animation: ring-draw 700ms var(--delay) cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.ring-bad {
		animation:
			ring-draw 700ms var(--delay) cubic-bezier(0.22, 1, 0.36, 1) both,
			ring-glow 1.6s 900ms ease-in-out infinite;
	}
	.ring-pulse {
		animation: ring-glow 1.6s ease-in-out infinite;
	}
	@keyframes ring-draw {
		from {
			stroke-dasharray: 0 1000;
		}
	}
	@keyframes ring-glow {
		50% {
			filter: drop-shadow(0 0 4px currentColor) brightness(1.25);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ring-arc,
		.ring-bad,
		.ring-pulse {
			animation: none;
		}
	}
</style>
