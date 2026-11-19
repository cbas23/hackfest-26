<script lang="ts">
	import { BLOCKED_TILES, isActive } from '#lib/hollow/events.js';
	import { SIM } from '#lib/hollow/simConfig.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { live } from '#lib/live/events.svelte.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import EventRow from './event-row.svelte';
	import { control } from './control-state.svelte.js';

	const hollow = getHollow();
	const sim = $derived.by(() => {
		void live.version;
		return simulateFloor(hollow.floor(control.level));
	});
	const rows = $derived(
		[...sim.local.blockedTunnels].sort((a, b) => Number(isActive(b)) - Number(isActive(a)))
	);
</script>

<div class="flex flex-col gap-3">
	<p class="text-xs text-muted-foreground">
		Click a tunnel on the map to block a short stretch of it. The stretch follows the tunnel from
		the nearest tile.
	</p>
	<label class="flex flex-col gap-2 text-xs">
		<span class="flex justify-between"
			><span>Length</span><span class="tabular-nums">{control.tunnelLength} tiles</span></span
		>
		<Slider
			type="single"
			bind:value={control.tunnelLength}
			min={BLOCKED_TILES.min}
			max={BLOCKED_TILES.max}
			step={1}
		/>
	</label>
	<div class="flex flex-col gap-1.5 text-xs">
		<span>Reason</span>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			class="flex w-full flex-wrap"
			bind:value={() => control.reason, (v) => v && (control.reason = v)}
			aria-label="Reason"
		>
			{#each SIM.scenario.blockedReasons as r (r)}
				<ToggleGroup.Item value={r} class="text-[11px]">{r}</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>
	</div>

	{#if rows.length}
		<ul class="flex flex-col gap-1.5">
			{#each rows as t (t.id)}
				<EventRow
					event={{ table: 'blockedTunnels', id: t.id }}
					active={isActive(t)}
					title={t.reason}
					sub="{t.tiles.length} tiles from {t.tiles[0].x}, {t.tiles[0].y}"
				/>
			{/each}
		</ul>
	{:else}
		<p class="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
			No blocked tunnels on this level.
		</p>
	{/if}
</div>
