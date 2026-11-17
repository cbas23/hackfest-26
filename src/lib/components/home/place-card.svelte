<script lang="ts">
	import { SHAFTS, SHAFT_COLORS } from '#lib/hollow/data.js';
	import type { Place } from '#lib/hollow/nav.js';
	import { facilityStatus, STATUS_INFO } from '#lib/hollow/sensors.js';
	import type { ImpactAssessment } from '#lib/hollow/impact.js';
	import type { Floor } from '#lib/hollow/world.js';
	import { cn } from '#lib/utils.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import XIcon from '@lucide/svelte/icons/x';
	import PlaceIcon from './place-icon.svelte';

	let {
		place: p,
		floor: pf,
		color,
		impact,
		onclose,
		class: className
	}: {
		place: Place;
		floor: Floor;
		color: string;
		impact: ImpactAssessment | null;
		onclose: () => void;
		class?: string;
	} = $props();

	const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
	const sensors = $derived(facilityStatus(p));
</script>

{#snippet pill(label: string, c: string)}
	<span class="rounded-full px-2 py-0.5 text-xs font-semibold" style="color:{c};background:{c}22"
		>{label}</span
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
				<Card.Title class="truncate">{p.label}</Card.Title>
				<Card.Description class="truncate">{p.sub}</Card.Description>
			</div>
		</div>
		<Card.Action>
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
				<span class={pf.lit[p.room.id] ? 'text-emerald-400' : 'text-foreground'}
					>{pf.lit[p.room.id] ? 'Powered' : 'Blackout'}</span
				>
				· ≈ {compact.format(pf.residents[p.room.id])} residents · {p.room.w}×{p.room.h} block, single
				door
			{/if}
		</p>

		{#if sensors}
			{@const overall = STATUS_INFO[sensors.status]}
			<Separator />
			<div class="flex flex-col gap-2 text-xs">
				<div class="flex items-center justify-between">
					<span class="font-semibold tracking-wider text-muted-foreground">SENSORS</span>
					{@render pill(overall.label, overall.color)}
				</div>
				<dl class="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
					{#each sensors.readings as r (r.key)}
						<span
							class="size-2 rounded-full"
							style="background:{STATUS_INFO[r.status].color}"
							aria-hidden="true"
						></span>
						<dt class="text-muted-foreground">{r.label}</dt>
						<dd class="text-right tabular-nums">
							{r.text}<span class="sr-only"> ({STATUS_INFO[r.status].label})</span>
						</dd>
					{/each}
				</dl>
				<p class="text-[10px] text-muted-foreground">Simulated readings</p>
			</div>
		{/if}

		{#if impact}
			<Separator />
			<div class="flex flex-col gap-2 text-xs">
				<div class="flex items-center justify-between">
					<span class="font-semibold tracking-wider text-muted-foreground">IMPACT</span>
					{#if impact.active}
						<span class="font-semibold">
							≈ {compact.format(impact.affectedTotal)} residents affected
						</span>
					{/if}
				</div>
				{#if !impact.active}
					<p class="text-muted-foreground">
						Serves ≈ {compact.format(impact.dependentTotal)} residents in {impact.neighborhoods
							.length} neighborhoods. No one is affected while it reads {STATUS_INFO[
							impact.status
						].label.toLowerCase()}.
					</p>
				{:else if !impact.neighborhoods.length}
					<p class="text-muted-foreground">No housing on this level depends on it.</p>
				{:else}
					<table class="w-full">
						<thead class="text-left text-[10px] text-muted-foreground">
							<tr>
								<th class="pb-1 font-normal">Neighborhood</th>
								<th class="pb-1 text-right font-normal">Affected</th>
								<th class="pb-1 text-right font-normal">Severity</th>
							</tr>
						</thead>
						<tbody>
							{#each impact.neighborhoods as n (n.id)}
								{@const sev = STATUS_INFO[n.severity]}
								<tr>
									<td class="py-0.5 text-muted-foreground">{n.name}</td>
									<td class="py-0.5 text-right tabular-nums">≈ {compact.format(n.affected)}</td>
									<td class="py-0.5 text-right">{@render pill(sev.label, sev.color)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
				<p class="text-[10px] leading-snug text-muted-foreground">
					Simulated: each block depends on its nearest {p.sub.split(' · ')[0].toLowerCase()} facility
					by tunnel distance. Critical cuts service to all of them, High risk to half.
				</p>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
