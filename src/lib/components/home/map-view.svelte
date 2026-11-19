<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { Room } from '#lib/tunnels/generate.js';
	import { LEVELS } from '#lib/hollow/data.js';
	import { formatCompact, formatCount, formatDepth, formatPercent } from '#lib/hollow/format.js';
	import { placeCentre, placeColor, type Place, type PlaceKind } from '#lib/hollow/nav.js';
	import { createHollowMap, type HollowMap, type Pick } from '#lib/hollow/hollowMap.js';
	import { STATUS_INFO, type Status } from '#lib/hollow/sensors.js';
	import {
		airflowTotals,
		blockedTotals,
		getHollow,
		sicknessTotals,
		simulateFloor,
		waterTotals
	} from '#lib/hollow/simulation.js';
	import { isActive, type BlockedTunnelEvent } from '#lib/hollow/events.js';
	import { TUNNEL_H } from '#lib/hollow/mapStyle.js';
	import { WATER_STEPS } from '#lib/hollow/water.js';
	import { AIR_STEPS } from '#lib/hollow/airflow.js';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import { connectLive, live } from '#lib/live/events.svelte.js';
	import { radarOverlay } from '#lib/hollow/scene/radar.js';
	import { floorBounds, type Floor } from '#lib/hollow/world.js';
	import {
		ALERT_INFO,
		ALERT_KINDS,
		alertTotals,
		type AlertKind,
		type HollowAlert
	} from '#lib/hollow/alerts.js';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import AlertIcon from './alert-icon.svelte';
	import { bestAction, floorState } from '#lib/hollow/response.js';
	import { dispatch, resetResponse, response } from './response-state.svelte.js';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SirenIcon from '@lucide/svelte/icons/siren';
	import SicknessScale from './sickness-scale.svelte';
	import StepScale from './step-scale.svelte';
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

	// Events (blackouts, air, water, tunnels, sickness) come live from Convex.
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
	// Repaint the map whenever the events behind it change.
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
		kind: PlaceKind | 'level' | 'alert' | 'home' | 'blocked';
		level: number;
		label: string;
		color: string;
		place?: Place;
		status?: Status;
		alert?: HollowAlert;
		blocked?: BlockedTunnelEvent;
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
	 * Tunnels lens: a pulsing red dot on each active blocked tunnel, on the shown level or on
	 * every level in the all-levels view. It sits on the stretch's middle tile.
	 */
	const blockedPins = $derived.by<PinSpec[]>(() => {
		if (lens !== 'tunnels') return [];
		void live.version;
		return (overview ? allFloors() : [floor]).flatMap((f) =>
			simulateFloor(f)
				.local.blockedTunnels.filter((e) => isActive(e) && e.tiles.length)
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
		void live.version;
		const floorAlerts = alertMode ? floorState(floor) : null;
		const alertPins: PinSpec[] = floorAlerts
			? floorAlerts.active
					.filter((a) => !home.alertFilter || a.kind === home.alertFilter)
					.map((a) => ({
						key: `alert-${a.id}`,
						x: a.x,
						y: a.y,
						h: 5,
						level: levelIndex,
						kind: 'alert',
						label: a.title,
						color: STATUS_INFO[a.severity].color,
						alert: a
					}))
			: [];
		return sim.places
			.filter((p) => p.kind !== 'block' && !floorAlerts?.sources.has(p.room.id))
			.map((p): PinSpec => ({
				key: p.key,
				...placeCentre(p),
				h: pinHeight(p.kind),
				level: levelIndex,
				kind: p.kind,
				label: p.label,
				color: placeColor(p),
				place: p,
				status: sim.status(p)?.status
			}))
			.concat(alertPins, blockedPins, homePins);
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
	const alertMode = $derived(!!lens?.startsWith('alerts'));
	$effect(() => scene?.setLens(lens));
	/** Sick share across the shown level (or every level in the stacked view). */
	const sickTotals = $derived.by(() => {
		void live.version;
		return lens === 'sickness' ? sicknessTotals(overview ? allFloors() : [floor]) : null;
	});
	/** Headline numbers for the water, airflow and tunnels lenses. */
	const waterNow = $derived.by(() => {
		void live.version;
		return lens === 'water' ? waterTotals(overview ? allFloors() : [floor]) : null;
	});
	const airNow = $derived.by(() => {
		void live.version;
		return lens === 'airflow' ? airflowTotals(overview ? allFloors() : [floor]) : null;
	});
	const blockedNow = $derived.by(() => {
		void live.version;
		return lens === 'tunnels' ? blockedTotals(overview ? allFloors() : [floor]) : null;
	});
	// ── Alerts lens ─────────────────────────────────────────────────────────
	const alertList = $derived.by(() => {
		if (!alertMode) return null;
		const floors = overview ? allFloors() : [floor];
		void live.version;
		return floors.flatMap((f) => floorState(f).active);
	});
	/** Fixes so far across the shown levels, and the next best one. */
	const fixedCount = $derived.by(() => {
		if (!alertMode) return 0;
		void live.version;
		const floors = overview ? allFloors() : [floor];
		return floors.reduce((n, f) => n + floorState(f).fixed.length, 0);
	});
	const next = $derived.by(() => {
		if (!alertMode) return null;
		void live.version;
		return bestAction(overview ? allFloors() : [floor]);
	});
	/** The outcome banner shows for a few seconds after each fix. */
	let banner = $state(false);
	$effect(() => {
		if (!response.last) return;
		banner = true;
		const t = setTimeout(() => (banner = false), 4500);
		return () => clearTimeout(t);
	});
	/** Totals over every kind (the tiles), and over the filtered kind (headline, bar). */
	const allTotals = $derived(alertList ? alertTotals(alertList) : null);
	const shownList = $derived(
		alertList?.filter((a) => !home.alertFilter || a.kind === home.alertFilter) ?? null
	);
	const totals = $derived(shownList ? alertTotals(shownList) : null);
	const toggleFilter = (k: AlertKind) => (home.alertFilter = home.alertFilter === k ? null : k);
	const TILE_LABEL: Record<AlertKind, string> = {
		blackout: 'In the dark',
		air: 'Bad air',
		water: 'Unsafe water'
	};
	const SEVERITIES: Status[] = ['critical', 'high', 'warning'];
	const bySeverity = $derived(
		SEVERITIES.map((s) => ({ s, n: shownList?.filter((a) => a.severity === s).length ?? 0 }))
	);
	const tweenOpts = { duration: 900, easing: cubicOut };
	const countT = new Tween(0, tweenOpts);
	const kindT: Record<AlertKind, Tween<number>> = {
		blackout: new Tween(0, tweenOpts),
		air: new Tween(0, tweenOpts),
		water: new Tween(0, tweenOpts)
	};
	$effect(() => {
		countT.set(totals?.count ?? 0);
		for (const k of ALERT_KINDS) kindT[k].set(allTotals?.residents[k] ?? 0);
	});
	// The worst blocks on the shown level throb in the 3D map.
	$effect(() => {
		if (!alertMode || overview) {
			scene?.setAlertPulse([]);
			return;
		}
		const rooms: { room: Room; color: string }[] = [];
		void live.version;
		for (const a of floorState(floor).active) {
			if (a.severity !== 'critical' || (home.alertFilter && a.kind !== home.alertFilter)) continue;
			const color =
				a.kind === 'blackout' ? STATUS_INFO.critical.color : STATUS_INFO[a.severity].color;
			for (const id of a.blocks) rooms.push({ room: floor.map.rooms[id], color });
		}
		scene?.setAlertPulse(rooms);
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
			focus,
			crew: (at) =>
				radarOverlay(s).set(at ? { ...at, radius: 14, color: STATUS_INFO.normal.color } : null),
			refresh: () => s.refreshLens()
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
					{:else if p.alert}
						{@const a = p.alert}
						{@const busy = response.working === a.id}
						<button
							class="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
							onclick={() => focus(a.floor, a.x, a.y)}
							aria-label="{a.title}: {a.where}"
						>
							<span class="relative grid size-8 place-items-center">
								{#if a.kind === 'water' && a.severity !== 'warning'}
									{#each [0, 0.7, 1.4] as delay (delay)}
										<span
											class="alert-ripple absolute inset-0 rounded-full border"
											style="border-color:{ALERT_INFO.water.color};animation-delay:{delay}s"
										></span>
									{/each}
								{:else if a.severity !== 'warning'}
									<span
										class="alert-ring absolute inset-0 rounded-full border-2"
										style="border-color:{p.color}"
									></span>
									<span
										class="alert-ring absolute inset-0 rounded-full border-2"
										style="border-color:{p.color};animation-delay:0.7s"
									></span>
								{/if}
								<span
									class="relative grid size-7 place-items-center rounded-full border-2 border-background text-white shadow-lg transition-colors"
									style="background:{busy
										? STATUS_INFO.normal.color
										: p.color};box-shadow:0 0 14px {busy ? STATUS_INFO.normal.color : p.color}"
								>
									{#if busy}<WrenchIcon class="size-3.5 animate-spin" />{:else}<AlertIcon
											kind={a.kind}
										/>{/if}
								</span>
							</span>
							{#if showNames}
								<span
									class="mt-0.5 rounded px-1 text-[10px] font-bold tracking-wide whitespace-nowrap uppercase"
									style="color:{p.color};text-shadow:0 0 3px var(--background),0 0 6px var(--background)"
									>{a.title}</span
								>
							{/if}
						</button>
					{:else if p.place}
						{@const place = p.place}
						<button
							class="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
							onclick={() => focusPlace(place)}
							aria-label={p.label}
						>
							<span class="relative">
								<PlaceIcon
									kind={place.kind}
									color={p.color}
									size={place.kind === 'shaft' ? 28 : 24}
								/>
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

		{#if totals && totals.critical > 0}
			<div
				class="alert-vignette pointer-events-none absolute inset-0 z-[5]"
				aria-hidden="true"
			></div>
		{/if}

		{#if totals}
			<div
				class="alert-in absolute top-4 left-4 z-10 flex w-64 flex-col gap-2.5 overflow-hidden rounded-lg border border-destructive/40 bg-background/90 p-3 text-xs shadow-[0_0_30px_-8px_var(--destructive)] backdrop-blur"
				role="status"
			>
				<div class="flex items-center justify-between">
					<span class="flex items-center gap-2 font-semibold tracking-wide uppercase">
						<SirenIcon class="alert-blink size-4 text-destructive" aria-hidden="true" />
						Alerts
					</span>
					<span class="flex items-center gap-1.5 text-muted-foreground">
						<span class="relative flex size-2">
							<span class="absolute inset-0 animate-ping rounded-full bg-destructive opacity-75"
							></span>
							<span class="relative size-2 rounded-full bg-destructive"></span>
						</span>
						LIVE · {overview ? 'All levels' : level.code}
					</span>
				</div>
				<div class="flex items-baseline gap-2">
					<span class="text-3xl font-bold text-foreground tabular-nums"
						>{Math.round(countT.current)}</span
					>
					<span class="text-muted-foreground"
						>active · <span class="font-semibold text-destructive">{totals.critical} critical</span
						></span
					>
				</div>
				<div class="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
					{#each bySeverity as { s, n } (s)}
						{#if n}
							<span
								class="h-full transition-[flex-grow] duration-700"
								style="flex-grow:{n};background:{STATUS_INFO[s].color}"
								title="{n} {STATUS_INFO[s].label}"
							></span>
						{/if}
					{/each}
				</div>
				<div class="grid grid-cols-3 gap-1.5" role="group" aria-label="Filter alerts">
					{#each ALERT_KINDS as k (k)}
						{@const on = home.alertFilter === k}
						{@const dim = home.alertFilter && !on}
						<button
							type="button"
							aria-pressed={on}
							onclick={() => toggleFilter(k)}
							class={cn(
								'flex flex-col gap-0.5 rounded-md border bg-card/60 p-1.5 text-left transition-all outline-none hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring',
								dim && 'opacity-45'
							)}
							style="border-color:{on ? ALERT_INFO[k].color : 'var(--border)'};{on
								? `box-shadow:0 0 14px -4px ${ALERT_INFO[k].color}`
								: ''}"
						>
							<span class="flex items-center gap-1 text-[10px] text-muted-foreground">
								<span style="color:{ALERT_INFO[k].color}"
									><AlertIcon kind={k} class="size-3" /></span
								>
								{TILE_LABEL[k]}
							</span>
							<span class="text-sm font-semibold text-foreground tabular-nums"
								>{formatCompact(kindT[k].current)}</span
							>
							<span class="text-[10px] text-muted-foreground tabular-nums"
								>{allTotals?.counts[k] ?? 0} alerts</span
							>
						</button>
					{/each}
				</div>
				{#if next}
					<!-- The one thing to do now: the fix that helps the most residents. -->
					<div
						class="flex flex-col gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2"
					>
						<span
							class="text-[10px] font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-400"
							>Fix first</span
						>
						<span class="flex items-center gap-1.5 text-foreground">
							<span style="color:{ALERT_INFO[next.alert.kind].color}"
								><AlertIcon kind={next.alert.kind} class="size-3.5" /></span
							>
							<span class="truncate font-medium">{next.verb}</span>
							<span class="truncate text-muted-foreground"
								>· {next.alert.where.split(' · ')[0]}</span
							>
						</span>
						<span class="text-muted-foreground">
							Helps <span class="font-semibold text-foreground tabular-nums"
								>{formatCompact(next.residents)}</span
							>
							{#if next.clears.length > 1}
								· clears <span class="font-semibold text-foreground">{next.clears.length}</span> alerts
							{/if}
						</span>
						<Button
							size="sm"
							class="h-7 bg-emerald-600 text-white hover:bg-emerald-500"
							disabled={!!response.working}
							onclick={() => dispatch(next)}
						>
							{#if response.working}<WrenchIcon class="animate-spin" /> Crew working…{:else}<WrenchIcon
								/> Dispatch crew{/if}
						</Button>
					</div>
				{:else}
					<div
						class="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400"
					>
						<CircleCheckIcon class="size-4" /> All clear here
					</div>
				{/if}
				<div class="flex items-center justify-between text-[10px] text-muted-foreground">
					<span>Tap a tile to filter · simulated</span>
					{#if fixedCount}
						<button
							type="button"
							class="flex items-center gap-1 hover:text-foreground"
							onclick={resetResponse}
							><RotateCcwIcon class="size-3" /> Reset {fixedCount} fixed</button
						>
					{/if}
				</div>
			</div>
		{/if}

		{#if alertMode && banner && response.last}
			{#key response.last.id}
				<div
					class="alert-in pointer-events-none absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-emerald-500/50 bg-background/95 py-2 pr-4 pl-2 text-sm shadow-[0_0_30px_-6px_#10b981] backdrop-blur"
					role="status"
				>
					<span class="grid size-7 place-items-center rounded-full bg-emerald-500 text-white">
						<CircleCheckIcon class="size-4" />
					</span>
					<span>
						<span class="font-semibold">{response.last.verb}</span>
						<span class="text-muted-foreground">· {response.last.where}</span>
					</span>
					<span class="text-emerald-600 tabular-nums dark:text-emerald-400">
						{response.last.count} alert{response.last.count === 1 ? '' : 's'} cleared · {formatCompact(
							response.last.residents
						)} helped
					</span>
				</div>
			{/key}
		{/if}

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
		{:else if waterNow}
			{#snippet waterBody()}
				<StepScale steps={WATER_STEPS} />
				<p class="text-muted-foreground">
					<span class="font-semibold text-foreground tabular-nums"
						>{formatPercent(waterNow!.share)}</span
					>
					of {formatCount(waterNow!.residents)} residents on unsafe or toxic water
				</p>
			{/snippet}
			{@render lensPanel('Water health', waterBody)}
		{:else if airNow}
			{#snippet airBody()}
				<StepScale steps={AIR_STEPS} />
				<p class="text-muted-foreground">
					<span class="font-semibold text-foreground tabular-nums"
						>{formatPercent(airNow!.share)}</span
					>
					of {formatCount(airNow!.residents)} residents in still or weak air
				</p>
			{/snippet}
			{@render lensPanel('Air flow', airBody)}
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
</div>
