<script lang="ts">
	import { CONDITION_STEPS } from '#lib/hollow/conditions.js';
	import { POINT_INFO, POINT_RADIUS, POINT_STRENGTH, type SourceKind } from '#lib/hollow/state.js';
	import { SICK_STEPS } from '#lib/hollow/sickness.js';
	import { formatCompact, formatPercent } from '#lib/hollow/format.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { live } from '#lib/live/state.svelte.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import StepScale from '#lib/components/home/step-scale.svelte';
	import StateRow from './state-row.svelte';
	import { control, removePoint, updatePoint } from './control-state.svelte.js';

	let { kind }: { kind: SourceKind } = $props();

	const hollow = getHollow();
	const info = $derived(POINT_INFO[kind]);
	const reachLabel = $derived(info.spread === 'tunnels' ? 'Reach along tunnels' : 'Radius');
	const sim = $derived.by(() => {
		void live.version;
		return simulateFloor(hollow.floor(control.level));
	});
	const steps = $derived(
		kind === 'sickness' ? SICK_STEPS.map((s) => ({ ...s, label: s.range })) : CONDITION_STEPS[kind]
	);
	/** This kind's points on the level, with the blocks and residents they reach. */
	const rows = $derived(
		sim.areas(kind).map((a) => ({
			...a,
			residents: a.blocks.reduce((s, b) => s + sim.floor.residents[b], 0)
		}))
	);
	/** Values being dragged on an existing point, before they're saved. */
	const dragging = $state<Record<string, { radius?: number; strength?: number }>>({});
	const pct = (v: number) => formatPercent(v);
</script>

{#snippet dial(
	label: string,
	value: number,
	text: string,
	range: { min: number; max: number },
	step: number,
	onchange: (v: number) => void,
	oncommit?: (v: number) => void
)}
	<label class="flex flex-col gap-1.5">
		<span class="flex justify-between"
			><span>{label}</span><span class="tabular-nums">{text}</span></span
		>
		<Slider
			type="single"
			{value}
			onValueChange={onchange}
			onValueCommit={oncommit}
			min={range.min}
			max={range.max}
			{step}
		/>
	</label>
{/snippet}

<div class="flex flex-col gap-3 text-xs">
	<p class="text-muted-foreground">
		Click the map to place {kind === 'sickness' ? 'an' : 'a'}
		{info.point.toLowerCase()}. {kind === 'sickness'
			? 'It makes residents of the blocks it reaches report lung sickness,'
			: 'It pushes the blocks it reaches towards bad,'} strongest at the point and fading out
		{info.spread === 'tunnels'
			? 'along the tunnels, so it only reaches what its tunnels connect.'
			: 'over the area around it.'}
		Overlapping points compound.
	</p>
	<StepScale {steps} />
	{@render dial(
		`New point: ${reachLabel.toLowerCase()}`,
		control.radius,
		`${control.radius} tiles`,
		POINT_RADIUS,
		1,
		(v) => (control.radius = v)
	)}
	{@render dial(
		'New point: strength',
		control.strength,
		pct(control.strength),
		POINT_STRENGTH,
		0.05,
		(v) => (control.strength = v)
	)}

	{#if rows.length}
		<ul class="flex flex-col gap-1.5">
			{#each rows as { point, blocks, residents } (point.id)}
				{@const d = dragging[point.id] ?? {}}
				{@const radius = d.radius ?? point.radius}
				{@const strength = d.strength ?? point.strength ?? 1}
				{@const commit = async (patch: { radius?: number; strength?: number }) => {
					await updatePoint(point.id, patch);
					delete dragging[point.id];
				}}
				<StateRow
					title="{info.point} · {point.x}, {point.y}"
					sub={blocks.length
						? `${blocks.length} blocks · ${formatCompact(residents)} residents affected`
						: 'Reaches no housing'}
					color={info.color}
					onremove={() => removePoint(point.id)}
				>
					<div class="flex flex-col gap-2 text-muted-foreground">
						{@render dial(
							reachLabel,
							radius,
							`${radius} tiles`,
							POINT_RADIUS,
							1,
							(v) => (dragging[point.id] = { ...d, radius: v }),
							(v) => commit({ radius: v })
						)}
						{@render dial(
							'Strength',
							strength,
							pct(strength),
							POINT_STRENGTH,
							0.05,
							(v) => (dragging[point.id] = { ...d, strength: v }),
							(v) => commit({ strength: v })
						)}
					</div>
				</StateRow>
			{/each}
		</ul>
	{:else}
		<p class="rounded-md border border-dashed p-3 text-center text-muted-foreground">
			No {kind === 'sickness' ? 'outbreaks' : `${info.point.toLowerCase()} points`} on this level.
		</p>
	{/if}
</div>
