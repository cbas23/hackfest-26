<script lang="ts">
	import { onMount } from 'svelte';
	import type { Room } from '#lib/tunnels/generate.js';
	import { FACILITY_INFO, LEVELS, SHAFTS, SHAFT_COLORS } from '#lib/hollow/data.js';
	import { placesOn, type Place, type PlaceKind } from '#lib/hollow/nav.js';
	import { createHollowMap, type HollowMap, type Pick } from '#lib/hollow/hollowMap.js';
	import { facilityStatus, STATUS_INFO, type Status } from '#lib/hollow/sensors.js';
	import { assessImpact } from '#lib/hollow/impact.js';
	import type { Floor } from '#lib/hollow/world.js';
	import { hollow } from './hollow.js';
	import { sicknessOf } from '#lib/hollow/sickness.js';
	import { alertsOn, alertTotals, type HollowAlert } from '#lib/hollow/alerts.js';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import ZapOffIcon from '@lucide/svelte/icons/zap-off';
	import WindIcon from '@lucide/svelte/icons/wind';
	import SirenIcon from '@lucide/svelte/icons/siren';
	import SicknessScale from './sickness-scale.svelte';
	import { home, registerMapNav, SECTION_LENS } from './home-state.svelte.js';
	import { cn } from '#lib/utils.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as ButtonGroup from '#lib/components/ui/button-group/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import PlaceCard from './place-card.svelte';
	import PlaceIcon from './place-icon.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import ScanIcon from '@lucide/svelte/icons/scan';

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- cache, never read by the template
	const placeCache = new Map<number, Place[]>();
	const placesFor = (f: Floor) => {
		let p = placeCache.get(f.index);
		if (!p) placeCache.set(f.index, (p = placesOn(f)));
		return p;
	};

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

	const KIND_COLOR: Record<PlaceKind, string> = {
		block: 'var(--chart-1)',
		farm: 'var(--chart-2)',
		plant: 'var(--chart-3)',
		shaft: 'var(--chart-4)',
		air: FACILITY_INFO.air.color,
		water: FACILITY_INFO.water.color,
		clinic: FACILITY_INFO.clinic.color,
		market: FACILITY_INFO.market.color,
		directorate: FACILITY_INFO.directorate.color
	};
	const placeColor = (p: Place) =>
		p.kind === 'shaft' ? SHAFT_COLORS[SHAFTS[p.shaft!].status] : KIND_COLOR[p.kind];

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- cache, never read by the template
	const boundsCache = new Map<number, readonly [number, number, number, number]>();
	/** Bounding box of the dug area on a floor, in tiles (scans the whole grid, so cached). */
	function cityBounds(f: Floor) {
		let b = boundsCache.get(f.index);
		if (!b) boundsCache.set(f.index, (b = scanBounds(f)));
		return b;
	}
	function scanBounds(f: Floor) {
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
		if (leaving) scene?.fitBounds(...cityBounds(hollow.floor(index)));
		scene?.setHover(null);
		scene?.setSelection(selected?.floor === index ? selected.room : null);
	}

	function setOverview(on: boolean) {
		if (on === overview) return;
		overview = on;
		if (!on) {
			scene?.setOverview(false, []);
			scene?.fitBounds(...cityBounds(floor));
			return;
		}
		hover = null;
		scene?.setHover(null);
		scene?.setOverview(
			true,
			LEVELS.map((_, i) => hollow.floor(i))
		);
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
		else scene?.fitBounds(...cityBounds(floor));
	}

	// ── Selection ────────────────────────────────────────────────────────────
	const placeOf = (f: Floor, room: Room | null) =>
		room ? (placesFor(f).find((p) => p.room.id === room.id) ?? null) : null;

	function select(p: Place | null) {
		selected = p;
		scene?.setSelection(p?.room ?? null);
	}

	function focusPlace(p: Place) {
		goTo(p.floor);
		select(p);
		const r = p.room;
		scene?.flyTo(r.x + r.w / 2, r.y + r.h / 2, { distance: Math.min(distance, 70) });
	}

	function focus(level: number, x: number, y: number) {
		goTo(level);
		select(null);
		scene?.flyTo(x, y, { distance: Math.min(distance, 90) });
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
		kind: PlaceKind | 'level' | 'alert';
		level: number;
		label: string;
		color: string;
		place?: Place;
		status?: Status;
		alert?: HollowAlert;
	}
	const pins = $derived.by<PinSpec[]>(() => {
		if (overview) {
			return LEVELS.map((l) => {
				const [, minY, maxX, maxY] = cityBounds(hollow.floor(l.index));
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
		const alertPins: PinSpec[] =
			lens === 'alerts'
				? alertsOn(floor).alerts.map((a) => ({
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
		return placesFor(floor)
			.filter((p) => p.kind !== 'block' && !(lens === 'alerts' && p.kind === 'air'))
			.map((p): PinSpec => ({
				key: p.key,
				x: p.room.x + p.room.w / 2,
				y: p.room.y + p.room.h / 2,
				h: p.kind === 'shaft' ? 7.5 : p.kind === 'plant' ? 4.5 : 3.5,
				level: levelIndex,
				kind: p.kind,
				label: p.label,
				color: placeColor(p),
				place: p,
				status: facilityStatus(p)?.status
			}))
			.concat(alertPins);
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

	// ── Data lens (driven by the open sidebar section) ──────────────────────
	const lens = $derived(SECTION_LENS[home.section] ?? null);
	$effect(() => scene?.setLens(lens));
	/** Sick share across the shown level (or every level in the stacked view). */
	const sickTotals = $derived.by(() => {
		if (lens !== 'sickness') return null;
		const floors = overview ? LEVELS.map((l) => hollow.floor(l.index)) : [floor];
		let reported = 0;
		let sick = 0;
		for (const f of floors)
			for (const s of sicknessOf(f))
				if (s) {
					reported += s.reported;
					sick += s.sick;
				}
		return { reported, sick, share: sick / Math.max(1, reported) };
	});
	// ── Alerts lens ─────────────────────────────────────────────────────────
	const alertList = $derived.by(() => {
		if (lens !== 'alerts') return null;
		const floors = overview ? LEVELS.map((l) => hollow.floor(l.index)) : [floor];
		return floors.flatMap((f) => alertsOn(f).alerts);
	});
	const totals = $derived(alertList ? alertTotals(alertList) : null);
	const SEVERITIES: Status[] = ['critical', 'high', 'warning'];
	const bySeverity = $derived(
		SEVERITIES.map((s) => ({ s, n: alertList?.filter((a) => a.severity === s).length ?? 0 }))
	);
	const tweenOpts = { duration: 900, easing: cubicOut };
	const countT = new Tween(0, tweenOpts);
	const darkT = new Tween(0, tweenOpts);
	const airT = new Tween(0, tweenOpts);
	$effect(() => {
		countT.set(totals?.count ?? 0);
		darkT.set(totals?.blackoutResidents ?? 0);
		airT.set(totals?.airResidents ?? 0);
	});
	const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
	// The worst blocks on the shown level throb in the 3D map.
	$effect(() => {
		if (lens !== 'alerts' || overview) {
			scene?.setAlertPulse([]);
			return;
		}
		const rooms: { room: Room; color: string }[] = [];
		for (const a of alertsOn(floor).alerts) {
			if (a.severity !== 'critical') continue;
			const color =
				a.kind === 'blackout' ? STATUS_INFO.critical.color : STATUS_INFO[a.severity].color;
			for (const id of a.blocks) rooms.push({ room: floor.map.rooms[id], color });
		}
		scene?.setAlertPulse(rooms);
	});

	const selectedSickness = $derived(
		lens === 'sickness' && selected?.kind === 'block'
			? sicknessOf(hollow.floor(selected.floor))[selected.room.id]
			: null
	);

	const HINTS: [string[], string][] = [
		[['Drag'], 'pan'],
		[['Right-drag'], 'rotate'],
		[['Scroll'], 'zoom'],
		[['Q', 'E'], 'change level'],
		[['O'], 'all levels'],
		[['F'], 'fit level']
	];

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
	/** Only steer the map when focus isn't in another widget (e.g. the sidebar). */
	const forMap = (e: KeyboardEvent) =>
		!(e.metaKey || e.ctrlKey || e.altKey) &&
		(e.target === document.body || (e.target instanceof Node && section.contains(e.target)));

	function onKeyDown(e: KeyboardEvent) {
		if (!forMap(e)) return;
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
		else if (k === 'f') fitView();
		else if (k === 'o') setOverview(!overview);
		else if (k === 'escape') {
			if (selected) select(null);
			else if (overview) setOverview(false);
		} else return;
		if (k.startsWith('page')) e.preventDefault();
	}

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
		registerMapNav({ goTo, setOverview, focus });
		s.showFloor(hollow.floor(0), 0);
		s.fitBounds(...cityBounds(hollow.floor(0)));
		// Open on the all-levels stack.
		setOverview(true);

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
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', onBlur);
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
						<span class="text-muted-foreground tabular-nums">−{l.depth.toLocaleString('en')} m</span
						>
					</Button>
				{:else if p.alert}
					{@const a = p.alert}
					<button
						class="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
						onclick={() => focus(a.floor, a.x, a.y)}
						aria-label="{a.title}: {a.where}"
					>
						<span class="relative grid size-8 place-items-center">
							{#if a.severity !== 'warning'}
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
								class="relative grid size-7 place-items-center rounded-full border-2 border-background text-white shadow-lg"
								style="background:{p.color};box-shadow:0 0 14px {p.color}"
							>
								{#if a.kind === 'blackout'}<ZapOffIcon class="size-3.5" />{:else}<WindIcon
										class="size-3.5"
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
				<ToggleGroup.Item class="flex-1" value={l.code} aria-label="{l.name}, −{l.depth} m"
					>{l.code}</ToggleGroup.Item
				>
			{/each}
		</ToggleGroup.Root>
	</div>

	{#if totals && totals.critical > 0}
		<div class="alert-vignette pointer-events-none absolute inset-0 z-[5]" aria-hidden="true"></div>
	{/if}

	{#if totals}
		<div
			class="alert-in absolute top-16 left-4 z-10 flex w-64 flex-col gap-2.5 overflow-hidden rounded-lg border border-destructive/40 bg-background/90 p-3 text-xs shadow-[0_0_30px_-8px_var(--destructive)] backdrop-blur md:top-4"
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
			<div class="grid grid-cols-2 gap-2">
				<div class="flex flex-col gap-0.5 rounded-md border bg-card/60 p-2">
					<span class="flex items-center gap-1 text-muted-foreground"
						><ZapOffIcon class="size-3" aria-hidden="true" /> In the dark</span
					>
					<span class="text-base font-semibold text-foreground tabular-nums"
						>{compact.format(darkT.current)}</span
					>
				</div>
				<div class="flex flex-col gap-0.5 rounded-md border bg-card/60 p-2">
					<span class="flex items-center gap-1 text-muted-foreground"
						><WindIcon class="size-3" aria-hidden="true" /> Bad air</span
					>
					<span class="text-base font-semibold text-foreground tabular-nums"
						>{compact.format(airT.current)}</span
					>
				</div>
			</div>
			<p class="text-[10px] text-muted-foreground">Residents affected · simulated</p>
		</div>
	{/if}

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
					>{Math.round(sickTotals.share * 100)}%</span
				>
				of {sickTotals.reported.toLocaleString('en')} reported residents sick
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
			<Button variant="outline" size="icon" onclick={() => scene?.zoomBy(1.5)} aria-label="Zoom in">
				<PlusIcon />
			</Button>
			<Button
				variant="outline"
				size="icon"
				onclick={() => scene?.zoomBy(1 / 1.5)}
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
			floor={hollow.floor(selected.floor)}
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
			{#each HINTS as [keys, action] (action)}
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
