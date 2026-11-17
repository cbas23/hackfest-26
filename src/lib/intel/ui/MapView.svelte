<script lang="ts">
	import { onMount } from 'svelte';
	import { HOLLOW_SEED, LEVELS } from '#lib/hollow/data.js';
	import { createHollowMap, type HollowMap } from '#lib/hollow/hollowMap.js';
	import { createHollow, type Floor } from '#lib/hollow/world.js';
	import type { Room } from '#lib/tunnels/generate.js';
	import type { AreaRisk, SectorRisk, Severity } from '../detect.js';
	import type { LevelCode } from '../types.js';

	/**
	 * Sebastian's 3D Hollow map, reused as-is (nothing in `#lib/hollow` is changed). On top of it
	 * we tint housing blocks by sector risk and pin the places this week's reports talk about.
	 */
	let {
		level,
		sectors,
		places,
		severities,
		proposed,
		onLevel
	}: {
		level: LevelCode;
		sectors: SectorRisk[];
		/** Facility names on this level mentioned in reports, with how they should be drawn. */
		places: { name: string; tone: 'alert' | 'issue' | 'info' }[];
		/** Severity per level, for the level switcher. */
		severities: Record<LevelCode, Severity | 'none'>;
		/** A proposed new clinic on this level, drawn as its own pin. */
		proposed?: { name: string; room: Room };
		onLevel(code: LevelCode): void;
	} = $props();

	const hollow = createHollow(HOLLOW_SEED);
	let container: HTMLDivElement;
	let scene = $state.raw<HollowMap | undefined>();
	let shown = -1;

	const index = $derived(LEVELS.findIndex((l) => l.code === level));

	function bounds(f: Floor) {
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

	/** Housing block → sector 0–8, on the same 3×3 grid the map's impact view uses. */
	function blocksBySector(f: Floor): number[][] {
		const housing = f.map.rooms.filter((r) => f.residents[r.id] > 0);
		const cx = housing.map((r) => r.x + r.w / 2);
		const cy = housing.map((r) => r.y + r.h / 2);
		const [x0, x1, y0, y1] = [Math.min(...cx), Math.max(...cx), Math.min(...cy), Math.max(...cy)];
		const third = (v: number, lo: number, hi: number) =>
			Math.min(2, Math.floor(((v - lo) / Math.max(1, hi - lo)) * 3));
		const out: number[][] = Array.from({ length: 9 }, () => []);
		housing.forEach((r, i) => out[third(cy[i], y0, y1) * 3 + third(cx[i], x0, x1)].push(r.id));
		return out;
	}

	type Tone = 'alert' | 'issue' | 'info' | 'new';

	const TINT: Record<AreaRisk, string | null> = {
		high: '#ef4444',
		elevated: '#f97316',
		normal: null
	};

	// Pins: one element per place, positioned by the map.
	const pinEls = $state<Record<string, HTMLElement>>({});
	const pinned = $derived.by(() => {
		if (!scene) return [];
		const f = hollow.floor(index);
		const found: { name: string; tone: Tone; x: number; y: number }[] = places.flatMap((p) => {
			const id = [...f.facilities].find(([, spec]) => spec.name === p.name)?.[0];
			const room = id === undefined ? undefined : f.map.rooms[id];
			return room ? [{ ...p, x: room.x + room.w / 2, y: room.y + room.h / 2 }] : [];
		});
		if (proposed) {
			const r = proposed.room;
			found.push({ name: proposed.name, tone: 'new', x: r.x + r.w / 2, y: r.y + r.h / 2 });
		}
		return found;
	});

	$effect(() => {
		const s = scene;
		if (!s) return;
		const f = hollow.floor(index);
		if (shown !== index) {
			s.showFloor(f, shown < 0 ? 0 : Math.sign(index - shown));
			s.fitBounds(...bounds(f));
			shown = index;
		}
		const groups = blocksBySector(f);
		s.setImpact(
			sectors.flatMap((sec, i) => {
				const color = TINT[sec.risk];
				return color ? groups[i].map((id) => ({ room: f.map.rooms[id], color })) : [];
			})
		);
	});

	$effect(() => {
		scene?.setPins(
			pinned
				.filter((p) => pinEls[p.name])
				.map((p) => ({ el: pinEls[p.name], x: p.x, y: p.y, h: 2, level: index }))
		);
	});

	onMount(() => {
		const s = createHollowMap(container, { onHover: () => {}, onClick: () => {} });
		scene = s;
		return () => s.dispose();
	});

	const DOT: Record<Severity | 'none', string> = {
		alert: 'bg-red-500',
		watch: 'bg-amber-400',
		normal: 'bg-blue-400',
		none: 'bg-slate-600'
	};
	const PIN: Record<Tone, string> = {
		alert: 'bg-red-500 ring-red-400/50',
		issue: 'bg-amber-500 ring-amber-400/40',
		info: 'bg-sky-500 ring-sky-400/40',
		new: 'bg-emerald-500 ring-emerald-400/50'
	};
</script>

<div class="relative h-full min-h-[320px] overflow-hidden rounded-xl bg-[#121726]">
	<div bind:this={container} class="absolute inset-0"></div>

	<!-- Level switcher -->
	<div
		class="absolute top-3 left-3 z-10 flex flex-col gap-1 rounded-xl bg-[#0d1220]/85 p-1 backdrop-blur"
	>
		{#each LEVELS as l (l.code)}
			{@const code = l.code as LevelCode}
			<button
				onclick={() => onLevel(code)}
				class="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1 text-xs {code ===
				level
					? 'bg-blue-600 text-white'
					: 'text-slate-300 hover:bg-white/10'}"
			>
				{l.code}
				<span class="h-1.5 w-1.5 rounded-full {DOT[severities[code]]}"></span>
			</button>
		{/each}
	</div>

	<!-- Legend -->
	<div
		class="absolute bottom-3 left-3 z-10 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-[#0d1220]/85 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur"
	>
		<span class="flex items-center gap-1.5"
			><span class="h-2 w-2 rounded-sm bg-red-500"></span>High risk</span
		>
		<span class="flex items-center gap-1.5"
			><span class="h-2 w-2 rounded-sm bg-orange-500"></span>Elevated</span
		>
		<span class="flex items-center gap-1.5"
			><span class="h-2 w-2 rounded-full bg-sky-500"></span>Reported place</span
		>
		{#if proposed}
			<span class="flex items-center gap-1.5"
				><span
					class="grid h-3 w-3 place-items-center rounded-full bg-emerald-500 text-[9px] leading-none font-bold text-white"
					>+</span
				>Proposed clinic</span
			>
		{/if}
	</div>

	<!-- Pin elements; the map moves them into place. -->
	<div class="pointer-events-none absolute inset-0 isolate z-0 overflow-hidden">
		{#each pinned as p (p.name)}
			<div bind:this={pinEls[p.name]} class="absolute top-0 left-0" style="visibility:hidden">
				<div class="flex -translate-x-1/2 -translate-y-2 flex-col items-center">
					{#if p.tone === 'new'}
						<span
							class="grid h-5 w-5 place-items-center rounded-full border-2 border-white text-xs leading-none font-bold text-white ring-4 {PIN[
								p.tone
							]}">+</span
						>
						<span
							class="mt-1 rounded border border-dashed border-emerald-400/70 bg-[#0d1220]/90 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-emerald-200"
							>{p.name} (proposed)</span
						>
					{:else}
						<span class="h-3.5 w-3.5 rounded-full border-2 border-white ring-4 {PIN[p.tone]}"
						></span>
						<span
							class="mt-1 rounded bg-[#0d1220]/90 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-slate-100"
							>{p.name}</span
						>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
