<script lang="ts">
	import { onMount } from 'svelte';
	import type { Room } from '#lib/tunnels/generate.js';
	import { FACILITY_INFO, HOLLOW_SEED, LEVELS, SHAFTS, SHAFT_COLORS } from '#lib/hollow/data.js';
	import { placesOn, type Place, type PlaceKind } from '#lib/hollow/nav.js';
	import { createHollowMap, type HollowMap, type Pick } from '#lib/hollow/hollowMap.js';
	import { facilityStatus, STATUS_INFO, type Status } from '#lib/hollow/sensors.js';
	import { assessImpact } from '#lib/hollow/impact.js';
	import { createHollow, type Floor } from '#lib/hollow/world.js';
	import { cn } from '#lib/utils.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as ButtonGroup from '#lib/components/ui/button-group/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import PlaceCard from './place-card.svelte';
	import PlaceIcon from './place-icon.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import ScanIcon from '@lucide/svelte/icons/scan';

	const hollow = createHollow(HOLLOW_SEED);
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

	const level = $derived(LEVELS[levelIndex]);
	const floor = $derived(hollow.floor(levelIndex));

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

	// ── Levels ───────────────────────────────────────────────────────────────
	function goTo(index: number) {
		if (index < 0 || index >= LEVELS.length) return;
		if (index === levelIndex && !overview) return;
		const dir = Math.sign(index - levelIndex);
		const leaving = overview;
		overview = false;
		levelIndex = index;
		hover = null;
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
					color: '#e2e8f0'
				};
			});
		}
		return placesFor(floor)
			.filter((p) => p.kind !== 'block')
			.map((p) => ({
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
		s.showFloor(hollow.floor(0), 0);
		s.fitBounds(...cityBounds(hollow.floor(0)));

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
		class={cn('absolute inset-0', hover && 'cursor-pointer')}
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
					<Button
						variant="outline"
						size="sm"
						class="pointer-events-auto absolute -translate-y-1/2 rounded-full"
						onclick={() => goTo(p.level)}
					>
						<span class="font-bold">{l.code}</span>
						{l.name}
						<span class="text-muted-foreground">−{l.depth} m</span>
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
								class="mt-0.5 text-xs font-semibold whitespace-nowrap text-foreground [text-shadow:0_0_3px_#000,0_0_6px_#000]"
								>{p.label}</span
							>
						{/if}
					</button>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Layer switcher -->
	<div class="absolute top-4 left-1/2 z-10 -translate-x-1/2">
		<ToggleGroup.Root
			type="single"
			variant="outline"
			class="bg-background/90 backdrop-blur"
			aria-label="Map level"
			bind:value={() => layerValue, selectLayer}
		>
			<ToggleGroup.Item value="all" aria-label="All levels">All</ToggleGroup.Item>
			{#each LEVELS as l (l.code)}
				<ToggleGroup.Item value={l.code} aria-label="{l.name}, −{l.depth} m"
					>{l.code}</ToggleGroup.Item
				>
			{/each}
		</ToggleGroup.Root>
	</div>

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
				<path d="M12 2l4 10h-8z" fill="#ef4444" />
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
			onclose={() => select(null)}
		/>
	{:else}
		<p
			class="pointer-events-none absolute bottom-4 left-4 hidden text-[11px] text-muted-foreground xl:block"
		>
			Drag to pan · right-drag to rotate · scroll to zoom · Q/E change level · O all levels · F
			whole level
		</p>
	{/if}
</section>
