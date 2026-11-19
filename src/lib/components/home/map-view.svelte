<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { Room } from '#lib/tunnels/generate.js';
	import { LEVELS } from '#lib/hollow/data.js';
	import { formatCount, formatDepth, formatPercent } from '#lib/hollow/format.js';
	import { placeCentre, placeColor, type Place, type PlaceKind } from '#lib/hollow/nav.js';
	import { createHollowMap, type HollowMap, type Pick } from '#lib/hollow/hollowMap.js';
	import {
		blockedTotals,
		getHollow,
		pointTotals,
		sicknessTotals,
		simulateFloor
	} from '#lib/hollow/simulation.js';
	import { POINT_INFO, type BlockedTunnel } from '#lib/hollow/state.js';
	import { TUNNEL_H } from '#lib/hollow/mapStyle.js';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import { connectLive, live } from '#lib/live/state.svelte.js';
	import { floorBounds, type Floor } from '#lib/hollow/world.js';
	import SicknessScale from './sickness-scale.svelte';
	import StateLegend from './state-legend.svelte';
	import TunnelLegend from './tunnel-legend.svelte';
	import { home, openLens, registerMapNav, setAddress } from './home-state.svelte.js';
	import { placeByKey } from './address.js';
	import HouseIcon from '@lucide/svelte/icons/house';
	import { bindMapKeys, KEY_HINTS, ZOOM_STEP } from './map-keys.js';
	import { cn } from '#lib/utils.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as ButtonGroup from '#lib/components/ui/button-group/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import PlaceCard from './place-card.svelte';
	import HomeNotices from './home-notices.svelte';
	import PlaceIcon from './place-icon.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import ScanIcon from '@lucide/svelte/icons/scan';

	// The state (power, water and air points, tunnels, sickness) comes live from Convex.
	connectLive();
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
	// Mirror the view into shared state for the sidebar.
	$effect(() => {
		home.level = levelIndex;
		home.overview = overview;
	});
	const floor = $derived(hollow.floor(levelIndex));
	const sim = $derived.by(() => {
		void live.version;
		return simulateFloor(floor);
	});
	/** The simulation of the selected place's floor. */
	const selectedSim = $derived.by(() => {
		void live.version;
		return selected ? simulateFloor(hollow.floor(selected.floor)) : null;
	});
	// Repaint the map whenever the state behind it changes.
	$effect(() => {
		void live.version;
		scene?.refreshLens();
	});

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

	function focus(level: number, x: number, y: number) {
		goTo(level);
		select(null);
		// Close enough to read the blocks, far enough to see the area around them.
		scene?.flyTo(x, y, { distance: Math.min(Math.max(distance, 120), 170) });
	}

	function onPick(pick: Pick | null) {
		if (overview) {
			if (pick) goTo(pick.level);
			return;
		}
		// Mid-transition the scene can still show another level; ignore picks that landed there.
		if (pick && pick.level !== levelIndex) return;
		const p = placeOf(floor, pick?.room ?? null);
		if (home.pickingHome) {
			pickMiss = !!p && p.kind !== 'block';
			if (p?.kind === 'block') setAddress(p.key);
			else return;
		}
		select(p);
	}

	// ── Home address ─────────────────────────────────────────────────────────
	/** Set when a pick for the home landed on something other than a habitation block. */
	let pickMiss = $state(false);
	$effect(() => {
		if (!home.pickingHome) pickMiss = false;
	});
	const homePlace = $derived(placeByKey(home.address));

	// ── Pins (HTML markers pinned to the 3D scene) ───────────────────────────
	interface PinSpec {
		key: string;
		x: number;
		y: number;
		h: number;
		kind: PlaceKind | 'level' | 'home' | 'blocked';
		level: number;
		label: string;
		color: string;
		place?: Place;
		blocked?: BlockedTunnel;
	}
	/** Pin height above the floor, by kind: over the roof of its building. */
	const pinHeight = (kind: PlaceKind) => (kind === 'shaft' ? 7.5 : kind === 'plant' ? 4.5 : 3.5);
	/** The saved home's pin; it shows on its own level and in the all-levels view. */
	const homePin = $derived<PinSpec | null>(
		homePlace && (overview || homePlace.floor === levelIndex)
			? {
					key: 'home',
					...placeCentre(homePlace),
					h: 4,
					level: homePlace.floor,
					kind: 'home',
					label: 'Home',
					color: 'var(--primary)',
					place: homePlace
				}
			: null
	);
	/**
	 * Tunnels lens: a pulsing red dot on each blocked tunnel, on the shown level or on
	 * every level in the all-levels view. It sits on the stretch's middle tile.
	 */
	const blockedPins = $derived.by<PinSpec[]>(() => {
		if (lens !== 'tunnels') return [];
		void live.version;
		return (overview ? allFloors() : [floor]).flatMap((f) =>
			simulateFloor(f)
				.local.blockedTunnels.filter((e) => e.tiles.length)
				.map((e): PinSpec => {
					const mid = e.tiles[Math.floor(e.tiles.length / 2)];
					return {
						key: `blocked-${e.id}`,
						x: mid.x + 0.5,
						y: mid.y + 0.5,
						h: TUNNEL_H + 0.2,
						level: f.index,
						kind: 'blocked',
						label: e.reason,
						color: 'var(--map-tunnels-blocked)',
						blocked: e
					};
				})
		);
	});
	const pins = $derived.by<PinSpec[]>(() => {
		const homePins = homePin ? [homePin] : [];
		if (overview) {
			return LEVELS.map((l): PinSpec => {
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
			}).concat(blockedPins, homePins);
		}
		return sim.places
			.filter((p) => p.kind !== 'block')
			.map((p): PinSpec => ({
				key: p.key,
				...placeCentre(p),
				h: pinHeight(p.kind),
				level: levelIndex,
				kind: p.kind,
				label: p.label,
				color: placeColor(p),
				place: p
			}))
			.concat(blockedPins, homePins);
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

	// ── Data lens (driven by the open sidebar section) ──────────────────────
	const lens = $derived(openLens());
	$effect(() => scene?.setLens(lens));
	/** The open point lens's kind (power, water, air), if any. */
	const pointKind = $derived(lens === 'power' || lens === 'water' || lens === 'air' ? lens : null);
	/** Sick share across the shown level (or every level in the stacked view). */
	const sickTotals = $derived.by(() => {
		void live.version;
		return lens === 'sickness' ? sicknessTotals(overview ? allFloors() : [floor]) : null;
	});
	/** Headline numbers for the power, water, air and tunnels lenses. */
	const pointNow = $derived.by(() => {
		void live.version;
		return pointKind ? pointTotals(overview ? allFloors() : [floor], pointKind) : null;
	});
	const blockedNow = $derived.by(() => {
		void live.version;
		return lens === 'tunnels' ? blockedTotals(overview ? allFloors() : [floor]) : null;
	});
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
		registerMapNav({
			goTo,
			setOverview,
			focusPlace,
			focus
		});
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
				if (home.pickingHome) home.pickingHome = false;
				else if (selected) select(null);
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

<div class="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
	<!-- Level bar -->
	<header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
		<div class="flex min-w-0 flex-col">
			<h1 class="truncate text-sm font-semibold">
				{overview ? 'All levels' : `${level.code} ${level.name}`}
			</h1>
			<p class="text-[11px] text-muted-foreground">
				{overview
					? `${LEVELS.length} levels, stacked at depth`
					: `${formatDepth(level.depth)} below the surface`} · all data fictional
			</p>
		</div>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			class="ml-auto"
			aria-label="Map level"
			bind:value={() => layerValue, selectLayer}
		>
			<ToggleGroup.Item value="all" aria-label="All levels" title="All levels" class="gap-1">
				<LayersIcon class="size-3.5" />
				All
			</ToggleGroup.Item>
			{#each LEVELS as l (l.code)}
				<ToggleGroup.Item
					value={l.code}
					aria-label="{l.name}, {formatDepth(l.depth)}"
					title="{l.name} · {formatDepth(l.depth)}">{l.code}</ToggleGroup.Item
				>
			{/each}
		</ToggleGroup.Root>
	</header>

	<section
		bind:this={section}
		class="relative isolate min-h-0 flex-1 overflow-hidden bg-background select-none"
		aria-label="Map"
	>
		<div
			bind:this={container}
			class={cn(
				'absolute inset-0',
				home.pickingHome && !overview
					? 'cursor-crosshair'
					: hover || hoverLevel !== null
						? 'cursor-pointer'
						: 'cursor-grab'
			)}
			role="img"
			aria-label={overview
				? 'All levels of the Hollow'
				: `Map of ${level.name}, level ${level.code}`}
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
					{:else if p.kind === 'home'}
						{@const place = p.place!}
						<button
							class="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-full flex-col items-center"
							onclick={() => focusPlace(place)}
							aria-label="My home: {place.label}"
						>
							<span
								class="grid size-7 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-lg"
							>
								<HouseIcon class="size-3.5" />
							</span>
							<span class="-mt-1 size-2 rotate-45 bg-primary" aria-hidden="true"></span>
							{#if showNames || overview}
								<span
									class="mt-0.5 text-xs font-semibold whitespace-nowrap text-foreground [text-shadow:0_0_3px_var(--background),0_0_6px_var(--background)]"
									>Home · {overview
										? LEVELS[place.floor].code
										: place.label.replace('Block ', '')}</span
								>
							{/if}
						</button>
					{:else if p.kind === 'blocked'}
						{@const b = p.blocked!}
						<button
							class="pointer-events-auto absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center"
							onclick={() => focus(b.level, p.x, p.y)}
							aria-label="Blocked tunnel on {LEVELS[b.level].code}: {b.reason}"
							title="Blocked: {b.reason}"
						>
							<span
								class="absolute inset-0 animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-(--map-tunnels-blocked) opacity-75"
							></span>
							<span
								class="relative size-3 rounded-full border border-[color-mix(in_oklch,var(--map-tunnels-blocked)_50%,black)] bg-(--map-tunnels-blocked) shadow-[0_0_8px_var(--map-tunnels-blocked)]"
							></span>
						</button>
					{:else if p.place}
						{@const place = p.place}
						<button
							class="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
							onclick={() => focusPlace(place)}
							aria-label={p.label}
						>
							<PlaceIcon
								kind={place.kind}
								color={p.color}
								size={place.kind === 'shaft' ? 28 : 24}
							/>
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

		{#if home.pickingHome}
			<div
				class="alert-in absolute top-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-primary/50 bg-background/95 py-1.5 pr-1.5 pl-3 text-sm shadow-lg backdrop-blur"
				role="status"
			>
				<HouseIcon class="size-4 text-primary" />
				<span>
					{#if overview}Choose a level, then click your block
					{:else if pickMiss}That isn't a home. Click a habitation block
					{:else}Click your block on the map to set it as your home{/if}
				</span>
				<Button size="sm" variant="ghost" onclick={() => (home.pickingHome = false)}>Cancel</Button>
			</div>
		{/if}

		{#snippet lensPanel(title: string, body: Snippet)}
			<div
				class="absolute top-4 left-4 z-10 flex w-56 flex-col gap-1.5 rounded-lg border bg-background/90 p-3 text-xs backdrop-blur"
			>
				<div class="flex items-center justify-between">
					<span class="font-semibold">{title}</span>
					<span class="text-muted-foreground">{overview ? 'All levels' : level.code}</span>
				</div>
				{@render body()}
			</div>
		{/snippet}

		{#if sickTotals}
			{#snippet sickBody()}
				<SicknessScale />
				<p class="text-muted-foreground">
					<span class="font-semibold text-foreground tabular-nums"
						>{formatPercent(sickTotals!.share)}</span
					>
					of {formatCount(sickTotals!.reported)} reported residents sick
				</p>
			{/snippet}
			{@render lensPanel('Lung sickness', sickBody)}
		{:else if pointNow && pointKind}
			{@const info = POINT_INFO[pointKind]}
			{#snippet pointBody()}
				<StateLegend kind={pointKind!} />
				<p class="text-muted-foreground">
					{#if pointNow!.bad}
						<span class="font-semibold text-foreground tabular-nums"
							>{formatPercent(pointNow!.share)}</span
						>
						of {formatCount(pointNow!.residents)} residents with {info.bad.toLowerCase()}
					{:else}
						{info.good} everywhere
					{/if}
				</p>
			{/snippet}
			{@render lensPanel(info.label, pointBody)}
		{:else if blockedNow}
			{#snippet tunnelBody()}
				<TunnelLegend class="text-muted-foreground" />
				<p class="text-muted-foreground">
					{#if blockedNow!.count}
						<span class="font-semibold text-foreground tabular-nums">{blockedNow!.count}</span>
						blocked tunnel{blockedNow!.count === 1 ? '' : 's'} ·
						<span class="tabular-nums">{blockedNow!.tiles}</span> tiles closed
					{:else}
						No blocked tunnels
					{/if}
				</p>
			{/snippet}
			{@render lensPanel('Tunnels', tunnelBody)}
		{/if}

		<!-- Notifications for the saved home -->
		<HomeNotices class="absolute top-4 right-4 z-20" />

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
				sim={selectedSim!}
				color={placeColor(selected)}
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
</div>
