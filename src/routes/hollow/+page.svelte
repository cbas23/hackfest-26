<script lang="ts">
	import { onMount } from 'svelte';
	import type { Point, Room } from '#lib/tunnels/generate.js';
	import {
		FACILITY_INFO,
		HOLLOW_SEED,
		LEVELS,
		MAX_DEPTH,
		SHAFTS,
		SHAFT_COLORS
	} from '#lib/hollow/data.js';
	import {
		findRoute,
		placesOn,
		type Place,
		type PlaceKind,
		type Route,
		type RouteOptions
	} from '#lib/hollow/nav.js';
	import { createHollowScene, isDrawn, type HollowScene, type Pick } from '#lib/hollow/scene.js';
	import { facilityStatus, STATUS_INFO, type Status } from '#lib/hollow/sensors.js';
	import { assessImpact } from '#lib/hollow/impact.js';
	import { createHollow, type Floor } from '#lib/hollow/world.js';

	const hollow = createHollow(HOLLOW_SEED);
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- cache; `dug` drives reactivity
	const placeCache = new Map<number, Place[]>();
	const placesFor = (f: Floor) => {
		let p = placeCache.get(f.index);
		if (!p) placeCache.set(f.index, (p = placesOn(f)));
		return p;
	};

	let container: HTMLDivElement;
	let scene = $state.raw<HollowScene | undefined>();

	let levelIndex = $state(0);
	/** Floors generated so far (they're dug in the background after load). */
	let dug = $state(1);
	let hover = $state.raw<Room | null>(null);
	let selected = $state.raw<Place | null>(null);
	let showLevel = $state(false);
	let distance = $state(250);
	let heading = $state(0);

	// Directions
	let from = $state.raw<Place | null>(null);
	let to = $state.raw<Place | null>(null);
	let picking = $state<'from' | 'to' | null>(null);
	let options = $state<RouteOptions>({ permit: false, unregistered: false });

	// Search
	let query = $state('');
	let field = $state<'search' | 'from' | 'to' | null>(null);

	const level = $derived(LEVELS[levelIndex]);
	const floor = $derived(hollow.floor(levelIndex));
	const directions = $derived(from !== null || to !== null || picking !== null);

	const route = $derived.by<Route | null | undefined>(() => {
		if (!from || !to) return undefined;
		return findRoute(hollow, from, to, $state.snapshot(options));
	});
	const routeFloors = $derived(new Set(route?.legs.map((l) => l.floor) ?? []));

	const allPlaces = $derived.by(() => {
		void dug;
		return LEVELS.flatMap((_, i) => (hollow.isReady(i) ? placesFor(hollow.floor(i)) : []));
	});

	const KIND_ORDER: Record<PlaceKind, number> = {
		shaft: 0,
		directorate: 1,
		air: 1,
		water: 1,
		clinic: 1,
		market: 1,
		farm: 2,
		plant: 3,
		block: 4
	};
	const results = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!field) return [];
		if (!q) {
			// Suggest this floor's landmarks before anything is typed.
			return placesFor(floor)
				.filter((p) => p.kind !== 'block')
				.slice(0, 7);
		}
		const words = q.split(/\s+/);
		return allPlaces
			.filter((p) => {
				const hay = `${p.label} ${p.sub}`.toLowerCase();
				return words.every((w) => hay.includes(w));
			})
			.sort(
				(a, b) =>
					KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
					Number(b.floor === levelIndex) - Number(a.floor === levelIndex) ||
					a.floor - b.floor
			)
			.slice(0, 8);
	});

	// ── Formatting ───────────────────────────────────────────────────────────
	const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
	const pct = (v: number) => `${Math.round(v * 100)}%`;
	const minutes = (s: number) => Math.max(1, Math.round(s / 60));
	const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
	const population = (millions: number) =>
		millions >= 1000 ? `${(millions / 1000).toFixed(2)} B` : `${millions} M`;
	const KIND_COLOR: Record<PlaceKind, string> = {
		block: '#8b93c7',
		farm: '#2fb3a3',
		plant: '#e3965c',
		shaft: '#38bdf8',
		air: FACILITY_INFO.air.color,
		water: FACILITY_INFO.water.color,
		clinic: FACILITY_INFO.clinic.color,
		market: FACILITY_INFO.market.color,
		directorate: FACILITY_INFO.directorate.color
	};
	const placeColor = (p: Place) =>
		p.kind === 'shaft' ? SHAFT_COLORS[SHAFTS[p.shaft!].status] : KIND_COLOR[p.kind];

	// ── Floors ───────────────────────────────────────────────────────────────
	function goTo(index: number) {
		if (index < 0 || index >= LEVELS.length || index === levelIndex) return;
		const dir = Math.sign(index - levelIndex);
		levelIndex = index;
		hover = null;
		scene?.showFloor(hollow.floor(index), dir);
		scene?.setHover(null);
		scene?.setSelection(selected?.floor === index ? selected.room : null);
	}

	// ── Selection ────────────────────────────────────────────────────────────
	const placeOf = (f: Floor, room: Room | null) =>
		room ? (placesFor(f).find((p) => p.room.id === room.id) ?? null) : null;

	function focusPlace(p: Place, zoom = true) {
		goTo(p.floor);
		selected = p;
		scene?.setSelection(p.room);
		const r = p.room;
		if (zoom) scene?.flyTo(r.x + r.w / 2, r.y + r.h / 2, { distance: Math.min(distance, 70) });
	}

	function choose(p: Place) {
		const target = field;
		field = null;
		query = '';
		if (target === 'from' || target === 'to') {
			if (target === 'from') from = p;
			else to = p;
			if (picking === target) picking = null;
			// Prompt for whichever end is still missing.
			if (!from) picking = 'from';
			else if (!to) picking = 'to';
		}
		focusPlace(p, !(from && to));
	}

	function onPick(pick: Pick | null) {
		field = null;
		const p = placeOf(floor, pick?.room ?? null);
		if (picking && p) {
			if (picking === 'from') from = p;
			else to = p;
			picking = !from ? 'from' : !to ? 'to' : null;
			selected = p;
			scene?.setSelection(p.room);
			return;
		}
		selected = p;
		scene?.setSelection(p?.room ?? null);
	}

	function directionsTo(p: Place) {
		to = p;
		if (!from) picking = 'from';
	}

	function directionsFrom(p: Place) {
		from = p;
		if (!to) picking = 'to';
	}

	function clearDirections() {
		from = null;
		to = null;
		picking = null;
	}

	function swap() {
		[from, to] = [to, from];
	}

	/** Bounding box of the dug area on a floor, in tiles. */
	function cityBounds(f: Floor) {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		f.map.grid.forEach((row, y) =>
			row.forEach((t, x) => {
				if (t === 'void') return;
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
				minY = Math.min(minY, y);
				maxY = Math.max(maxY, y);
			})
		);
		return [minX, minY, maxX, maxY] as const;
	}

	function fitFloor() {
		scene?.fitBounds(...cityBounds(floor));
	}

	/** Frame the route's leg on a floor (the shown one by default), switching to it. */
	function showRoute(r: Route, floorIndex?: number) {
		const leg = r.legs.find((l) => l.floor === (floorIndex ?? levelIndex)) ?? r.legs[0];
		goTo(leg.floor);
		const xs = leg.path.map((p) => p.x);
		const ys = leg.path.map((p) => p.y);
		scene?.fitBounds(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
	}

	// Push route geometry for the visible floor into the scene.
	$effect(() => {
		const paths: Point[][] = route
			? route.legs.filter((l) => l.floor === levelIndex).map((l) => l.path)
			: [];
		scene?.setRoute(paths, null);
	});

	// When a new route appears, frame its first leg.
	let framed = '';
	$effect(() => {
		if (!route) return;
		const key = `${route.from.key}>${route.to.key}>${route.rides.map((r) => r.shaft).join()}`;
		if (key === framed) return;
		framed = key;
		showRoute(route, route.from.floor);
	});

	// ── Pins (HTML markers pinned to the 3D scene) ───────────────────────────
	interface PinSpec {
		key: string;
		x: number;
		y: number;
		h: number;
		kind: PlaceKind | 'from' | 'to' | 'ride';
		label: string;
		color: string;
		place?: Place;
		toFloor?: number;
		/** Worst sensor status, for monitored facilities. */
		status?: Status;
	}
	const pins = $derived.by<PinSpec[]>(() => {
		const out: PinSpec[] = [];
		for (const p of placesFor(floor)) {
			// Landmarks get pins; housing blocks (hundreds per level) don't.
			if (p.kind === 'block' || !isDrawn(floor, p.room)) continue;
			const r = p.room;
			out.push({
				key: p.key,
				x: r.x + r.w / 2,
				y: r.y + r.h / 2,
				h: p.kind === 'shaft' ? 7.5 : p.kind === 'plant' ? 4.5 : 3.5,
				kind: p.kind,
				label: p.label,
				color: placeColor(p),
				place: p,
				status: facilityStatus(p)?.status
			});
		}
		if (route) {
			route.legs.forEach((leg, i) => {
				if (leg.floor !== levelIndex || i === route.legs.length - 1) return;
				const ride = route.rides[i];
				const gate = floor.shaftGates[ride.shaft];
				const down = ride.to > ride.from;
				out.push({
					key: `ride-${i}`,
					x: gate.x + gate.w / 2,
					y: gate.y + gate.h / 2,
					h: 7.5,
					kind: 'ride',
					label: `${down ? '▼' : '▲'} ${SHAFTS[ride.shaft].name} to ${LEVELS[ride.to].code}`,
					color: SHAFT_COLORS[SHAFTS[ride.shaft].status],
					toFloor: ride.to
				});
			});
		}
		for (const [kind, p] of [
			['from', from],
			['to', to]
		] as const) {
			if (!p || p.floor !== levelIndex) continue;
			out.push({
				key: kind,
				x: p.room.x + p.room.w / 2,
				y: p.room.y + p.room.h / 2,
				h: 3,
				kind,
				label: p.label,
				color: kind === 'from' ? '#ffffff' : '#ef4444'
			});
		}
		return out;
	});
	const pinEls = $state<Record<string, HTMLElement>>({});
	$effect(() => {
		scene?.setPins(
			pins.filter((p) => pinEls[p.key]).map((p) => ({ el: pinEls[p.key], x: p.x, y: p.y, h: p.h }))
		);
	});
	const showNames = $derived(distance < 200);

	// ── Impact assessment (selected facility → affected neighborhoods) ──────
	const impact = $derived(selected ? assessImpact(hollow.floor(selected.floor), selected) : null);
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

	// ── Keyboard ─────────────────────────────────────────────────────────────
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- never read by the template
	const held = new Set<string>();
	const PAN_KEYS: Record<string, [number, number]> = {
		arrowleft: [-1, 0],
		a: [-1, 0],
		arrowright: [1, 0],
		d: [1, 0],
		arrowup: [0, -1],
		w: [0, -1],
		arrowdown: [0, 1],
		s: [0, 1]
	};
	function syncPan() {
		let x = 0;
		let y = 0;
		for (const k of held) {
			x += PAN_KEYS[k][0];
			y += PAN_KEYS[k][1];
		}
		scene?.setPan(Math.sign(x), Math.sign(y));
	}
	function onKeyDown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
		const k = e.key.toLowerCase();
		if (k in PAN_KEYS) {
			held.add(k);
			syncPan();
			e.preventDefault();
		} else if (k === 'pagedown' || k === 'e' || k === ']') goTo(levelIndex + 1);
		else if (k === 'pageup' || k === 'q' || k === '[') goTo(levelIndex - 1);
		else if (k >= '1' && k <= String(LEVELS.length)) goTo(+k - 1);
		else if (k === '+' || k === '=') scene?.zoomBy(1.5);
		else if (k === '-' || k === '_') scene?.zoomBy(1 / 1.5);
		else if (k === 'n') scene?.resetNorth();
		else if (k === 'f') fitFloor();
		else if (k === '/') {
			e.preventDefault();
			document.getElementById('hollow-search')?.focus();
		} else if (k === 'escape') {
			if (picking) picking = null;
			else if (selected) {
				selected = null;
				scene?.setSelection(null);
			} else clearDirections();
		} else return;
		if (k.startsWith('page')) e.preventDefault();
	}

	onMount(() => {
		const s = createHollowScene(container, {
			onHover: (p) => {
				const r = p?.room ?? null;
				if (r !== hover) {
					hover = r;
					s.setHover(r);
				}
			},
			onClick: onPick,
			onView: (v) => {
				distance = v.distance;
				heading = v.heading;
			}
		});
		scene = s;
		s.showFloor(hollow.floor(0), 0);
		s.fitBounds(...cityBounds(hollow.floor(0)));

		// Dig the remaining floors in the background so search and routing cover them.
		let timer: ReturnType<typeof setTimeout>;
		const warm = () => {
			const next = LEVELS.findIndex((_, i) => !hollow.isReady(i));
			if (next < 0) return;
			placesFor(hollow.floor(next));
			dug = LEVELS.filter((_, i) => hollow.isReady(i)).length;
			timer = setTimeout(warm, 40);
		};
		timer = setTimeout(warm, 300);

		const onKeyUp = (e: KeyboardEvent) => {
			held.delete(e.key.toLowerCase());
			syncPan();
		};
		const onBlur = () => {
			held.clear();
			syncPan();
		};
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('blur', onBlur);
		return () => {
			clearTimeout(timer);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', onBlur);
			s.dispose();
			scene = undefined;
		};
	});

	const fieldValue = (f: 'search' | 'from' | 'to', p: Place | null) =>
		field === f ? query : (p?.label ?? '');
	const blurLater = () => setTimeout(() => (field = null), 150);
</script>

<svelte:head><title>The Hollow · {level.code} {level.name}</title></svelte:head>

{#snippet kindIcon(kind: string, color: string, size: number)}
	<span
		class="grid shrink-0 place-items-center rounded-full border-2 border-white/90 shadow-md"
		style="width:{size}px;height:{size}px;background:{color}"
	>
		<svg viewBox="0 0 24 24" class="h-[60%] w-[60%] fill-white" aria-hidden="true">
			{#if kind === 'shaft'}
				<path d="M7 3h10v18H7zM12 6l-3 3h6zM12 18l3-3H9z" />
			{:else if kind === 'farm'}
				<path d="M12 2c-3 3-5 6-5 9a5 5 0 0 0 4 4.9V22h2v-6.1A5 5 0 0 0 17 11c0-3-2-6-5-9z" />
			{:else if kind === 'plant'}
				<path d="M13 2 4 14h6l-1 8 9-12h-6z" />
			{:else if kind === 'air'}
				<path
					d="M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0-8c3 0 4 3 2 7-1-1-3-1-4 0-2-4-1-7 2-7zm8.7 15c-1.5 2.6-4.6 2.4-7.1-1.2 1.3-.4 2.3-2.1 2-3.5 4.4.3 6.6 2.1 5.1 4.7zM3.3 17c-1.5-2.6.2-5.2 4.6-5.6-.3 1.4.7 3.1 2 3.5-2.5 3.6-5.1 4.7-6.6 2.1z"
				/>
			{:else if kind === 'water'}
				<path d="M12 2s-6 7-6 12a6 6 0 0 0 12 0c0-5-6-12-6-12z" />
			{:else if kind === 'clinic'}
				<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />
			{:else if kind === 'market'}
				<path d="M4 4h16l-1 5H5zm1 7h14v9h-5v-5h-4v5H5z" />
			{:else if kind === 'directorate'}
				<path d="M12 2 3 6v6c0 5 4 9 9 10 5-1 9-5 9-10V6z" />
			{:else}
				<path d="M4 21V9l8-6 8 6v12h-6v-6h-4v6z" />
			{/if}
		</svg>
	</span>
{/snippet}

{#snippet resultsList()}
	{#if field && (results.length || field !== 'search')}
		<ul
			class="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-xl border border-white/10 bg-[#1f2638] py-1 shadow-2xl"
		>
			{#if field !== 'search'}
				<li>
					<button
						class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-sky-300 hover:bg-white/5"
						onmousedown={() => {
							picking = field === 'from' ? 'from' : 'to';
							field = null;
						}}
					>
						<span class="grid h-7 w-7 place-items-center text-lg">◎</span> Choose on map
					</button>
				</li>
			{/if}
			{#each results as p (p.key)}
				<li>
					<button
						class="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/5"
						onmousedown={() => choose(p)}
					>
						{@render kindIcon(p.kind, placeColor(p), 28)}
						<span class="min-w-0">
							<span class="block truncate text-sm text-slate-100">{p.label}</span>
							<span class="block truncate text-xs text-slate-400">{p.sub}</span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

<div class="fixed inset-0 overflow-hidden bg-[#121726] font-sans text-slate-200 select-none">
	<div
		bind:this={container}
		class="absolute inset-0 {picking ? 'cursor-crosshair' : hover ? 'cursor-pointer' : ''}"
		role="img"
		aria-label="Map of {level.name}, level {level.code} of the Hollow"
	></div>

	<!-- Map markers -->
	<div class="pointer-events-none absolute inset-0 isolate z-0 overflow-hidden">
		{#each pins as p (p.key)}
			<div bind:this={pinEls[p.key]} class="absolute top-0 left-0" style="visibility:hidden">
				{#if p.kind === 'to'}
					<svg
						viewBox="0 0 24 34"
						class="absolute h-9 w-7 -translate-x-1/2 -translate-y-full drop-shadow-lg"
						role="img"
						aria-label="Destination: {p.label}"
					>
						<path
							d="M12 0C5.4 0 0 5.2 0 11.7 0 20.5 12 34 12 34s12-13.5 12-22.3C24 5.2 18.6 0 12 0z"
							fill="#ea4335"
						/>
						<circle cx="12" cy="12" r="4.5" fill="#7a1a12" />
					</svg>
				{:else if p.kind === 'from'}
					<span
						class="absolute block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-sky-500 shadow-lg"
						role="img"
						aria-label="Start: {p.label}"
					></span>
				{:else if p.kind === 'ride'}
					<button
						class="pointer-events-auto absolute -translate-x-1/2 -translate-y-[calc(100%+18px)] rounded-full border border-white/20 bg-[#0f5f73] px-3 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-lg hover:bg-[#13748c]"
						onclick={() => route && showRoute(route, p.toFloor)}
					>
						{p.label}
					</button>
				{:else}
					<button
						class="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
						onclick={() => p.place && focusPlace(p.place)}
						aria-label={p.label}
					>
						<span class="relative">
							{@render kindIcon(p.kind, p.color, p.kind === 'shaft' ? 28 : 24)}
							{#if p.status}
								<span
									class="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#121726]"
									style="background:{STATUS_INFO[p.status].color}"
									title={STATUS_INFO[p.status].label}
								></span>
							{/if}
						</span>
						{#if showNames || p.kind === 'shaft'}
							<span
								class="mt-0.5 text-xs font-semibold whitespace-nowrap text-slate-100 [text-shadow:0_0_3px_#121726,0_0_3px_#121726,0_0_6px_#121726]"
								>{p.label}</span
							>
						{/if}
					</button>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Search / directions -->
	<div class="absolute top-4 left-4 z-20 w-[min(24rem,calc(100vw-5.5rem))]">
		{#if !directions}
			<div class="relative">
				<div
					class="flex items-center gap-2 rounded-full border border-white/10 bg-[#1f2638]/95 py-2 pr-2 pl-4 shadow-xl backdrop-blur"
				>
					<svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0 fill-slate-400" aria-hidden="true">
						<path
							d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"
						/>
					</svg>
					<input
						id="hollow-search"
						class="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-400"
						placeholder="Search the Hollow"
						aria-label="Search places"
						autocomplete="off"
						value={fieldValue('search', null)}
						onfocus={() => {
							field = 'search';
							query = '';
						}}
						oninput={(e) => (query = e.currentTarget.value)}
						onblur={blurLater}
					/>
					<button
						class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-600 text-white hover:bg-sky-500"
						title="Directions"
						aria-label="Directions"
						onclick={() => (picking = 'from')}
					>
						<svg viewBox="0 0 24 24" class="h-5 w-5 fill-current" aria-hidden="true">
							<path
								d="M21.7 11.3l-9-9a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5z"
							/>
						</svg>
					</button>
				</div>
				{@render resultsList()}
			</div>
		{:else}
			<div class="rounded-2xl border border-white/10 bg-[#1f2638]/95 p-3 shadow-xl backdrop-blur">
				<div class="flex items-start gap-2">
					<div class="flex flex-col items-center gap-1 pt-3" aria-hidden="true">
						<span class="h-3 w-3 rounded-full border-2 border-white bg-sky-500"></span>
						<span class="h-6 border-l-2 border-dotted border-slate-500"></span>
						<span class="h-3 w-3 rounded-full bg-red-500"></span>
					</div>
					<div class="flex min-w-0 flex-1 flex-col gap-2">
						{#each [['from', from, 'Choose starting point'], ['to', to, 'Choose destination']] as const as [f, p, placeholder] (f)}
							<div class="relative">
								<input
									class="w-full rounded-lg border bg-[#151b2a] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 {picking ===
									f
										? 'border-sky-500'
										: 'border-white/10 focus:border-sky-500'}"
									placeholder={picking === f ? 'Click a place on the map…' : placeholder}
									aria-label={placeholder}
									autocomplete="off"
									value={fieldValue(f, p)}
									onfocus={() => {
										field = f;
										query = '';
									}}
									oninput={(e) => (query = e.currentTarget.value)}
									onblur={blurLater}
								/>
								{#if field === f}{@render resultsList()}{/if}
							</div>
						{/each}
					</div>
					<div class="flex flex-col gap-1">
						<button
							class="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
							onclick={clearDirections}
							aria-label="Close directions">✕</button
						>
						<button
							class="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
							onclick={swap}
							aria-label="Swap start and destination">⇅</button
						>
					</div>
				</div>
				<div
					class="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-2 text-xs text-slate-400"
				>
					<label class="flex items-center gap-1.5">
						<input type="checkbox" class="accent-sky-500" bind:checked={options.permit} />
						Directorate permit
					</label>
					<label class="flex items-center gap-1.5">
						<input type="checkbox" class="accent-sky-500" bind:checked={options.unregistered} />
						Unmapped routes
					</label>
				</div>
				{#if route}
					<div class="mt-2 rounded-xl bg-[#151b2a] p-3">
						<p class="text-lg font-semibold text-slate-100">
							<span class="text-emerald-400">{minutes(route.seconds)} min</span>
							<span class="text-sm font-normal text-slate-400"
								>· {km(route.walkMeters)} on foot{route.liftMeters
									? ` · ${km(route.liftMeters)} by shaft`
									: ''}</span
							>
						</p>
						<ol class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
							{#each route.legs as leg, i (i)}
								<li>
									<button
										class="rounded-full px-2.5 py-1 font-semibold {leg.floor === levelIndex
											? 'bg-sky-600 text-white'
											: 'bg-white/10 text-slate-200 hover:bg-white/20'}"
										onclick={() => showRoute(route, leg.floor)}>{LEVELS[leg.floor].code}</button
									>
								</li>
								{#if route.rides[i]}
									{@const ride = route.rides[i]}
									{@const c = SHAFT_COLORS[SHAFTS[ride.shaft].status]}
									<li class="text-slate-400" title="{SHAFTS[ride.shaft].status} shaft">
										<span style="color:{c}">{ride.to > ride.from ? '▼' : '▲'}</span>
										{SHAFTS[ride.shaft].name}
									</li>
								{/if}
							{/each}
						</ol>
					</div>
				{:else if route === null}
					<p class="mt-2 rounded-xl bg-[#151b2a] p-3 text-sm text-amber-300">
						No route — every way up needs a permit or an unmapped shaft. Try the options above.
					</p>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Level chip -->
	<div class="absolute top-4 left-1/2 z-10 hidden -translate-x-1/2 lg:block">
		<button
			class="mx-auto flex items-center gap-2 rounded-full border border-white/10 bg-[#1f2638]/95 px-4 py-2 text-sm shadow-xl backdrop-blur hover:bg-[#262e44]"
			aria-expanded={showLevel}
			onclick={() => (showLevel = !showLevel)}
		>
			<span class="font-bold text-sky-300">{level.code}</span>
			<span class="text-slate-100">{level.name}</span>
			<span class="text-slate-400">−{level.depth} m</span>
			<span class="text-slate-500">{showLevel ? '▴' : 'ⓘ'}</span>
		</button>
		{#if showLevel}
			<div
				class="mt-2 w-80 rounded-2xl border border-white/10 bg-[#1f2638]/95 p-4 text-sm shadow-xl backdrop-blur"
			>
				<p class="mb-3 leading-relaxed text-slate-300">{level.description}</p>
				<dl class="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 text-xs">
					<dt class="text-slate-400">Population</dt>
					<dd class="col-span-2 text-slate-100">≈ {population(level.population)}</dd>
					{#each [['Light', level.light, '#fde68a'], ['Air', level.air, '#7dd3fc'], ['Heat', level.heat, '#fb923c'], ['Power', floor.litShare, '#5eead4']] as const as [label, v, c] (label)}
						<dt class="text-slate-400">{label}</dt>
						<dd class="h-1.5 rounded bg-white/10">
							<span class="block h-full rounded" style="width:{pct(v)};background:{c}"></span>
						</dd>
						<dd class="w-9 text-right text-slate-300">{pct(v)}</dd>
					{/each}
				</dl>
			</div>
		{/if}
	</div>

	<!-- Level picker -->
	<nav
		class="absolute top-1/2 right-4 z-10 flex -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1f2638]/95 shadow-xl backdrop-blur"
		aria-label="Levels"
	>
		<span class="px-2 pt-2 pb-1 text-center text-[10px] font-semibold tracking-wider text-slate-500"
			>LEVEL</span
		>
		{#each LEVELS as l (l.code)}
			{@const active = l.index === levelIndex}
			<button
				class="relative px-3 py-2 text-sm font-semibold {active
					? 'bg-sky-600 text-white'
					: 'text-slate-300 hover:bg-white/10'}"
				aria-current={active ? 'true' : undefined}
				title="{l.name} · −{l.depth} m"
				onclick={() => goTo(l.index)}
			>
				{l.code}
				{#if routeFloors.has(l.index) && !active}
					<span class="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
				{/if}
			</button>
		{/each}
		<span class="px-2 pt-1 pb-2 text-center text-[10px] text-slate-500">−{MAX_DEPTH} m</span>
	</nav>

	<!-- Map controls -->
	<div class="absolute right-4 bottom-4 z-10 flex flex-col items-end gap-2">
		<button
			class="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-[#1f2638]/95 text-slate-200 shadow-xl hover:bg-[#262e44]"
			onclick={fitFloor}
			title="Show whole level (F)"
			aria-label="Show whole level"
		>
			<svg viewBox="0 0 24 24" class="h-5 w-5 fill-current" aria-hidden="true">
				<path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zM4 15h2v3h3v2H4zm14 0h2v5h-5v-2h3z" />
			</svg>
		</button>
		<button
			class="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-[#1f2638]/95 shadow-xl hover:bg-[#262e44]"
			onclick={() => scene?.resetNorth()}
			title="Reset to north (N)"
			aria-label="Reset to north"
		>
			<svg
				viewBox="0 0 24 24"
				class="h-6 w-6"
				style="transform:rotate({heading}deg)"
				aria-hidden="true"
			>
				<path d="M12 2l4 10h-8z" fill="#ef4444" />
				<path d="M12 22l-4-10h8z" fill="#cbd5e1" />
			</svg>
		</button>
		<div
			class="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1f2638]/95 shadow-xl"
		>
			<button
				class="h-10 w-10 text-xl text-slate-200 hover:bg-white/10"
				onclick={() => scene?.zoomBy(1.5)}
				aria-label="Zoom in">+</button
			>
			<span class="mx-2 h-px bg-white/10"></span>
			<button
				class="h-10 w-10 text-xl text-slate-200 hover:bg-white/10"
				onclick={() => scene?.zoomBy(1 / 1.5)}
				aria-label="Zoom out">−</button
			>
		</div>
	</div>

	<!-- Place card -->
	{#if selected}
		{@const p = selected}
		{@const pf = hollow.floor(p.floor)}
		{@const sensors = facilityStatus(p)}
		<section
			class="absolute bottom-4 left-4 z-20 max-h-[calc(100vh-6rem)] w-[min(24rem,calc(100vw-5.5rem))] overflow-y-auto rounded-2xl border border-white/10 bg-[#1f2638]/95 p-4 shadow-xl backdrop-blur"
			aria-label={p.label}
		>
			<div class="flex items-start gap-3">
				{@render kindIcon(p.kind, placeColor(p), 36)}
				<div class="min-w-0 flex-1">
					<h2 class="truncate text-base font-semibold text-slate-100">{p.label}</h2>
					<p class="truncate text-xs text-slate-400">{p.sub}</p>
				</div>
				<button
					class="-mt-1 -mr-1 grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
					onclick={() => {
						selected = null;
						scene?.setSelection(null);
					}}
					aria-label="Close">✕</button
				>
			</div>
			<p class="mt-3 text-sm leading-relaxed text-slate-300">
				{#if p.kind === 'shaft'}
					{@const info = SHAFTS[p.shaft!]}
					<span class="font-semibold capitalize" style="color:{SHAFT_COLORS[info.status]}"
						>{info.status}</span
					>
					· {info.description}
				{:else if p.kind === 'farm'}
					Communal farm under rationed grow-lamps, {p.room.w}×{p.room.h} tiles. Dug into the rock at the
					city's edge; one tunnel in.
				{:else if p.kind === 'plant'}
					Geothermal plant feeding the Hollow's grid. When one trips, the deep levels go dark first.
				{:else if p.kind !== 'block'}
					{p.note}
				{:else}
					<span class={pf.lit[p.room.id] ? 'text-emerald-400' : 'text-slate-400'}
						>{pf.lit[p.room.id] ? 'Powered' : 'Blackout'}</span
					>
					· ≈ {compact.format(pf.residents[p.room.id])} residents · {p.room.w}×{p.room.h} block, single
					door
				{/if}
			</p>
			{#if sensors}
				{@const overall = STATUS_INFO[sensors.status]}
				<div class="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
					<div class="mb-2 flex items-center justify-between text-xs">
						<span class="font-semibold tracking-wider text-slate-400">SENSORS</span>
						<span
							class="rounded-full px-2 py-0.5 font-semibold"
							style="color:{overall.color};background:{overall.color}22"
						>
							{overall.label}
						</span>
					</div>
					<dl class="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 text-xs">
						{#each sensors.readings as r (r.key)}
							<span
								class="h-2 w-2 rounded-full"
								style="background:{STATUS_INFO[r.status].color}"
								aria-hidden="true"
							></span>
							<dt class="text-slate-400">{r.label}</dt>
							<dd class="text-right text-slate-100 tabular-nums">
								{r.text}<span class="sr-only"> ({STATUS_INFO[r.status].label})</span>
							</dd>
						{/each}
					</dl>
					<p class="mt-2 text-[10px] text-slate-500">Simulated readings</p>
				</div>
			{/if}
			{#if impact}
				<div class="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
					<div class="mb-2 flex items-center justify-between">
						<span class="font-semibold tracking-wider text-slate-400">IMPACT</span>
						{#if impact.active}
							<span class="font-semibold text-slate-100">
								≈ {compact.format(impact.affectedTotal)} residents affected
							</span>
						{/if}
					</div>
					{#if !impact.active}
						<p class="text-slate-300">
							Serves ≈ {compact.format(impact.dependentTotal)} residents in {impact.neighborhoods
								.length} neighborhoods. No one is affected while it reads {STATUS_INFO[
								impact.status
							].label.toLowerCase()}.
						</p>
					{:else if !impact.neighborhoods.length}
						<p class="text-slate-300">No housing on this level depends on it.</p>
					{:else}
						<table class="w-full">
							<thead class="text-left text-[10px] text-slate-500">
								<tr>
									<th class="pb-1 font-normal">Neighborhood</th>
									<th class="pb-1 text-right font-normal">Affected</th>
									<th class="pb-1 text-right font-normal">Severity</th>
								</tr>
							</thead>
							<tbody>
								{#each impact.neighborhoods as n (n.id)}
									{@const sev = STATUS_INFO[n.severity]}
									<tr>
										<td class="py-0.5 text-slate-300">{n.name}</td>
										<td class="py-0.5 text-right text-slate-100 tabular-nums"
											>≈ {compact.format(n.affected)}</td
										>
										<td class="py-0.5 text-right">
											<span
												class="rounded-full px-1.5 py-px font-semibold"
												style="color:{sev.color};background:{sev.color}22">{sev.label}</span
											>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
					<p class="mt-2 text-[10px] leading-snug text-slate-500">
						Simulated: each block depends on its nearest {p.sub.split(' · ')[0].toLowerCase()} facility
						by tunnel distance. Critical cuts service to all of them, High risk to half.
					</p>
				</div>
			{/if}
			<div class="mt-3 flex gap-2">
				<button
					class="flex-1 rounded-full bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500"
					onclick={() => directionsTo(p)}>Directions</button
				>
				<button
					class="flex-1 rounded-full border border-white/15 px-3 py-2 text-sm font-semibold text-sky-300 hover:bg-white/5"
					onclick={() => directionsFrom(p)}>Start here</button
				>
			</div>
		</section>
	{/if}

	{#if picking}
		<p
			class="pointer-events-none absolute bottom-20 left-1/2 z-20 -translate-x-1/2 rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold whitespace-nowrap text-white shadow-xl"
			role="status"
		>
			Click a place to set the {picking === 'from' ? 'start' : 'destination'} · Esc to cancel
		</p>
	{:else if !selected}
		<p
			class="pointer-events-none absolute bottom-4 left-1/2 hidden -translate-x-1/2 text-[11px] whitespace-nowrap text-slate-500 xl:block"
		>
			Drag to pan · right-drag to rotate · scroll to zoom · Q/E change level · F whole level · /
			search
			{#if dug < LEVELS.length}· mapping {LEVELS[dug].code}…{/if}
		</p>
	{/if}
</div>
