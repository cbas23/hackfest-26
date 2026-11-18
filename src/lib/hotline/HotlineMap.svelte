<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { HOLLOW_SEED, LEVELS } from '#lib/hollow/data.js';
	import { createHollowMap, type HollowMap, type RouteDraw } from '#lib/hollow/hollowMap.js';
	import { createHollow, type Floor } from '#lib/hollow/world.js';
	import type { Building } from './places.js';

	export interface RadarHit {
		building: Building;
		count: number;
	}

	/**
	 * The real 3D Hollow, all levels stacked, each level's buildings tinted by its hotline risk.
	 * `levels` is indexed from 0 (L1) like the rest of the map code.
	 */
	let {
		levels,
		flash = null,
		focus = null,
		target = null,
		radar = [],
		radius = 45,
		route = null,
		radarColor = '#34d399',
		radarLabel = true,
		band = null
	}: {
		levels: { risk: number; color: string }[];
		flash?: number | null;
		/** Level to zoom into (0-based), or null for all levels stacked. */
		focus?: number | null;
		/** The caller's building: after the level zoom, fly to it and sweep the radar. */
		target?: RadarHit | null;
		/** Other buildings on the level with reports inside the radar. */
		radar?: RadarHit[];
		/** Radar radius in tiles. */
		radius?: number;
		/** Supply route to draw (the blue trail); framed on the focused level. */
		route?: RouteDraw | null;
		/** Radar tint, e.g. blue while the water letter is open. */
		radarColor?: string;
		/** Show the "RADAR · N reports within …" strip under the map. */
		radarLabel?: boolean;
		band?: { lo: number; hi: number } | null;
	} = $props();

	const hollow = createHollow(HOLLOW_SEED);
	let container: HTMLDivElement;
	let scene = $state.raw<HollowMap | undefined>();

	function cityBounds(f: Floor) {
		let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
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
	const anchors = LEVELS.map((l) => {
		const [, minY, maxX, maxY] = cityBounds(hollow.floor(l.index));
		return { x: maxX + 2, y: (minY + maxY) / 2 };
	});

	$effect(() => {
		scene?.setLevelTints(
			levels.map((l, i) => ({
				level: i,
				color: l.color,
				opacity: 0.6 + Math.min(1, l.risk / 100) * 0.4
			}))
		);
	});

	const floors = LEVELS.map((l) => hollow.floor(l.index));
	let focusNow: number | null = null;

	let radarOn = $state(false);
	let radarTimers: ReturnType<typeof setTimeout>[] = [];
	const targetKey = $derived(target?.building.key ?? null);

	// The radar disc lies flat on the level in the 3D scene, so it tilts and scales with the camera.
	$effect(() => {
		const s = scene;
		const key = radarOn ? targetKey : null;
		const color = radarColor;
		untrack(() => {
			const t = key ? target?.building : null;
			s?.setRadar(t ? { level: t.level - 1, x: t.x, y: t.y, radius, color } : null);
		});
	});

	/** Tiles of the route on the level we're looking at, or null. */
	function routeBounds() {
		if (!route || focusNow === null) return null;
		const pts = route.legs.filter((l) => l.level === focusNow).flatMap((l) => l.path);
		if (!pts.length) return null;
		const xs = pts.map((p) => p.x);
		const ys = pts.map((p) => p.y);
		return [
			Math.min(...xs) - 6,
			Math.min(...ys) - 6,
			Math.max(...xs) + 6,
			Math.max(...ys) + 6
		] as const;
	}

	// Draw the supply route and frame it.
	$effect(() => {
		const s = scene;
		const r = route;
		untrack(() => {
			s?.setRoute(r);
			if (s && r) frame(s);
		});
	});

	/** Frame whatever is showing: a route, the radar, one level's platform, or the whole stack. */
	function frame(s: HollowMap) {
		const rb = routeBounds();
		if (rb) s.fitBounds(...rb);
		else if (focusNow === null) s.frameStack();
		else if (radarOn && target) flyToTarget(s, target.building);
		else s.fitBounds(...cityBounds(floors[focusNow]));
	}
	function flyToTarget(s: HollowMap, b: Building) {
		s.flyTo(b.x, b.y, { distance: radius * 2.6 });
	}

	// Level first, then the building: fly in close and start the radar sweep.
	$effect(() => {
		const s = scene;
		const key = targetKey;
		const lv = focus;
		untrack(() => {
			for (const t of radarTimers) clearTimeout(t);
			radarTimers = [];
			radarOn = false;
			if (!s || !key || !target || lv === null || target.building.level - 1 !== lv) return;
			const b = target.building;
			radarTimers.push(
				setTimeout(() => flyToTarget(s, b), 1500),
				setTimeout(() => (radarOn = true), 2600)
			);
		});
	});

	// Caller named a level: drop out of the stack and fly into that platform. Null: back out.
	$effect(() => {
		const s = scene;
		const f = focus;
		if (!s || f === focusNow) return;
		untrack(() => {
			focusNow = f;
			if (f === null) s.setOverview(true, floors);
			else {
				s.showFloor(floors[f], 0);
				frame(s);
			}
		});
	});

	const pinEls = $state<Record<number, HTMLElement>>({});
	let radarEl = $state<HTMLElement>();
	const hitEls = $state<Record<string, HTMLElement>>({});
	$effect(() => {
		if (focus !== null) {
			if (!radarOn || !target || !radarEl) return void scene?.setPins([]);
			const lv = target.building.level - 1;
			return void scene?.setPins([
				{ el: radarEl, x: target.building.x, y: target.building.y, h: 2, level: lv },
				...radar
					.filter((r) => hitEls[r.building.key])
					.map((r) => ({
						el: hitEls[r.building.key],
						x: r.building.x,
						y: r.building.y,
						h: 2,
						level: lv
					}))
			]);
		}
		scene?.setPins(
			LEVELS.filter((l) => pinEls[l.index]).map((l) => ({
				el: pinEls[l.index],
				x: anchors[l.index].x,
				y: anchors[l.index].y,
				h: 1,
				level: l.index
			}))
		);
	});

	onMount(() => {
		const s = createHollowMap(container, {
			onHover: () => {},
			onClick: () => {},
			stackDistance: 900
		});
		s.showFloor(hollow.floor(0), 0);
		s.setOverview(true, floors);
		scene = s;
		// Re-frame when the panel changes size (e.g. alert banners push the layout up).
		let first = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const ro = new ResizeObserver(() => {
			if (first) return void (first = false);
			clearTimeout(timer);
			timer = setTimeout(() => frame(s), 150);
		});
		ro.observe(container);
		return () => {
			for (const t of radarTimers) clearTimeout(t);
			ro.disconnect();
			clearTimeout(timer);
			s.dispose();
		};
	});
</script>

<div class="absolute inset-0 overflow-hidden">
	<div class="absolute top-0 left-0" style="width:100%;height:100%">
		<div bind:this={container} class="absolute inset-0"></div>
		<div class="pointer-events-none absolute inset-0 overflow-hidden" class:hidden={focus !== null}>
			{#each LEVELS as l (l.code)}
				{@const lv = levels[l.index]}
				{@const inBand = band && l.index + 1 >= band.lo && l.index + 1 <= band.hi}
				<div bind:this={pinEls[l.index]} class="absolute top-0 left-0" style="visibility:hidden">
					<div
						class="relative flex -translate-y-1/2 items-center gap-2 rounded-full border bg-black/80 px-2.5 py-1 whitespace-nowrap backdrop-blur transition-transform duration-500 {flash ===
						l.index
							? 'scale-125'
							: ''}"
						style="border-color:{lv?.color ?? '#475569'}{inBand ? '' : '66'};{inBand
							? `box-shadow:0 0 18px -2px ${lv?.color}`
							: ''}"
					>
						{#if flash === l.index}
							<span
								class="absolute inset-0 animate-ping rounded-full border-2"
								style="border-color:{lv?.color}"
							></span>
						{/if}
						<span class="text-xs font-bold text-white">{l.code}</span>
						<span class="font-mono text-sm font-bold" style="color:{lv?.color}"
							>{Math.floor(lv?.risk ?? 0)}%</span
						>
					</div>
				</div>
			{/each}
		</div>
		{#if radarOn && target}
			{@const inside = radar.reduce((n, r) => n + r.count, 0) + target.count}
			<div class="pointer-events-none absolute inset-0 overflow-hidden">
				<!-- The caller's building tag; the radar itself is drawn flat in the 3D scene -->
				<div bind:this={radarEl} class="absolute top-0 left-0" style="visibility:hidden">
					<div class="relative -translate-x-1/2 -translate-y-1/2">
						<span
							class="relative block size-4 rounded-full border-2 border-white bg-red-500 shadow-[0_0_16px_#ef4444]"
						></span>
					</div>
					<div
						class="absolute -translate-x-1/2 animate-in duration-500 fade-in slide-in-from-bottom-2"
						style="top:-74px"
					>
						<div
							class="rounded-xl border-2 border-red-500 bg-black/85 px-3 py-1.5 text-center whitespace-nowrap shadow-[0_0_24px_-4px_#ef4444]"
						>
							<p class="text-sm font-black text-white">{target.building.label}</p>
							<p class="font-mono text-xs font-bold text-red-300">
								{#key target.count}<span class="inline-block animate-in duration-500 zoom-in-150"
										>{target.count}</span
									>{/key}
								{target.count === 1 ? 'report' : 'reports'}
							</p>
						</div>
					</div>
				</div>
				{#each radar as r, i (r.building.key)}
					<div
						bind:this={hitEls[r.building.key]}
						class="absolute top-0 left-0"
						style="visibility:hidden"
					>
						<div
							class="flex -translate-x-1/2 -translate-y-1/2 animate-in flex-col items-center duration-500 fill-mode-both zoom-in-50 fade-in"
							style="animation-delay:{300 + i * 220}ms"
						>
							<span class="relative flex size-3">
								<span
									class="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-70"
								></span>
								<span
									class="relative inline-flex size-3 rounded-full border border-white bg-amber-500"
								></span>
							</span>
							<span
								class="mt-1 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-amber-200"
							>
								{r.building.label} <span class="font-mono text-white">({r.count})</span>
							</span>
						</div>
					</div>
				{/each}
			</div>
			{#if radarLabel}
				<div
					class="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 animate-in rounded-full border border-emerald-400/50 bg-black/80 px-4 py-1.5 font-mono text-xs text-emerald-300 duration-500 fade-in slide-in-from-bottom-2"
				>
					RADAR · {inside} reports within {radius} m of {target.building.label}
				</div>
			{/if}
		{/if}
		{#if focus !== null && !radarOn && !route}
			{@const l = LEVELS[focus]}
			{@const lv = levels[focus]}
			{#key focus}
				<div
					class="pointer-events-none absolute top-10 left-1/2 -translate-x-1/2 animate-in rounded-2xl border-2 bg-black/80 px-6 py-3 text-center backdrop-blur duration-500 zoom-in-90 fade-in slide-in-from-top-4"
					style="border-color:{lv?.color};box-shadow:0 0 40px -6px {lv?.color}"
				>
					<p class="text-[10px] font-bold tracking-[0.3em] text-slate-400">CALLER LOCATED</p>
					<p class="text-2xl font-black tracking-wide text-white">
						LEVEL {focus + 1} <span class="font-semibold text-slate-400">· {l.name}</span>
					</p>
					<p class="font-mono text-lg font-bold" style="color:{lv?.color}">
						{Math.floor(lv?.risk ?? 0)}% risk · −{l.depth} m
					</p>
				</div>
			{/key}
		{/if}
	</div>
</div>
