<script lang="ts">
	import { BLOCKED_TILES } from '#lib/hollow/state.js';
	import { SIM } from '#lib/hollow/simConfig.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { live } from '#lib/live/state.svelte.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import StateRow from './state-row.svelte';
	import { control, removeBlockedTunnel } from './control-state.svelte.js';

	const hollow = getHollow();
	const sim = $derived.by(() => {
		void live.version;
		return simulateFloor(hollow.floor(control.level));
	});
	const rows = $derived(sim.local.blockedTunnels);
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
				<StateRow
					title={t.reason}
					sub="{t.tiles.length} tiles from {t.tiles[0].x}, {t.tiles[0].y}"
					color="var(--map-tunnels-blocked)"
					onremove={() => removeBlockedTunnel(t.id)}
				/>
			{/each}
		</ul>
	{:else}
		<p class="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
			No blocked tunnels on this level.
		</p>
	{/if}
</div>
