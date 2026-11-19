<script lang="ts">
	import { onMount } from 'svelte';
	import type { Room } from '#lib/tunnels/generate.js';
	import { LEVELS } from '#lib/hollow/data.js';
	import { formatCount, formatDepth, formatPercent } from '#lib/hollow/format.js';
	import { placeCentre, placeColor, type Place, type PlaceKind } from '#lib/hollow/nav.js';
	import { createHollowMap, type HollowMap, type Pick } from '#lib/hollow/hollowMap.js';
	import { STATUS_INFO, type Status } from '#lib/hollow/sensors.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { floorBounds, type Floor } from '#lib/hollow/world.js';
	import { sicknessTotals } from '#lib/hollow/sickness.js';
	import SicknessScale from './sickness-scale.svelte';
	import { home, openLens, registerMapNav } from './home-state.svelte.js';
	import { bindMapKeys, KEY_HINTS, ZOOM_STEP } from './map-keys.js';
	import { cn } from '#lib/utils.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as ButtonGroup from '#lib/components/ui/button-group/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import PlaceCard from './place-card.svelte';
	import PlaceIcon from './place-icon.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import ScanIcon from '@lucide/svelte/icons/scan';

	const hollow = getHollow();
	const allFloors = () => LEVELS.map((l) => hollow.floor(l.index));

	let section: HTMLElement;
	let container: HTMLDivElement;
	let scene = $state.raw<HollowMap | undefined>();

	let levelIndex = $state(0);
	let hover = $state.raw<Room | null>(null);
	let selected = $state.raw<Place | null>(null);
	let distance = $state(250);
	let heading = $state(0);
	/** True while the map animates between levels; markers hide meanwhile. */
	let switching = $state(false);
	/** All levels stacked at their depths, instead of one at a time. */
	let overview = $state(false);
	/** In the stacked view, the level under the pointer (over the map, or its name tag). */
	let mapHoverLevel = $state<number | null>(null);
	let tagHoverLevel = $state<number | null>(null);
	const hoverLevel = $derived(overview ? (tagHoverLevel ?? mapHoverLevel) : null);
	$effect(() => scene?.setFocusLevel(hoverLevel));

	/**
	 * The pick misses in the gaps between a level's tunnels, so losing the level waits a
	 * moment: sweeping across one doesn't flicker the others back in.
	 */
	let leaveTimer: ReturnType<typeof setTimeout> | undefined;
	function hoverStackLevel(level: number | null) {
		clearTimeout(leaveTimer);
		if (level !== null) mapHoverLevel = level;
		else if (mapHoverLevel !== null) leaveTimer = setTimeout(() => (mapHoverLevel = null), 180);
	}

	const level = $derived(LEVELS[levelIndex]);
	// Mirror the view into shared state so the sidebar's depth gauge follows the map.
	$effect(() => {
		home.level = levelIndex;
		home.overview = overview;
	});
	const floor = $derived(hollow.floor(levelIndex));
	const sim = $derived(simulateFloor(floor));
	/** The simulation of the selected place's floor. */
	const selectedSim = $derived(selected ? simulateFloor(hollow.floor(selected.floor)) : null);

	// ── Levels ───────────────────────────────────────────────────────────────
	function goTo(index: number) {
		if (index < 0 || index >= LEVELS.length) return;
		if (index === levelIndex && !overview) return;
		const dir = Math.sign(index - levelIndex);
		const leaving = overview;
		overview = false;
		levelIndex = index;
		hover = null;
		hoverStackLevel(null);
		tagHoverLevel = null;
		scene?.showFloor(hollow.floor(index), dir);
		if (leaving) scene?.fitBounds(...floorBounds(hollow.floor(index)));
		scene?.setHover(null);
		scene?.setSelection(selected?.floor === index ? selected.room : null);
	}

	function setOverview(on: boolean) {
		if (on === overview) return;
		overview = on;
		if (!on) {
			scene?.setOverview(false, []);
			scene?.fitBounds(...floorBounds(floor));
			return;
		}
		hover = null;
		scene?.setHover(null);
		scene?.setOverview(true, allFloors());
	}

	/** Toggle group value: 'all' for the stacked view, else a level code. */
	const layerValue = $derived(overview ? 'all' : level.code);
	function selectLayer(v: string) {
		if (!v) return;
		if (v === 'all') setOverview(true);
		else goTo(LEVELS.findIndex((l) => l.code === v));
	}

	function fitView() {
		if (overview) scene?.frameStack();
		else scene?.fitBounds(...floorBounds(floor));
	}

	// ── Selection ────────────────────────────────────────────────────────────
	const placeOf = (f: Floor, room: Room | null) =>
		room ? (simulateFloor(f).places.find((p) => p.room.id === room.id) ?? null) : null;

	function select(p: Place | null) {
		selected = p;
		scene?.setSelection(p?.room ?? null);
	}

	function focusPlace(p: Place) {
		goTo(p.floor);
		select(p);
		const c = placeCentre(p);
		scene?.flyTo(c.x, c.y, { distance: Math.min(distance, 70) });
	}

	function onPick(pick: Pick | null) {
		if (overview) {
			if (pick) goTo(pick.level);
			return;
		}
		// Mid-transition the scene can still show another level; ignore picks that landed there.
		if (pick && pick.level !== levelIndex) return;
		select(placeOf(floor, pick?.room ?? null));
	}

	// ── Pins (HTML markers pinned to the 3D scene) ───────────────────────────
	interface PinSpec {
		key: string;
		x: number;
		y: number;
		h: number;
		kind: PlaceKind | 'level';
		level: number;
		label: string;
		color: string;
		place?: Place;
		status?: Status;
	}
	/** Pin height above the floor, by kind: over the roof of its building. */
	const pinHeight = (kind: PlaceKind) => (kind === 'shaft' ? 7.5 : kind === 'plant' ? 4.5 : 3.5);
	const pins = $derived.by<PinSpec[]>(() => {
		if (overview) {
			return LEVELS.map((l) => {
				const [, minY, maxX, maxY] = floorBounds(hollow.floor(l.index));
				return {
					key: `level-${l.code}`,
					x: maxX + 2,
					y: (minY + maxY) / 2,
					h: 1,
					level: l.index,
					kind: 'level',
					label: l.name,
					color: 'var(--foreground)'
				};
			});
		}
		return sim.places
			.filter((p) => p.kind !== 'block')
			.map((p) => ({
				key: p.key,
				...placeCentre(p),
				h: pinHeight(p.kind),
				level: levelIndex,
				kind: p.kind,
				label: p.label,
				color: placeColor(p),
				place: p,
				status: sim.status(p)?.status
			}));
	});
	const pinEls = $state<Record<string, HTMLElement>>({});
	$effect(() => {
		scene?.setPins(
			pins
				.filter((p) => pinEls[p.key])
				.map((p) => ({ el: pinEls[p.key], x: p.x, y: p.y, h: p.h, level: p.level }))
		);
	});
	const showNames = $derived(distance < 200);

	// ── Impact assessment (selected facility → affected neighborhoods) ──────
	const impact = $derived(selected && selectedSim ? selectedSim.impact(selected) : null);
	$effect(() => {
		const show = impact?.active && impact.facility.floor === levelIndex;
		scene?.setImpact(
			show
				? impact.neighborhoods.flatMap((n) =>
						n.blocks.map((id) => ({
							room: floor.map.rooms[id],
							color: STATUS_INFO[n.severity].color
						}))
					)
				: []
		);
	});

	// ── Data lens (driven by the open sidebar section) ──────────────────────
	const lens = $derived(openLens());
	$effect(() => scene?.setLens(lens));
	/** Sick share across the shown level (or every level in the stacked view). */
	const sickTotals = $derived(
		lens === 'sickness' ? sicknessTotals(overview ? allFloors() : [floor]) : null
	);
	const selectedSickness = $derived(
		lens === 'sickness' && selected?.kind === 'block' && selectedSim
			? selectedSim.sickness[selected.room.id]
			: null
	);

	onMount(() => {
		const s = createHollowMap(container, {
			onHover: (p) => {
				if (overview) hoverStackLevel(p?.level ?? null);
				const r = overview || (p && p.level !== levelIndex) ? null : (p?.room ?? null);
				if (r !== hover) {
					hover = r;
					s.setHover(r);
				}
			},
			onClick: onPick,
			onTransition: (active) => (switching = active),
			onView: (v) => {
				distance = v.distance;
				heading = v.heading;
			}
		});
		scene = s;
		registerMapNav({ goTo, setOverview });
		s.showFloor(hollow.floor(0), 0);
		s.fitBounds(...floorBounds(hollow.floor(0)));
		// Open on the all-levels stack.
		setOverview(true);

		const unbindKeys = bindMapKeys(section, LEVELS.length, {
			pan: (x, y) => s.setPan(x, y),
			step: (d) => goTo(levelIndex + d),
			goTo,
			zoom: (f) => s.zoomBy(f),
			north: () => s.resetNorth(),
			fit: fitView,
			toggleOverview: () => setOverview(!overview),
			escape: () => {
				if (selected) select(null);
				else if (overview) setOverview(false);
			}
		});
		return () => {
			unbindKeys();
			clearTimeout(leaveTimer);
			registerMapNav(null);
			s.dispose();
			scene = undefined;
		};
	});
</script>

<section
	bind:this={section}
	class="relative isolate h-full min-w-0 flex-1 overflow-hidden bg-background select-none"
	aria-label="Map"
>
	<div
		bind:this={container}
		class={cn('absolute inset-0', hover || hoverLevel !== null ? 'cursor-pointer' : 'cursor-grab')}
		role="img"
		aria-label={overview ? 'All levels of the Hollow' : `Map of ${level.name}, level ${level.code}`}
	></div>

	<!-- Map markers -->
	<div
		class={cn(
			'pointer-events-none absolute inset-0 z-0 overflow-hidden transition-opacity',
			switching ? 'opacity-0 duration-100' : 'opacity-100 duration-200'
		)}
	>
		{#each pins as p (p.key)}
			<div bind:this={pinEls[p.key]} class="absolute top-0 left-0" style="visibility:hidden">
				{#if p.kind === 'level'}
					{@const l = LEVELS[p.level]}
					<!-- Only the hovered level's tag shows; the rest stay reachable by keyboard. -->
					<Button
						variant="outline"
						size="sm"
						class={cn(
							'absolute -translate-y-1/2 rounded-full transition-opacity duration-150 focus-visible:pointer-events-auto focus-visible:opacity-100',
							hoverLevel === p.level ? 'pointer-events-auto opacity-100' : 'opacity-0'
						)}
						onclick={() => goTo(p.level)}
						onpointerenter={() => (tagHoverLevel = p.level)}
						onpointerleave={() => (tagHoverLevel = null)}
						onfocus={() => (tagHoverLevel = p.level)}
						onblur={() => (tagHoverLevel = null)}
					>
						<span class="font-semibold text-primary">{l.code}</span>
						{l.name}
						<span class="text-muted-foreground tabular-nums">{formatDepth(l.depth)}</span>
					</Button>
				{:else}
					<button
						class="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
						onclick={() => p.place && focusPlace(p.place)}
						aria-label={p.label}
					>
						<span class="relative">
							<PlaceIcon kind={p.kind} color={p.color} size={p.kind === 'shaft' ? 28 : 24} />
							{#if p.status}
								<span
									class="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background"
									style="background:{STATUS_INFO[p.status].color}"
									title={STATUS_INFO[p.status].label}
								></span>
							{/if}
						</span>
						{#if showNames || p.kind === 'shaft'}
							<span
								class="mt-0.5 text-xs font-semibold whitespace-nowrap text-foreground [text-shadow:0_0_3px_var(--background),0_0_6px_var(--background)]"
								>{p.label}</span
							>
						{/if}
					</button>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Layer switcher (small screens; the sidebar's depth gauge does this on wider ones) -->
	<div class="absolute inset-x-4 top-4 z-10 md:hidden">
		<ToggleGroup.Root
			type="single"
			variant="outline"
			class="w-full bg-background/90 backdrop-blur"
			aria-label="Map level"
			bind:value={() => layerValue, selectLayer}
		>
			<ToggleGroup.Item class="flex-1" value="all" aria-label="All levels">All</ToggleGroup.Item>
			{#each LEVELS as l (l.code)}
				<ToggleGroup.Item
					class="flex-1"
					value={l.code}
					aria-label="{l.name}, {formatDepth(l.depth)}">{l.code}</ToggleGroup.Item
				>
			{/each}
		</ToggleGroup.Root>
	</div>

	{#if sickTotals}
		<div
			class="absolute top-16 left-4 z-10 flex w-56 flex-col gap-1.5 rounded-lg border bg-background/90 p-3 text-xs backdrop-blur md:top-4"
		>
			<div class="flex items-center justify-between">
				<span class="font-semibold">Lung sickness</span>
				<span class="text-muted-foreground">{overview ? 'All levels' : level.code}</span>
			</div>
			<SicknessScale />
			<p class="text-muted-foreground">
				<span class="font-semibold text-foreground tabular-nums"
					>{formatPercent(sickTotals.share)}</span
				>
				of {formatCount(sickTotals.reported)} reported residents sick
			</p>
		</div>
	{/if}

	<!-- Map controls -->
	<div class="absolute right-4 bottom-4 z-10 flex flex-col items-end gap-2">
		<Button
			variant="outline"
			size="icon"
			onclick={fitView}
			aria-label={overview ? 'Show all levels' : 'Show whole level'}
		>
			<ScanIcon />
		</Button>
		<Button
			variant="outline"
			size="icon"
			onclick={() => scene?.resetNorth()}
			aria-label="Reset to north"
		>
			<svg viewBox="0 0 24 24" style="transform:rotate({heading}deg)" aria-hidden="true">
				<path d="M12 2l4 10h-8z" fill="var(--destructive)" />
				<path d="M12 22l-4-10h8z" fill="currentColor" />
			</svg>
		</Button>
		<ButtonGroup.Root orientation="vertical" aria-label="Zoom">
			<Button
				variant="outline"
				size="icon"
				onclick={() => scene?.zoomBy(ZOOM_STEP)}
				aria-label="Zoom in"
			>
				<PlusIcon />
			</Button>
			<Button
				variant="outline"
				size="icon"
				onclick={() => scene?.zoomBy(1 / ZOOM_STEP)}
				aria-label="Zoom out"
			>
				<MinusIcon />
			</Button>
		</ButtonGroup.Root>
	</div>

	{#if selected}
		<PlaceCard
			class="absolute bottom-4 left-4 z-20"
			place={selected}
			sim={simulateFloor(hollow.floor(selected.floor))}
			color={placeColor(selected)}
			{impact}
			sickness={selectedSickness}
			onclose={() => select(null)}
		/>
	{:else}
		<ul
			class="pointer-events-none absolute bottom-4 left-4 hidden items-center gap-x-4 text-[11px] text-muted-foreground xl:flex"
			aria-label="Map controls"
		>
			{#each KEY_HINTS as [keys, action] (action)}
				<li class="flex items-center gap-1.5">
					{#each keys as k (k)}
						<kbd
							class="rounded border border-border bg-background/80 px-1.5 py-px font-sans text-[10px] text-foreground"
							>{k}</kbd
						>
					{/each}
					{action}
				</li>
			{/each}
		</ul>
	{/if}
</section>
