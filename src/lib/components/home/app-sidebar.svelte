<script lang="ts">
	import * as Accordion from '#lib/components/ui/accordion/index.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import { LEVELS } from '#lib/hollow/data.js';
	import { SICK_STEPS } from '#lib/hollow/sickness.js';
	import { cn } from '#lib/utils.js';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import WindIcon from '@lucide/svelte/icons/wind';
	import SirenIcon from '@lucide/svelte/icons/siren';
	import { STATUS_INFO } from '#lib/hollow/sensors.js';
	import AlertList from './alert-list.svelte';
	import SicknessScale from './sickness-scale.svelte';
	import { home, mapNav } from './home-state.svelte.js';

	const choose = (v: number | 'all') => (v === 'all' ? mapNav.setOverview(true) : mapNav.goTo(v));
	const isChosen = (v: number | 'all') =>
		v === 'all' ? home.overview : !home.overview && home.level === v;

	/** Data layers that repaint the map while their card is open (see SECTION_LENS). */
	const LAYERS = [
		{
			id: 'alerts',
			title: 'Blackout & air alerts',
			summary: 'Power cuts and failing vents',
			icon: SirenIcon,
			color: STATUS_INFO.critical.color
		},
		{
			id: 'sickness',
			title: 'Lung sickness',
			summary: 'Reported cases by block',
			icon: WindIcon,
			/** The layer's key colour: the top of the sickness scale. */
			color: SICK_STEPS[SICK_STEPS.length - 1].color
		}
	];
</script>

{#snippet levelButton(v: number | 'all', code: string, name: string, meta: string)}
	{@const on = isChosen(v)}
	<li>
		<button
			type="button"
			aria-pressed={on}
			onclick={() => choose(v)}
			class={cn(
				'flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
				on
					? 'bg-primary text-primary-foreground'
					: 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
			)}
		>
			<span class="flex w-6 items-center text-sm font-semibold">
				{#if v === 'all'}<LayersIcon class="size-4" aria-hidden="true" />{:else}{code}{/if}
			</span>
			<span class={cn('flex-1 truncate', on && 'font-medium')}>{name}</span>
			<span
				class={cn(
					'text-xs tabular-nums',
					on ? 'text-primary-foreground/70' : 'text-muted-foreground'
				)}>{meta}</span
			>
		</button>
	</li>
{/snippet}

<aside
	class="hidden h-full w-80 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
>
	<ScrollArea class="min-h-0 flex-1">
		<section class="px-3 pt-4 pb-2" aria-labelledby="level-heading">
			<h2 id="level-heading" class="px-3 pb-2 text-xs font-medium text-muted-foreground">Levels</h2>
			<ul class="flex flex-col gap-0.5">
				{@render levelButton('all', '', 'All levels', `${LEVELS.length} levels`)}
				{#each LEVELS as l (l.code)}
					{@render levelButton(l.index, l.code, l.name, `−${l.depth.toLocaleString('en')} m`)}
				{/each}
			</ul>
		</section>

		<section class="mx-3 mt-3 mb-5 border-t border-sidebar-border pt-4">
			<h2 id="layers-heading" class="mb-2 px-3 text-xs font-medium text-muted-foreground">
				Information
			</h2>
			<Accordion.Root
				type="single"
				bind:value={home.section}
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
									<layer.icon class={cn('size-4', layer.id === 'alerts' && 'alert-blink')} />
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
							{#if layer.id === 'alerts'}
								<AlertList />
							{:else if layer.id === 'sickness'}
								<p>
									Each block is coloured by the share of its reported residents who are sick.
									Outbreaks start on the upper levels and spread down.
								</p>
								<div class="flex flex-col gap-1.5 text-xs">
									<span>Share of reported residents sick</span>
									<SicknessScale />
									<p class="text-[10px]">Simulated reports</p>
								</div>
							{/if}
						</Accordion.Content>
					</Accordion.Item>
				{/each}
			</Accordion.Root>
		</section>
	</ScrollArea>
</aside>
