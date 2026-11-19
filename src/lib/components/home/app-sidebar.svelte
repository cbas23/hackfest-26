<script lang="ts">
	import * as Accordion from '#lib/components/ui/accordion/index.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import { SICK_STEPS } from '#lib/hollow/sickness.js';
	import { cn } from '#lib/utils.js';
	import type { Component, Snippet } from 'svelte';
	import WindIcon from '@lucide/svelte/icons/wind';
	import DropletsIcon from '@lucide/svelte/icons/droplets';
	import FanIcon from '@lucide/svelte/icons/fan';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import WaypointsIcon from '@lucide/svelte/icons/waypoints';
	import { POINT_INFO } from '#lib/hollow/state.js';
	import StateLegend from './state-legend.svelte';
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
			id: 'power',
			title: 'Power',
			summary: 'Blocks with and without power',
			icon: ZapIcon,
			color: POINT_INFO.power.color,
			content: powerInfo
		},
		{
			id: 'water',
			title: 'Water',
			summary: 'Good and bad tap water by block',
			icon: DropletsIcon,
			color: POINT_INFO.water.color,
			content: waterInfo
		},
		{
			id: 'air',
			title: 'Air',
			summary: 'Good and bad air by block',
			icon: FanIcon,
			color: POINT_INFO.air.color,
			content: airInfo
		},
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
			id: 'tunnels',
			title: 'Tunnels',
			summary: 'The network and blocked passages',
			icon: WaypointsIcon,
			color: 'var(--map-tunnels-icon)',
			content: tunnelsInfo
		}
	];
</script>

{#snippet powerInfo()}
	<p>Each block is coloured by whether it has power. Outages cover round areas of the level.</p>
	<StateLegend kind="power" />
{/snippet}

{#snippet waterInfo()}
	<p>Each block is coloured by whether its tap water is good or bad to drink.</p>
	<StateLegend kind="water" />
{/snippet}

{#snippet airInfo()}
	<p>Each block is coloured by whether its air is good or bad to breathe.</p>
	<StateLegend kind="air" />
{/snippet}

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

{#snippet tunnelsInfo()}
	<p>
		The tunnel network stands out over faded chambers. Blocked stretches are painted red where they
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
