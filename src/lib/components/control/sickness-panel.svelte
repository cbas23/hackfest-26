<script lang="ts">
	import ShuffleIcon from '@lucide/svelte/icons/shuffle';
	import { LEVELS } from '#lib/hollow/data.js';
	import type { SicknessSettings } from '#lib/hollow/state.js';
	import { formatPercent } from '#lib/hollow/format.js';
	import { DEFAULT_SICKNESS, sicknessOf, sicknessTotals } from '#lib/hollow/sickness.js';
	import { currentState, getHollow } from '#lib/hollow/simulation.js';
	import { live } from '#lib/live/state.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import { control, publishSickness } from './control-state.svelte.js';

	const hollow = getHollow();
	const published = $derived.by(() => {
		void live.version;
		return currentState().sickness;
	});
	/** What the panel shows: the draft if there is one, else the published settings. */
	const shown = $derived(control.sicknessDraft ?? published);
	const dirty = $derived(control.sicknessDraft !== null);

	function set<K extends keyof SicknessSettings>(key: K, value: SicknessSettings[K]) {
		control.sicknessDraft = { ...shown, [key]: value };
	}

	const DIALS: {
		key: Exclude<keyof SicknessSettings, 'seed'>;
		label: string;
		min: number;
		max: number;
		step: number;
		format: (v: number) => string;
	}[] = [
		{ key: 'hotspots', label: 'Hotspots on L1', min: 0, max: 24, step: 1, format: String },
		{
			key: 'hotspotsDrop',
			label: 'Fewer per level down',
			min: 0,
			max: 4,
			step: 0.1,
			format: (v) => v.toFixed(1)
		},
		{
			key: 'spread',
			label: 'Hotspot size',
			min: 0.3,
			max: 3,
			step: 0.05,
			format: (v) => `${v.toFixed(2)}×`
		},
		{
			key: 'intensity',
			label: 'Hotspot intensity',
			min: 0.2,
			max: 1.5,
			step: 0.05,
			format: (v) => `${v.toFixed(2)}×`
		},
		{
			key: 'background',
			label: 'Background rate (L1)',
			min: 0,
			max: 0.4,
			step: 0.01,
			format: formatPercent
		},
		{
			key: 'depthFalloff',
			label: 'Kept per level down',
			min: 0.4,
			max: 1,
			step: 0.01,
			format: formatPercent
		}
	];

	/** Sick share per level with the shown settings. */
	const levels = $derived(
		LEVELS.map((l) => sicknessTotals([sicknessOf(hollow.floor(l.index), shown)]))
	);
	const city = $derived(
		sicknessTotals(LEVELS.map((l) => sicknessOf(hollow.floor(l.index), shown)))
	);
</script>

<div class="flex flex-col gap-3 text-xs">
	<p class="text-muted-foreground">
		Where lung sickness is comes from a seed: it places the hotspots, and the dials shape them.
		Changes preview here and reach the map when you publish them.
	</p>

	<label class="flex flex-col gap-1.5">
		<span>Seed</span>
		<span class="flex gap-1.5">
			<Input
				type="number"
				class="h-8 text-xs"
				value={shown.seed}
				onchange={(e) => set('seed', Math.trunc(Number(e.currentTarget.value)) || 0)}
			/>
			<Button
				variant="outline"
				size="icon"
				class="size-8"
				aria-label="New random seed"
				title="New random seed"
				onclick={() => set('seed', Math.floor(Math.random() * 1e6))}><ShuffleIcon /></Button
			>
		</span>
	</label>

	{#each DIALS as d (d.key)}
		<label class="flex flex-col gap-2">
			<span class="flex justify-between"
				><span>{d.label}</span><span class="tabular-nums">{d.format(shown[d.key])}</span></span
			>
			<Slider
				type="single"
				value={shown[d.key]}
				onValueChange={(v) => set(d.key, v)}
				min={d.min}
				max={d.max}
				step={d.step}
			/>
		</label>
	{/each}

	<div class="flex flex-col gap-1 rounded-md border bg-muted/30 p-2.5">
		<span class="flex justify-between font-medium text-foreground"
			><span>Whole city</span><span class="tabular-nums">{formatPercent(city.share)} sick</span
			></span
		>
		{#each LEVELS as l (l.code)}
			{@const t = levels[l.index]}
			<span class="flex items-center gap-2">
				<span class="w-6 font-semibold text-primary">{l.code}</span>
				<span class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
					<span
						class="block h-full rounded-full bg-[var(--map-sick-4)]"
						style="width:{Math.min(100, t.share * 100 * 2)}%"
					></span>
				</span>
				<span class="w-10 text-right tabular-nums">{formatPercent(t.share)}</span>
			</span>
		{/each}
	</div>

	<div class="flex gap-1.5">
		<Button
			size="sm"
			class="flex-1"
			disabled={!dirty || control.busy}
			onclick={() => control.sicknessDraft && publishSickness(control.sicknessDraft)}
			>Publish to map</Button
		>
		<Button
			size="sm"
			variant="outline"
			disabled={!dirty}
			onclick={() => (control.sicknessDraft = null)}>Discard</Button
		>
		<Button
			size="sm"
			variant="ghost"
			onclick={() => (control.sicknessDraft = { ...DEFAULT_SICKNESS })}>Defaults</Button
		>
	</div>
</div>
