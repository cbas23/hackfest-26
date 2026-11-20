<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import type { Room } from '#lib/tunnels/generate.js';
	import { LEVELS, SHAFTS, SHAFT_COLORS } from '#lib/hollow/data.js';
	import { routeOverlay, type RouteDraw } from '#lib/hollow/scene/route.js';
	import { directions } from './directions.svelte.js';
	import RouteIcon from '@lucide/svelte/icons/route';
	import SirenIcon from '@lucide/svelte/icons/siren';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import EscapeHud from './escape-hud.svelte';
	import { formatCount, formatDepth, formatPercent } from '#lib/hollow/format.js';
	import {
		placeCentre,
		placeColor,
		type Place,
		type PlaceKind,
		type Route
	} from '#lib/hollow/nav.js';
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
	import StepScale from './step-scale.svelte';
	import { CONDITION_STEPS } from '#lib/hollow/conditions.js';
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
	import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
	import { MediaQuery } from 'svelte/reactivity';

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
	/** Touch screens get "tap" instead of "click" in the prompts. */
	const coarse = new MediaQuery('pointer: coarse');
	const Click = $derived(coarse.current ? 'Tap' : 'Click');
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
		if (directions.picking) {
			if (!p) return;
			directions.set(directions.picking, p);
		} else if (home.pickingHome) {
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

	// ── Directions ───────────────────────────────────────────────────────────
	const route = $derived(directions.route);

	/** Go to a level and frame the route's leg on it (its first leg if it doesn't touch it). */
	function showRoute(level: number) {
		if (!route) return;
		const leg = route.legs.find((l) => l.floor === level) ?? route.legs[0];
		goTo(leg.floor);
		const xs = leg.path.map((p) => p.x);
		const ys = leg.path.map((p) => p.y);
		scene?.fitBounds(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
	}

	// ── Escape playback: the route draws itself leg by leg, the camera following it ──
	/** While an escape plays: the leg being drawn and how many of its tiles are drawn. */
	let reveal = $state<{ leg: number; tiles: number } | null>(null);
	/** True once the escape route has reached the safe block (until it replays or ends). */
	let arrived = $state(false);
	/** What the playback is doing, for the escape card. */
	let playStatus = $state<string | null>(null);
	/** Bumped to cancel a running playback. */
	let playback = 0;

	const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

	async function playEscape(r: Route) {
		const run = ++playback;
		const stale = () => run !== playback;
		arrived = false;
		select(null);
		for (let i = 0; i < r.legs.length; i++) {
			const leg = r.legs[i];
			playStatus = i === 0 ? 'Leaving home…' : `Arriving on ${LEVELS[leg.floor].code}…`;
			reveal = { leg: i, tiles: 1 };
			showRoute(leg.floor);
			// Let the camera settle on the leg before drawing it.
			await wait(i === 0 ? 700 : 1000);
			if (stale()) return;
			playStatus = 'Following the tunnels…';
			const ms = Math.min(3200, Math.max(1400, leg.path.length * 22));
			const t0 = performance.now();
			let drawnAt = 0;
			for (;;) {
				const now = await nextFrame();
				if (stale()) return;
				const k = Math.min(1, (now - t0) / ms);
				const tiles = Math.max(1, Math.ceil((1 - (1 - k) ** 2) * leg.path.length));
				// Redrawing the route is not free: at most every 40 ms, plus the last tile.
				if (k >= 1 || now - drawnAt > 40) {
					drawnAt = now;
					reveal = { leg: i, tiles };
				}
				if (k >= 1) break;
			}
			const ride = r.rides[i];
			if (ride) {
				const to = LEVELS[ride.to];
				playStatus = `${ride.to > ride.from ? '▼' : '▲'} ${SHAFTS[ride.shaft].name} to ${to.code} ${to.name}`;
				await wait(900);
				if (stale()) return;
			}
		}
		reveal = null;
		playStatus = null;
		arrived = true;
	}

	function stopEscape() {
		playback++;
		reveal = null;
		playStatus = null;
		arrived = false;
	}

	// Play each new escape; anything else (editing the route, closing it) stops the playback.
	$effect(() => {
		const run = directions.escapeRun;
		const on = directions.escaping;
		untrack(() => {
			if (on && run && route) playEscape(route);
			else stopEscape();
		});
	});

	/** The route as drawn: whole, or only as far as the escape playback has got. */
	const drawn = $derived.by<RouteDraw | null>(() => {
		if (!route) return null;
		const legs = route.legs.map((l) => ({ level: l.floor, path: l.path }));
		const rides = route.rides.map((r) => {
			const g = hollow.floor(r.from).shaftGates[r.shaft];
			return { x: g.x + g.w / 2, y: g.y + g.h / 2, from: r.from, to: r.to };
		});
		if (!reveal) return { legs, rides };
		const { leg, tiles } = reveal;
		const current = legs[leg];
		return {
			legs: [
				...legs.slice(0, leg),
				...(tiles > 1 ? [{ ...current, path: current.path.slice(0, tiles) }] : [])
			],
			rides: rides.slice(0, leg)
		};
	});
	// Push the route into the scene; it shows the legs for whatever is on screen.
	$effect(() => {
		if (!scene) return;
		routeOverlay(scene).set(drawn);
		// Directions mode: blue tunnels as soon as the planner opens, not only once there is a
		// route (the overlay above only tints them while it draws one).
		scene.hooks.setTunnelDim(directions.open || !!route);
	});

	// When a new route appears, frame its first leg (an escape frames itself as it plays).
	let framed = '';
	$effect(() => {
		if (!route) {
			framed = '';
			return;
		}
		const key = `${route.from.key}>${route.to.key}>${route.rides.map((r) => r.shaft).join()}`;
		if (key === framed) return;
		framed = key;
		if (!directions.escaping) showRoute(route.from.floor);
	});

	/** Start and destination pins, and a "ride the shaft" chip where each leg ends. */
	const routePins = $derived.by<PinSpec[]>(() => {
		const out: PinSpec[] = [];
		for (const [kind, p] of [
			['from', directions.fromPlace],
			['to', directions.toPlace]
		] as const) {
			if (!p || (!overview && p.floor !== levelIndex)) continue;
			out.push({
				key: `${kind}-${p.key}`,
				...placeCentre(p),
				h: 3,
				level: p.floor,
				kind,
				label: p.label,
				color: kind === 'from' ? 'var(--foreground)' : 'var(--destructive)',
				place: p
			});
		}
		// The head of the escape route while it draws.
		const head = reveal && route ? route.legs[reveal.leg] : null;
		if (head && head.floor === levelIndex && !overview) {
			const t = head.path[reveal!.tiles - 1];
			out.push({
				key: 'runner',
				x: t.x + 0.5,
				y: t.y + 0.5,
				h: TUNNEL_H + 0.3,
				level: levelIndex,
				kind: 'runner',
				label: 'You',
				color: 'var(--primary)'
			});
		}
		if (route && !overview)
			route.legs.forEach((leg, i) => {
				const ride = route.rides[i];
				// While an escape draws, a ride's chip waits until its leg is done.
				if (leg.floor !== levelIndex || !ride || (reveal && i >= reveal.leg)) return;
				const gate = floor.shaftGates[ride.shaft];
				out.push({
					key: `ride-${i}`,
					x: gate.x + gate.w / 2,
					y: gate.y + gate.h / 2,
					h: pinHeight('shaft'),
					level: levelIndex,
					kind: 'ride',
					label: `${ride.to > ride.from ? '▼' : '▲'} ${SHAFTS[ride.shaft].name} to ${LEVELS[ride.to].code}`,
					color: SHAFT_COLORS[SHAFTS[ride.shaft].status],
					toFloor: ride.to
				});
			});
		return out;
	});

	// ── Pins (HTML markers pinned to the 3D scene) ───────────────────────────
	interface PinSpec {
		key: string;
		x: number;
		y: number;
		h: number;
		kind: PlaceKind | 'level' | 'home' | 'blocked' | 'from' | 'to' | 'ride' | 'runner';
		level: number;
		label: string;
		color: string;
		place?: Place;
		blocked?: BlockedTunnel;
		/** Ride chips: the level the shaft ride goes to. */
		toFloor?: number;
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
			}).concat(blockedPins, homePins, routePins);
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
			.concat(blockedPins, homePins, routePins);
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
			focus,
			showRoute
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
				if (directions.picking) directions.picking = null;
				else if (home.pickingHome) home.pickingHome = false;
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
	<header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 sm:px-4 sm:py-2.5">
		<Button
			variant="outline"
			size="icon"
			class="-mr-1 shrink-0 md:hidden"
			aria-label="Open the map panel: your home, directions and data layers"
			title="Your home, directions and data layers"
			onclick={() => (home.panelOpen = true)}
		>
			<PanelLeftOpenIcon />
		</Button>
		<div class="flex min-w-0 flex-1 flex-col md:flex-none">
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
			class="max-sm:w-full sm:ml-auto"
			aria-label="Map level"
			bind:value={() => layerValue, selectLayer}
		>
			<ToggleGroup.Item
				value="all"
				aria-label="All levels"
				title="All levels"
				class="gap-1 max-sm:h-9 max-sm:min-w-0 max-sm:flex-1 max-sm:px-1"
			>
				<LayersIcon class="size-3.5" />
				All
			</ToggleGroup.Item>
			{#each LEVELS as l (l.code)}
				<ToggleGroup.Item
					value={l.code}
					class="max-sm:h-9 max-sm:min-w-0 max-sm:flex-1 max-sm:px-1"
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
				(home.pickingHome || directions.picking) && !overview
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
					{:else if p.kind === 'to' && directions.escaping}
						<!-- The escape's safe block: a pulsing green beacon. -->
						<span
							class="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
							role="img"
							aria-label="Safe block: {p.label}"
						>
							<span class="relative grid size-8 place-items-center">
								<span
									class="absolute inset-0 animate-ping rounded-full bg-emerald-400/70"
									aria-hidden="true"
								></span>
								<span
									class="relative grid size-6 place-items-center rounded-full border-2 border-background bg-emerald-500 text-white shadow-[0_0_16px_var(--color-emerald-400)]"
								>
									<ShieldCheckIcon class="size-3.5" />
								</span>
							</span>
							<span
								class="mt-0.5 rounded-full bg-emerald-500 px-2 py-px text-[10px] font-bold tracking-wider text-white uppercase shadow-lg"
								>Safe</span
							>
						</span>
					{:else if p.kind === 'runner'}
						<span
							class="absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center"
							role="img"
							aria-label="You"
						>
							<span class="absolute inset-0 animate-ping rounded-full bg-primary/60"></span>
							<span
								class="relative size-3 rounded-full border-2 border-background bg-primary shadow-[0_0_12px_var(--primary)]"
							></span>
						</span>
					{:else if p.kind === 'to'}
						<svg
							viewBox="0 0 24 34"
							class="absolute h-9 w-7 -translate-x-1/2 -translate-y-full drop-shadow-lg"
							role="img"
							aria-label="Destination: {p.label}"
						>
							<path
								d="M12 0C5.4 0 0 5.2 0 11.7 0 20.5 12 34 12 34s12-13.5 12-22.3C24 5.2 18.6 0 12 0z"
								fill="var(--destructive)"
							/>
							<circle
								cx="12"
								cy="12"
								r="4.5"
								fill="color-mix(in oklch, var(--destructive) 40%, black)"
							/>
						</svg>
					{:else if p.kind === 'from'}
						<span
							class="absolute block size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-foreground bg-sky-500 shadow-lg"
							role="img"
							aria-label="Start: {p.label}"
						></span>
					{:else if p.kind === 'ride'}
						{@const to = p.toFloor!}
						<Button
							size="xs"
							class="pointer-events-auto absolute -translate-x-1/2 -translate-y-[calc(100%+18px)] rounded-full shadow-lg"
							style="background:{p.color}"
							onclick={() => showRoute(to)}
						>
							{p.label}
						</Button>
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

		<!-- Alarm glow while the home is in danger; a green flash on reaching safety. -->
		{#if arrived}
			<div class="safe-flash pointer-events-none absolute inset-0 z-[5]" aria-hidden="true"></div>
		{:else if directions.danger.length}
			<div
				class={cn(
					'alarm pointer-events-none absolute inset-0 z-[5]',
					directions.escaping && 'opacity-50'
				)}
				aria-hidden="true"
			></div>
		{/if}

		{#if directions.escaping}
			<EscapeHud
				class="absolute top-4 left-1/2 z-30 -translate-x-1/2"
				status={playStatus}
				{arrived}
			/>
		{:else if directions.danger.length && !home.pickingHome && !directions.picking}
			<button
				class="get-out absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border-2 border-white/30 bg-destructive py-2.5 pr-6 pl-3 text-white shadow-2xl transition-transform outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
				onclick={() => directions.escape()}
			>
				<span class="relative grid size-9 place-items-center rounded-full bg-white/20">
					<span class="absolute inset-0 animate-ping rounded-full bg-white/30"></span>
					<SirenIcon class="relative size-5" />
				</span>
				<span class="flex flex-col text-left leading-tight">
					<span class="text-base font-extrabold tracking-wider uppercase">Get to safety</span>
					<span class="text-xs opacity-90">{directions.danger[0].title}</span>
				</span>
			</button>
		{/if}

		{#if directions.picking}
			<div
				class="alert-in absolute top-2 right-2 left-2 z-30 flex items-center gap-3 rounded-xl border border-primary/50 bg-background/95 py-1.5 pr-1.5 pl-3 text-sm shadow-lg backdrop-blur sm:top-4 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:rounded-full"
				role="status"
			>
				<RouteIcon class="size-4 shrink-0 text-primary" />
				<span class="min-w-0 flex-1">
					{overview ? `Choose a level, then ${Click.toLowerCase()}` : Click} a place to set the
					{directions.picking === 'from' ? 'start' : 'destination'}
				</span>
				<Button size="sm" variant="ghost" onclick={() => (directions.picking = null)}>Cancel</Button
				>
			</div>
		{:else if home.pickingHome}
			<div
				class="alert-in absolute top-2 right-2 left-2 z-30 flex items-center gap-3 rounded-xl border border-primary/50 bg-background/95 py-1.5 pr-1.5 pl-3 text-sm shadow-lg backdrop-blur sm:top-4 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:rounded-full"
				role="status"
			>
				<HouseIcon class="size-4 shrink-0 text-primary" />
				<span class="min-w-0 flex-1">
					{#if overview}Choose a level, then {Click.toLowerCase()} your block
					{:else if pickMiss}That isn't a home. {Click} a habitation block
					{:else}{Click} your block on the map to set it as your home{/if}
				</span>
				<Button size="sm" variant="ghost" onclick={() => (home.pickingHome = false)}>Cancel</Button>
			</div>
		{/if}

		{#snippet lensPanel(title: string, body: Snippet)}
			<div
				class={cn(
					'absolute z-10 flex flex-col gap-1.5 rounded-lg border bg-background/90 p-3 text-xs backdrop-blur',
					// Phones: bottom left, clear of the notices above and the controls to the right.
					'bottom-3 left-3 w-[min(14rem,calc(100%-4.75rem))] sm:top-4 sm:bottom-auto sm:left-4 sm:w-56',
					selected && 'max-sm:hidden'
				)}
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
			{@const steps = CONDITION_STEPS[pointKind]}
			{#snippet pointBody()}
				<StepScale {steps} />
				<p class="text-muted-foreground">
					<span class="font-semibold text-foreground tabular-nums"
						>{formatPercent(pointNow!.share)}</span
					>
					of {formatCount(pointNow!.residents)} residents at {steps[3].label.toLowerCase()} or {steps[4].label.toLowerCase()}
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
		<HomeNotices
			class="absolute top-2 right-2 z-20 max-sm:left-2 max-sm:w-auto max-sm:max-w-none sm:top-4 sm:right-4"
		/>

		<!-- Map controls -->
		<div
			class={cn(
				'absolute right-3 bottom-3 z-10 flex flex-col items-end gap-2 sm:right-4 sm:bottom-4',
				selected && 'max-sm:hidden'
			)}
		>
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
				class="absolute inset-x-2 bottom-2 z-20 max-sm:max-h-[65%] max-sm:w-auto sm:right-auto sm:bottom-4 sm:left-4"
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

<style>
	/* A red glow breathing in from the map's edges while the home is in danger. */
	.alarm {
		box-shadow: inset 0 0 90px 10px color-mix(in oklch, var(--destructive) 55%, transparent);
		animation: alarm 1.6s ease-in-out infinite;
	}
	@keyframes alarm {
		50% {
			box-shadow: inset 0 0 40px 0 color-mix(in oklch, var(--destructive) 20%, transparent);
		}
	}
	/* One green flash when the escape route reaches the safe block. */
	.safe-flash {
		animation: safe-flash 2.6s ease-out both;
	}
	@keyframes safe-flash {
		0% {
			box-shadow: inset 0 0 0 0 transparent;
		}
		15% {
			box-shadow: inset 0 0 120px 20px
				color-mix(in oklch, var(--color-emerald-400) 60%, transparent);
		}
		100% {
			box-shadow: inset 0 0 0 0 transparent;
		}
	}
	/* The "Get to safety" button throbs to draw the eye. */
	.get-out {
		animation: get-out 1.6s ease-in-out infinite;
	}
	@keyframes get-out {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in oklch, var(--destructive) 70%, transparent);
		}
		50% {
			box-shadow: 0 0 0 14px transparent;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.alarm,
		.get-out,
		.safe-flash {
			animation: none;
		}
	}
</style>
