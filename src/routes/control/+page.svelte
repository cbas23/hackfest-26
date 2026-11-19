<script lang="ts">
	import ZapOffIcon from '@lucide/svelte/icons/zap-off';
	import WindIcon from '@lucide/svelte/icons/wind';
	import DropletsIcon from '@lucide/svelte/icons/droplets';
	import ConstructionIcon from '@lucide/svelte/icons/construction';
	import HeartPulseIcon from '@lucide/svelte/icons/heart-pulse';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { LEVELS } from '#lib/hollow/data.js';
	import { EVENT_TABLES, isActive, type EventTable } from '#lib/hollow/events.js';
	import { currentEvents } from '#lib/hollow/simulation.js';
	import { connectLive, live, reopenAllEvents } from '#lib/live/events.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { cn } from '#lib/utils.js';
	import FloorCanvas from '#lib/components/control/floor-canvas.svelte';
	import BlackoutPanel from '#lib/components/control/blackout-panel.svelte';
	import FacilityPanel from '#lib/components/control/facility-panel.svelte';
	import TunnelPanel from '#lib/components/control/tunnel-panel.svelte';
	import SicknessPanel from '#lib/components/control/sickness-panel.svelte';
	import {
		clearEvents,
		control,
		loadStarterScenario,
		type ControlTab
	} from '#lib/components/control/control-state.svelte.js';

	connectLive();

	const TABS: { value: ControlTab; label: string; icon: typeof ZapOffIcon }[] = [
		{ value: 'blackouts', label: 'Blackouts', icon: ZapOffIcon },
		{ value: 'airQuality', label: 'Air', icon: WindIcon },
		{ value: 'waterCuts', label: 'Water', icon: DropletsIcon },
		{ value: 'blockedTunnels', label: 'Tunnels', icon: ConstructionIcon },
		{ value: 'sickness', label: 'Sickness', icon: HeartPulseIcon }
	];

	const events = $derived.by(() => {
		void live.version;
		return currentEvents();
	});
	/** Active events per table and level. */
	const active = (table: EventTable, level?: number) =>
		events[table].filter((e) => isActive(e) && (level === undefined || e.level === level)).length;
	const activeOnLevel = (level: number) => EVENT_TABLES.reduce((n, t) => n + active(t, level), 0);
	const fixedCount = $derived(
		EVENT_TABLES.reduce((n, t) => n + events[t].filter((e) => !isActive(e)).length, 0)
	);
	const empty = $derived(
		live.status === 'live' && EVENT_TABLES.every((t) => events[t].length === 0)
	);
	const level = $derived(LEVELS[control.level]);

	const STATUS_LABEL = {
		idle: 'Not connected',
		connecting: 'Connecting…',
		live: 'Live',
		offline: 'Offline (no Convex URL)'
	} as const;

	function confirmLoad() {
		if (
			empty ||
			confirm('Replace every event (and the sickness settings) with the starter scenario?')
		)
			void loadStarterScenario();
	}
	function confirmClear() {
		if (confirm('Delete every blackout, air, water and tunnel event?')) void clearEvents();
	}
</script>

<svelte:head><title>The Hollow · Control center</title></svelte:head>

<main class="flex h-full flex-col overflow-hidden lg:flex-row">
	<!-- The level and its events -->
	<section class="flex min-h-[55vh] min-w-0 flex-1 flex-col lg:min-h-0">
		<header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
			<div class="flex flex-col">
				<h1 class="text-sm font-semibold">Control center</h1>
				<p class="text-[11px] text-muted-foreground">
					Edits go live on the map for everyone · all data fictional
				</p>
			</div>
			<ToggleGroup.Root
				type="single"
				variant="outline"
				size="sm"
				class="ml-auto"
				aria-label="Level"
				bind:value={
					() => level.code, (v) => v && (control.level = LEVELS.findIndex((l) => l.code === v))
				}
			>
				{#each LEVELS as l (l.code)}
					{@const n = activeOnLevel(l.index)}
					<ToggleGroup.Item value={l.code} aria-label="{l.name}, {n} active events" class="gap-1">
						{l.code}
						{#if n}<span class="text-[10px] text-muted-foreground tabular-nums">{n}</span>{/if}
					</ToggleGroup.Item>
				{/each}
			</ToggleGroup.Root>
		</header>
		<div class="relative min-h-0 flex-1 bg-muted/20">
			<FloorCanvas />
			<div
				class="pointer-events-none absolute top-3 left-4 flex flex-col text-xs [text-shadow:0_0_4px_var(--background)]"
			>
				<span class="font-semibold text-foreground">{level.code} {level.name}</span>
				<span class="text-muted-foreground">
					{active('blackouts', level.index)} blackouts · {active('airQuality', level.index)} air ·
					{active('waterCuts', level.index)} water · {active('blockedTunnels', level.index)} tunnels
				</span>
			</div>
		</div>
	</section>

	<!-- Editing -->
	<aside
		class="flex w-full shrink-0 flex-col overflow-y-auto border-t bg-sidebar lg:w-[400px] lg:border-t-0 lg:border-l"
	>
		<div class="flex flex-col gap-2 border-b p-4">
			<div class="flex items-center justify-between text-xs">
				<span class="flex items-center gap-1.5">
					<span
						class={cn(
							'size-2 rounded-full',
							live.status === 'live'
								? 'bg-emerald-500'
								: live.status === 'offline'
									? 'bg-destructive'
									: 'animate-pulse bg-amber-500'
						)}
					></span>
					{STATUS_LABEL[live.status]}
				</span>
				<span class="text-muted-foreground tabular-nums">
					{EVENT_TABLES.reduce((n, t) => n + active(t), 0)} active events
				</span>
			</div>
			{#if live.error}
				<p
					class="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
				>
					{live.error}
				</p>
			{/if}
			{#if empty}
				<p class="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
					There are no events yet. Load the starter scenario to fill the city from its seed, or
					start placing events on the map.
				</p>
			{/if}
			<div class="flex flex-wrap gap-1.5">
				<Button
					size="sm"
					variant={empty ? 'default' : 'outline'}
					disabled={control.busy || live.status !== 'live'}
					onclick={confirmLoad}><DatabaseIcon /> Load starter scenario</Button
				>
				<Button
					size="sm"
					variant="outline"
					disabled={control.busy || !fixedCount}
					onclick={() => reopenAllEvents()}><RotateCcwIcon /> Reopen {fixedCount} fixed</Button
				>
				<Button
					size="sm"
					variant="ghost"
					class="text-destructive"
					disabled={control.busy || live.status !== 'live'}
					onclick={confirmClear}>Clear events</Button
				>
			</div>
		</div>

		<Tabs.Root bind:value={control.tab} class="flex flex-col gap-3 p-4">
			<Tabs.List class="w-full">
				{#each TABS as t (t.value)}
					<Tabs.Trigger value={t.value} class="flex-1 gap-1 px-1 text-xs" title={t.label}>
						<t.icon class="size-3.5" />
						<span class="hidden sm:inline">{t.label}</span>
					</Tabs.Trigger>
				{/each}
			</Tabs.List>
			<Tabs.Content value="blackouts"><BlackoutPanel /></Tabs.Content>
			<Tabs.Content value="airQuality"><FacilityPanel table="airQuality" /></Tabs.Content>
			<Tabs.Content value="waterCuts"><FacilityPanel table="waterCuts" /></Tabs.Content>
			<Tabs.Content value="blockedTunnels"><TunnelPanel /></Tabs.Content>
			<Tabs.Content value="sickness"><SicknessPanel /></Tabs.Content>
		</Tabs.Root>
	</aside>
</main>
