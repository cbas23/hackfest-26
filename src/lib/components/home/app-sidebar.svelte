<script lang="ts">
	import * as Accordion from '#lib/components/ui/accordion/index.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import { SICK_STEPS } from '#lib/hollow/sickness.js';
	import { cn } from '#lib/utils.js';
	import type { Component, Snippet } from 'svelte';
	import WindIcon from '@lucide/svelte/icons/wind';
	import DropletsIcon from '@lucide/svelte/icons/droplets';
	import FanIcon from '@lucide/svelte/icons/fan';
	import WaypointsIcon from '@lucide/svelte/icons/waypoints';
	import { WATER_STEPS } from '#lib/hollow/water.js';
	import { AIR_STEPS } from '#lib/hollow/airflow.js';
	import StepScale from './step-scale.svelte';
	import TunnelLegend from './tunnel-legend.svelte';
	import HomeAddress from './home-address.svelte';
	import SicknessScale from './sickness-scale.svelte';
	import { home, type LayerId } from './home-state.svelte.js';

	interface Layer {
		id: LayerId;
		title: string;
		summary: string;
		icon: Component<{ class?: string }>;
		/** The layer's key colour. */
		color: string;
		/** What the card shows when open. */
		content: Snippet;
	}

	/** Data layers: cards that repaint the map while open (their lens is in SECTION_LENS). */
	const LAYERS: Layer[] = [
		{
			id: 'sickness',
			title: 'Lung sickness',
			summary: 'Reported cases by block',
			icon: WindIcon,
			// The top of the sickness scale.
			color: SICK_STEPS[SICK_STEPS.length - 1].color,
			content: sicknessInfo
		},
		{
			id: 'water',
			title: 'Water health',
			summary: 'Tap-water quality by block',
			icon: DropletsIcon,
			color: WATER_STEPS[3].color,
			content: waterInfo
		},
		{
			id: 'airflow',
			title: 'Air flow',
			summary: 'Ventilation reaching each block',
			icon: FanIcon,
			color: AIR_STEPS[AIR_STEPS.length - 1].color,
			content: airflowInfo
		},
		{
			id: 'tunnels',
			title: 'Tunnels',
			summary: 'The network and blocked passages',
			icon: WaypointsIcon,
			color: 'var(--map-tunnels-road)',
			content: tunnelsInfo
		}
	];
</script>

{#snippet sicknessInfo()}
	<p>
		Each block is coloured by the share of its reported residents who are sick. Outbreaks start on
		the upper levels and spread down.
	</p>
	<div class="flex flex-col gap-1.5 text-xs">
		<span>Share of reported residents sick</span>
		<SicknessScale />
		<p class="text-[10px]">Simulated reports</p>
	</div>
{/snippet}

{#snippet waterInfo()}
	<p>
		Each block is coloured by the health of its tap water. Water worsens along long pipe runs from
		its recycler, around leaky mains and further down; a failing recycler taints every block it
		serves.
	</p>
	<div class="flex flex-col gap-1.5 text-xs">
		<span>Tap-water health</span>
		<StepScale steps={WATER_STEPS} />
		<p class="text-[10px]">Simulated readings</p>
	</div>
{/snippet}

{#snippet airflowInfo()}
	<p>
		Each block is coloured by how much fresh air reaches it. Flow is strongest next to a ventilation
		plant, fades along the tunnels, thins on deeper levels and picks up drafts near the shafts.
	</p>
	<div class="flex flex-col gap-1.5 text-xs">
		<span>Air flow at the block</span>
		<StepScale steps={AIR_STEPS} />
		<p class="text-[10px]">Simulated readings</p>
	</div>
{/snippet}

{#snippet tunnelsInfo()}
	<p>
		The tunnel network stands out over darkened chambers. Blocked stretches glow red where they
		can't be passed.
	</p>
	<TunnelLegend class="text-muted-foreground" />
{/snippet}

<aside
	class="hidden h-full w-80 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
>
	<ScrollArea class="min-h-0 flex-1">
		<HomeAddress />

		<section class="mx-3 mt-4 mb-5">
			<h2 id="layers-heading" class="mb-2 px-3 text-xs font-medium text-muted-foreground">
				Information
			</h2>
			<Accordion.Root
				type="single"
				bind:value={() => home.section, (v) => (home.section = v as LayerId | '')}
				class="flex flex-col gap-2"
				aria-labelledby="layers-heading"
			>
				{#each LAYERS as layer (layer.id)}
					{@const open = home.section === layer.id}
					<Accordion.Item
						value={layer.id}
						class={cn(
							'overflow-hidden rounded-lg border bg-card transition-colors',
							open ? 'border-primary/50' : 'hover:border-muted-foreground/40'
						)}
					>
						<Accordion.Trigger
							class="items-center rounded-none px-3 py-3 hover:no-underline focus-visible:ring-inset"
						>
							<span class="flex min-w-0 items-center gap-3">
								<span
									class="grid size-8 shrink-0 place-items-center rounded-md border"
									style="color:{layer.color};border-color:{layer.color};background:color-mix(in oklab, {layer.color} 18%, var(--card))"
									aria-hidden="true"
								>
									<layer.icon class="size-4" />
								</span>
								<span class="flex min-w-0 flex-col">
									<span class="truncate">{layer.title}</span>
									<span class="truncate text-xs font-normal text-muted-foreground">
										{open ? 'Shown on the map' : layer.summary}
									</span>
								</span>
							</span>
						</Accordion.Trigger>
						<Accordion.Content
							class="flex flex-col gap-3 border-t px-3 pt-3 pb-3 text-muted-foreground [&_p:not(:last-child)]:mb-0"
						>
							{@render layer.content()}
						</Accordion.Content>
					</Accordion.Item>
				{/each}
			</Accordion.Root>
		</section>
	</ScrollArea>
</aside>
