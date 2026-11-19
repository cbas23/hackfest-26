<script lang="ts">
	import { BLACKOUT_RADIUS, isActive } from '#lib/hollow/events.js';
	import { formatCompact } from '#lib/hollow/format.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { live } from '#lib/live/events.svelte.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import EventRow from './event-row.svelte';
	import { control, setBlackoutRadius } from './control-state.svelte.js';

	const hollow = getHollow();
	const sim = $derived.by(() => {
		void live.version;
		return simulateFloor(hollow.floor(control.level));
	});
	/** Each blackout with its alert (for the neighborhood, blocks and severity). */
	const rows = $derived.by(() => {
		const alerts = new Map(
			[...sim.alerts.alerts, ...sim.alerts.resolved].map((a) => [a.id, a] as const)
		);
		return sim.local.blackouts
			.map((b) => ({ b, alert: alerts.get(`blackout:${b.id}`) }))
			.sort((x, y) => Number(isActive(y.b)) - Number(isActive(x.b)));
	});
	/** Radius being dragged on an existing blackout, before it's saved. */
	const dragging = $state<Record<string, number>>({});
</script>

<div class="flex flex-col gap-3">
	<p class="text-xs text-muted-foreground">
		Click the map to cut power over a round area. Every housing block inside goes dark.
	</p>
	<label class="flex flex-col gap-2 text-xs">
		<span class="flex justify-between"
			><span>New blackout radius</span><span class="tabular-nums">{control.radius} tiles</span
			></span
		>
		<Slider
			type="single"
			bind:value={control.radius}
			min={BLACKOUT_RADIUS.min}
			max={BLACKOUT_RADIUS.max}
			step={1}
		/>
	</label>

	{#if rows.length}
		<ul class="flex flex-col gap-1.5">
			{#each rows as { b, alert } (b.id)}
				<EventRow
					event={{ table: 'blackouts', id: b.id }}
					active={isActive(b)}
					title={alert ? `Blackout · ${alert.where.split(' · ')[0]}` : 'Blackout (no housing)'}
					sub={alert
						? `${alert.blocks.length} blocks · ${formatCompact(alert.residents)} residents in the dark`
						: `At ${b.x}, ${b.y}`}
					severity={alert?.severity}
				>
					<label class="flex flex-col gap-1.5">
						<span class="flex justify-between text-muted-foreground"
							><span>Radius</span><span class="tabular-nums"
								>{dragging[b.id] ?? b.radius} tiles</span
							></span
						>
						<Slider
							type="single"
							value={dragging[b.id] ?? b.radius}
							onValueChange={(v) => (dragging[b.id] = v)}
							onValueCommit={async (v) => {
								await setBlackoutRadius(b.id, v);
								delete dragging[b.id];
							}}
							min={BLACKOUT_RADIUS.min}
							max={BLACKOUT_RADIUS.max}
							step={1}
						/>
					</label>
				</EventRow>
			{/each}
		</ul>
	{:else}
		<p class="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
			No blackouts on this level.
		</p>
	{/if}
</div>
