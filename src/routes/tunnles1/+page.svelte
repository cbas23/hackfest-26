<script lang="ts">
	import { generateTunnelMap, type Tile } from '#lib/tunnels/generate.js';

	const TILE = 24;
	const HALF = TILE / 2;
	const LANE = 14; // tunnel width inside a tile

	let seed = $state(Math.floor(Math.random() * 1e6));
	let width = $state(41);
	let height = $state(25);
	let residenceChance = $state(0.35);
	let hovered = $state<Tile | null>(null);

	const map = $derived(generateTunnelMap({ seed, width, height, residenceChance }));

	const isRoad = (x: number, y: number) => map.tiles[y]?.[x]?.type === 'road';

	/** Arms from a road tile's centre toward each neighbouring road/residence it connects to. */
	function arms(t: Tile) {
		const out: { x: number; y: number; w: number; h: number }[] = [];
		const cx = t.x * TILE + HALF;
		const cy = t.y * TILE + HALF;
		const l = LANE / 2;
		if (isRoad(t.x, t.y - 1)) out.push({ x: cx - l, y: cy - HALF, w: LANE, h: HALF });
		if (isRoad(t.x, t.y + 1)) out.push({ x: cx - l, y: cy, w: LANE, h: HALF });
		if (isRoad(t.x - 1, t.y)) out.push({ x: cx - HALF, y: cy - l, w: HALF, h: LANE });
		if (isRoad(t.x + 1, t.y)) out.push({ x: cx, y: cy - l, w: HALF, h: LANE });
		return out;
	}

	/** Short driveway from a residence to its single access road. */
	function driveway(t: Tile) {
		const a = t.access!;
		const dx = a.x - t.x;
		const dy = a.y - t.y;
		const cx = t.x * TILE + HALF;
		const cy = t.y * TILE + HALF;
		const w = 4;
		if (dx !== 0) return { x: dx > 0 ? cx : cx - TILE, y: cy - w / 2, w: TILE, h: w };
		return { x: cx - w / 2, y: dy > 0 ? cy : cy - TILE, w, h: TILE };
	}

	const roads = $derived(map.tiles.flat().filter((t) => t.type === 'road'));
	const residences = $derived(map.tiles.flat().filter((t) => t.type === 'residence'));

	function regenerate() {
		seed = Math.floor(Math.random() * 1e6);
	}

	function onMove(e: PointerEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		const pt = svg.createSVGPoint();
		pt.x = e.clientX;
		pt.y = e.clientY;
		const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
		const x = Math.floor(p.x / TILE);
		const y = Math.floor(p.y / TILE);
		hovered = map.tiles[y]?.[x] ?? null;
	}
</script>

<svelte:head><title>Tunnels · Map 1</title></svelte:head>

<div class="min-h-screen bg-[#05060a] p-4 font-mono text-slate-300 sm:p-6">
	<header class="mb-4 flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="text-[10px] tracking-[0.3em] text-slate-500">TUNNEL SURVEY · FLAT SECTION</p>
			<h1 class="text-2xl font-bold tracking-[0.2em] text-slate-100">TUNNELS 1</h1>
			<p class="mt-1 text-xs text-slate-500">
				{map.roadCount} road tiles · {map.residenceCount} residences · seed {map.seed}
			</p>
		</div>

		<div class="flex flex-wrap items-end gap-3 text-xs">
			<label class="flex flex-col gap-1">
				<span class="text-slate-500">Seed</span>
				<input
					type="number"
					bind:value={seed}
					class="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-slate-500">Width {width}</span>
				<input type="range" min="15" max="81" step="2" bind:value={width} />
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-slate-500">Height {height}</span>
				<input type="range" min="11" max="51" step="2" bind:value={height} />
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-slate-500">Residences {Math.round(residenceChance * 100)}%</span>
				<input type="range" min="0" max="1" step="0.05" bind:value={residenceChance} />
			</label>
			<button
				onclick={regenerate}
				class="rounded border border-amber-600/60 bg-amber-500/10 px-3 py-1.5 text-amber-300 hover:bg-amber-500/20"
			>
				Regenerate
			</button>
		</div>
	</header>

	<div class="overflow-auto rounded-lg border border-slate-800 bg-[#0b0c10]">
		<svg
			viewBox="0 0 {map.width * TILE} {map.height * TILE}"
			class="block h-auto w-full min-w-[640px]"
			role="img"
			aria-label="Randomly generated tunnel map"
			onpointermove={onMove}
			onpointerleave={() => (hovered = null)}
		>
			<defs>
				<pattern id="rock" width="8" height="8" patternUnits="userSpaceOnUse">
					<rect width="8" height="8" fill="#16171d" />
					<circle cx="2" cy="3" r="0.8" fill="#22242c" />
					<circle cx="6" cy="7" r="0.6" fill="#1d1f26" />
				</pattern>
			</defs>

			<!-- bedrock -->
			<rect width={map.width * TILE} height={map.height * TILE} fill="url(#rock)" />

			<!-- tunnel walls (slightly larger lanes underneath) -->
			{#each roads as t (t.x + ',' + t.y)}
				<rect
					x={t.x * TILE + HALF - LANE / 2 - 2}
					y={t.y * TILE + HALF - LANE / 2 - 2}
					width={LANE + 4}
					height={LANE + 4}
					fill="#3a3326"
				/>
				{#each arms(t) as a, i (i)}
					<rect x={a.x - 2} y={a.y - 2} width={a.w + 4} height={a.h + 4} fill="#3a3326" />
				{/each}
			{/each}

			<!-- road surface -->
			{#each roads as t (t.x + ',' + t.y)}
				<rect
					x={t.x * TILE + HALF - LANE / 2}
					y={t.y * TILE + HALF - LANE / 2}
					width={LANE}
					height={LANE}
					fill="#4b4f5c"
				/>
				{#each arms(t) as a, i (i)}
					<rect x={a.x} y={a.y} width={a.w} height={a.h} fill="#4b4f5c" />
				{/each}
			{/each}

			<!-- residences + their single driveway -->
			{#each residences as t (t.x + ',' + t.y)}
				{@const d = driveway(t)}
				<rect x={d.x} y={d.y} width={d.w} height={d.h} fill="#d4a24c" opacity="0.8" />
				<g transform="translate({t.x * TILE}, {t.y * TILE})">
					<rect
						x="3"
						y="3"
						width={TILE - 6}
						height={TILE - 6}
						rx="3"
						fill="#2a1e0e"
						stroke="#d4a24c"
					/>
					<path d="M7 13 L12 8 L17 13 V17 H7 Z" fill="#d4a24c" />
				</g>
			{/each}

			<!-- hover highlight -->
			{#if hovered}
				<rect
					x={hovered.x * TILE}
					y={hovered.y * TILE}
					width={TILE}
					height={TILE}
					fill="none"
					stroke="#e2e8f0"
					stroke-width="1.5"
				/>
				{#if hovered.access}
					<rect
						x={hovered.access.x * TILE}
						y={hovered.access.y * TILE}
						width={TILE}
						height={TILE}
						fill="none"
						stroke="#d4a24c"
						stroke-width="1.5"
						stroke-dasharray="3 2"
					/>
				{/if}
			{/if}
		</svg>
	</div>

	<footer class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
		<span class="flex items-center gap-2"><span class="h-3 w-3 bg-[#4b4f5c]"></span>Road</span>
		<span class="flex items-center gap-2"
			><span class="h-3 w-3 border border-[#d4a24c] bg-[#2a1e0e]"></span>Residence (one access road)</span
		>
		<span class="flex items-center gap-2"><span class="h-3 w-3 bg-[#16171d]"></span>Rock</span>
		<span class="ml-auto text-slate-400">
			{#if hovered}
				({hovered.x}, {hovered.y}) · {hovered.type}{hovered.access
					? ` · access via (${hovered.access.x}, ${hovered.access.y})`
					: ''}
			{:else}
				Hover a tile
			{/if}
		</span>
	</footer>
</div>
