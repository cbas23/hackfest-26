<script lang="ts">
	import { SHAFTS, SHAFT_COLORS } from '#lib/hollow/data.js';
	import type { Place } from '#lib/hollow/nav.js';
	import type { FloorSimulation } from '#lib/hollow/simulation.js';
	import { POINT_INFO, POINT_KINDS } from '#lib/hollow/state.js';
	import type { BlockSickness } from '#lib/hollow/sickness.js';
	import { formatCompact, formatCount, formatPercent } from '#lib/hollow/format.js';
	import SicknessScale from './sickness-scale.svelte';
	import { cn } from '#lib/utils.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import XIcon from '@lucide/svelte/icons/x';
	import HouseIcon from '@lucide/svelte/icons/house';
	import { home, setAddress } from './home-state.svelte.js';
	import PlaceIcon from './place-icon.svelte';

	let {
		place: p,
		sim,
		color,
		sickness = null,
		onclose,
		class: className
	}: {
		place: Place;
		/** The simulation of the place's floor. */
		sim: FloorSimulation;
		color: string;
		sickness?: BlockSickness | null;
		onclose: () => void;
		class?: string;
	} = $props();

	const pf = $derived(sim.floor);
</script>

{#snippet pill(label: string, c: string)}
	<span
		class="rounded-full px-2 py-0.5 text-xs font-semibold"
		style="color:{c};background:color-mix(in oklab, {c} 13%, transparent)">{label}</span
	>
{/snippet}

<Card.Root
	class={cn('max-h-[calc(100%-6rem)] w-[min(24rem,calc(100%-5.5rem))] overflow-y-auto', className)}
	size="sm"
	aria-label={p.label}
>
	<Card.Header>
		<div class="flex items-center gap-3">
			<PlaceIcon kind={p.kind} {color} size={36} />
			<div class="min-w-0">
				<Card.Title
					class="truncate text-base leading-tight font-semibold group-data-[size=sm]/card:text-base"
					>{p.label}</Card.Title
				>
				<Card.Description class="truncate text-xs">{p.sub}</Card.Description>
			</div>
		</div>
		<Card.Action class="flex items-center gap-0.5">
			{#if p.kind === 'block'}
				{@const isHome = home.address === p.key}
				<Button
					variant={isHome ? 'secondary' : 'ghost'}
					size="sm"
					class={isHome ? 'text-primary' : ''}
					aria-pressed={isHome}
					onclick={() => setAddress(isHome ? null : p.key)}
					title={isHome ? 'Remove as my home' : 'Set as my home'}
				>
					<HouseIcon />{isHome ? 'My home' : 'Set as home'}
				</Button>
			{/if}
			<Button variant="ghost" size="icon-sm" onclick={onclose} aria-label="Close">
				<XIcon />
			</Button>
		</Card.Action>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3 text-sm">
		<p class="leading-relaxed text-muted-foreground">
			{#if p.kind === 'shaft'}
				{@const info = SHAFTS[p.shaft!]}
				<span class="font-semibold capitalize" style="color:{SHAFT_COLORS[info.status]}"
					>{info.status}</span
				>
				· {info.description}
			{:else if p.kind === 'farm'}
				Communal farm under rationed grow-lamps, {p.room.w}×{p.room.h} tiles. Dug into the rock at the
				city's edge; one tunnel in.
			{:else if p.kind === 'plant'}
				Geothermal plant feeding the Hollow's grid. When one trips, the deep levels go dark first.
			{:else if p.kind !== 'block'}
				{p.note}
			{:else}
				≈ {formatCompact(pf.residents[p.room.id])} residents · {p.room.w}×{p.room.h} block, single door
			{/if}
		</p>

		{#if p.kind === 'block'}
			<div class="flex flex-wrap gap-1.5">
				{#each POINT_KINDS as k (k)}
					{@const info = POINT_INFO[k]}
					{@const bad = sim.bad(k)[p.room.id]}
					{@render pill(bad ? info.bad : info.good, bad ? info.color : 'var(--success)')}
				{/each}
			</div>
		{/if}

		{#if sickness}
			<Separator />
			<div class="flex flex-col gap-2 text-xs">
				<div class="flex items-center justify-between">
					<span class="font-medium text-foreground">Lung sickness</span>
					<span class="font-semibold tabular-nums">{formatPercent(sickness.score)}</span>
				</div>
				<SicknessScale score={sickness.score} />
				<p class="text-muted-foreground">
					{formatCount(sickness.sick)} of {formatCount(sickness.reported)} reported residents sick
				</p>
				<p class="text-[10px] text-muted-foreground">Simulated reports</p>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
