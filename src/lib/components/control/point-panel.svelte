<script lang="ts">
	import { POINT_INFO, POINT_RADIUS, type PointKind } from '#lib/hollow/state.js';
	import { formatCompact } from '#lib/hollow/format.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { live } from '#lib/live/state.svelte.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import StateRow from './state-row.svelte';
	import { control, removePoint, setPointRadius } from './control-state.svelte.js';

	let { kind }: { kind: PointKind } = $props();

	const hollow = getHollow();
	const info = $derived(POINT_INFO[kind]);
	const sim = $derived.by(() => {
		void live.version;
		return simulateFloor(hollow.floor(control.level));
	});
	/** This kind's points on the level, with the blocks and residents they cover. */
	const rows = $derived(
		sim.conditions.areas
			.filter((a) => a.point.kind === kind)
			.map((a) => ({
				...a,
				residents: a.blocks.reduce((s, b) => s + sim.floor.residents[b], 0)
			}))
	);
	/** Radius being dragged on an existing point, before it's saved. */
	const dragging = $state<Record<string, number>>({});
</script>

<div class="flex flex-col gap-3">
	<p class="text-xs text-muted-foreground">
		Click the map to place a {info.bad.toLowerCase()} point. Every housing block inside its circle has
		{info.bad.toLowerCase()}; everywhere else is {info.good.toLowerCase()}.
	</p>
	<label class="flex flex-col gap-2 text-xs">
		<span class="flex justify-between"
			><span>New point radius</span><span class="tabular-nums">{control.radius} tiles</span></span
		>
		<Slider
			type="single"
			bind:value={control.radius}
			min={POINT_RADIUS.min}
			max={POINT_RADIUS.max}
			step={1}
		/>
	</label>

	{#if rows.length}
		<ul class="flex flex-col gap-1.5">
			{#each rows as { point, blocks, residents } (point.id)}
				<StateRow
					title="{info.bad} · {point.x}, {point.y}"
					sub={blocks.length
						? `${blocks.length} blocks · ${formatCompact(residents)} residents`
						: 'No housing inside'}
					color={info.color}
					onremove={() => removePoint(point.id)}
				>
					<label class="flex flex-col gap-1.5">
						<span class="flex justify-between text-muted-foreground"
							><span>Radius</span><span class="tabular-nums"
								>{dragging[point.id] ?? point.radius} tiles</span
							></span
						>
						<Slider
							type="single"
							value={dragging[point.id] ?? point.radius}
							onValueChange={(v) => (dragging[point.id] = v)}
							onValueCommit={async (v) => {
								await setPointRadius(point.id, v);
								delete dragging[point.id];
							}}
							min={POINT_RADIUS.min}
							max={POINT_RADIUS.max}
							step={1}
						/>
					</label>
				</StateRow>
			{/each}
		</ul>
	{:else}
		<p class="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
			No {info.label.toLowerCase()} points on this level: {info.good.toLowerCase()} everywhere.
		</p>
	{/if}
</div>
