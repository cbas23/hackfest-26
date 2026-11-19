<script lang="ts">
	import { FACILITY_INFO } from '#lib/hollow/data.js';
	import { isActive, SEVERITIES, type Severity } from '#lib/hollow/events.js';
	import { formatCompact } from '#lib/hollow/format.js';
	import { METRICS, STATUS_INFO } from '#lib/hollow/sensors.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { live } from '#lib/live/events.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { cn } from '#lib/utils.js';
	import EventRow from './event-row.svelte';
	import {
		addFacilityEvent,
		control,
		setFacilitySeverity,
		type FacilityTable
	} from './control-state.svelte.js';

	let { table }: { table: FacilityTable } = $props();

	const kind = $derived(table === 'airQuality' ? 'air' : 'water');
	const metrics = $derived(METRICS[kind]);
	const hollow = getHollow();
	const sim = $derived.by(() => {
		void live.version;
		return simulateFloor(hollow.floor(control.level));
	});
	const facilities = $derived(sim.places.filter((p) => p.kind === kind));
	const selected = $derived(facilities.find((p) => p.key === control.facility[table]) ?? null);
	const status = $derived(selected ? sim.status(selected) : null);
	const impact = $derived(selected ? sim.impact(selected) : null);
	const events = $derived(
		selected
			? sim.local[table]
					.filter((e) => e.facility === selected.key)
					.sort((a, b) => Number(isActive(b)) - Number(isActive(a)))
			: []
	);
	const countOn = (key: string) =>
		sim.local[table].filter((e) => e.facility === key && isActive(e)).length;
	const metricLabel = (key: string) => metrics.find((m) => m.key === key)?.label ?? key;
</script>

<div class="flex flex-col gap-3">
	<p class="text-xs text-muted-foreground">
		{kind === 'air'
			? 'Pick a ventilation plant (on the map or below) and push one of its readings into a bad band.'
			: 'Pick a water plant (on the map or below). Turbidity and chlorine are quality problems; recycler output is a supply cut.'}
	</p>

	<ul class="flex flex-col gap-1">
		{#each facilities as p (p.key)}
			{@const st = sim.status(p)?.status ?? 'normal'}
			<li>
				<button
					type="button"
					onclick={() => (control.facility[table] = selected?.key === p.key ? null : p.key)}
					class={cn(
						'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/60',
						selected?.key === p.key && 'border-foreground/50 bg-muted/60'
					)}
				>
					<span class="size-2.5 shrink-0 rounded-sm" style="background:{FACILITY_INFO[kind].color}"
					></span>
					<span class="flex-1 truncate font-medium text-foreground">{p.label}</span>
					{#if countOn(p.key)}
						<span class="text-muted-foreground tabular-nums">{countOn(p.key)} events</span>
					{/if}
					<span
						class="size-2 shrink-0 rounded-full"
						style="background:{STATUS_INFO[st].color}"
						title={STATUS_INFO[st].label}
					></span>
				</button>
			</li>
		{:else}
			<li class="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
				No {FACILITY_INFO[kind].label.toLowerCase()} facilities on this level.
			</li>
		{/each}
	</ul>

	{#if selected && status}
		<div class="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 text-xs">
			<div class="flex items-center justify-between">
				<span class="font-semibold text-foreground">{selected.label}</span>
				<span style="color:{STATUS_INFO[status.status].color}" class="font-semibold"
					>{STATUS_INFO[status.status].label}</span
				>
			</div>
			<dl class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
				{#each status.readings as r (r.key)}
					<dt class="text-muted-foreground">{r.label}</dt>
					<dd class="text-right tabular-nums" style="color:{STATUS_INFO[r.status].color}">
						{r.text}
					</dd>
				{/each}
			</dl>
			{#if impact}
				<p class="text-muted-foreground">
					Serves {formatCompact(impact.dependentTotal)} residents · {formatCompact(
						impact.affectedTotal
					)} losing service now
				</p>
			{/if}

			<div class="flex flex-col gap-2 border-t pt-3">
				<span class="font-medium text-foreground">New event</span>
				<ToggleGroup.Root
					type="single"
					variant="outline"
					size="sm"
					class="w-full"
					bind:value={() => control.metric[table], (v) => v && (control.metric[table] = v)}
					aria-label="Metric"
				>
					{#each metrics as m (m.key)}
						<ToggleGroup.Item value={m.key} class="flex-1 text-[11px]">{m.label}</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
				<ToggleGroup.Root
					type="single"
					variant="outline"
					size="sm"
					class="w-full"
					bind:value={() => control.severity, (v) => v && (control.severity = v as Severity)}
					aria-label="Severity"
				>
					{#each SEVERITIES as s (s)}
						<ToggleGroup.Item value={s} class="flex-1 text-[11px]">
							<span class="size-2 rounded-full" style="background:{STATUS_INFO[s].color}"></span>
							{STATUS_INFO[s].label}
						</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
				<Button
					size="sm"
					disabled={control.busy}
					onclick={() => addFacilityEvent(table, selected.key)}>Add event</Button
				>
			</div>
		</div>

		{#if events.length}
			<ul class="flex flex-col gap-1.5">
				{#each events as e (e.id)}
					<EventRow
						event={{ table, id: e.id }}
						active={isActive(e)}
						title={metricLabel(e.metric)}
						sub={e.note}
						severity={e.severity}
					>
						<ToggleGroup.Root
							type="single"
							variant="outline"
							size="sm"
							class="w-full"
							value={e.severity}
							onValueChange={(v) => v && setFacilitySeverity({ table, id: e.id }, v as Severity)}
							aria-label="Severity"
						>
							{#each SEVERITIES as s (s)}
								<ToggleGroup.Item value={s} class="flex-1 text-[11px]"
									>{STATUS_INFO[s].label}</ToggleGroup.Item
								>
							{/each}
						</ToggleGroup.Root>
					</EventRow>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
