<script lang="ts">
	import ZapOffIcon from '@lucide/svelte/icons/zap-off';
	import FanIcon from '@lucide/svelte/icons/fan';
	import DropletsIcon from '@lucide/svelte/icons/droplets';
	import ConstructionIcon from '@lucide/svelte/icons/construction';
	import HeartPulseIcon from '@lucide/svelte/icons/heart-pulse';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import { LEVELS } from '#lib/hollow/data.js';
	import { POINT_KINDS, type PointKind } from '#lib/hollow/state.js';
	import { currentState } from '#lib/hollow/simulation.js';
	import { connectLive, live } from '#lib/live/state.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { cn } from '#lib/utils.js';
	import FloorCanvas from '#lib/components/control/floor-canvas.svelte';
	import PointPanel from '#lib/components/control/point-panel.svelte';
	import TunnelPanel from '#lib/components/control/tunnel-panel.svelte';
	import SicknessPanel from '#lib/components/control/sickness-panel.svelte';
	import {
		clearMap,
		control,
		loadStarterScenario,
		type ControlTab
	} from '#lib/components/control/control-state.svelte.js';

	connectLive();

	const TABS: { value: ControlTab; label: string; icon: typeof ZapOffIcon }[] = [
		{ value: 'power', label: 'Power', icon: ZapOffIcon },
		{ value: 'water', label: 'Water', icon: DropletsIcon },
		{ value: 'air', label: 'Air', icon: FanIcon },
		{ value: 'tunnels', label: 'Tunnels', icon: ConstructionIcon },
		{ value: 'sickness', label: 'Sickness', icon: HeartPulseIcon }
	];

	const state = $derived.by(() => {
		void live.version;
		return currentState();
	});
	/** Points of a kind, and blocked tunnels, optionally on one level. */
	const on = (list: { level: number }[], level?: number) =>
		level === undefined ? list.length : list.filter((e) => e.level === level).length;
	const pointsOf = (kind: PointKind) => state.points.filter((p) => p.kind === kind);
	const countOnLevel = (level: number) => on(state.points, level) + on(state.blockedTunnels, level);
	const total = $derived(state.points.length + state.blockedTunnels.length);
	const empty = $derived(live.status === 'live' && total === 0);
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
			confirm(
				'Replace every point, blocked tunnel and the sickness settings with the starter scenario?'
			)
		)
			void loadStarterScenario();
	}
	function confirmClear() {
		if (confirm('Delete every power, water and air point and every blocked tunnel?'))
			void clearMap();
	}
</script>

<svelte:head><title>The Hollow · Control center</title></svelte:head>

<main class="flex h-full flex-col overflow-hidden lg:flex-row">
	<!-- The level and its state -->
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
					{@const n = countOnLevel(l.index)}
					<ToggleGroup.Item
						value={l.code}
						aria-label="{l.name}, {n} points and tunnels"
						class="gap-1"
					>
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
					{#each POINT_KINDS as k (k)}{on(pointsOf(k), level.index)} {k} ·
					{/each}{on(state.blockedTunnels, level.index)} tunnels
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
					{state.points.length} points · {state.blockedTunnels.length} tunnels
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
					The map is all clear. Load the starter scenario to fill the city from its seed, or start
					placing points on the map.
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
					variant="ghost"
					class="text-destructive"
					disabled={control.busy || live.status !== 'live'}
					onclick={confirmClear}>Clear map</Button
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
			{#each POINT_KINDS as k (k)}
				<Tabs.Content value={k}><PointPanel kind={k} /></Tabs.Content>
			{/each}
			<Tabs.Content value="tunnels"><TunnelPanel /></Tabs.Content>
			<Tabs.Content value="sickness"><SicknessPanel /></Tabs.Content>
		</Tabs.Root>
	</aside>
</main>
