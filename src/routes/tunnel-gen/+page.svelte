<script lang="ts">
	import { generateTunnelMap, type GateSpec, type Room, type Side } from '#lib/tunnels/generate.js';

	const TILE = 12;

	let seed = $state(Math.floor(Math.random() * 1e6));
	let width = $state(72);
	let height = $state(56);
	let gates = $state(4);
	let interiorChance = $state(0.35);
	let gateMode = $state<'random' | 'custom'>('random');
	/** Predetermined gates as "x,y" or "x,y,side" entries (top-left tile; side = n|e|s|w). */
	let gateText = $state('34,24 6,26,e 60,10');

	const customGates = $derived(
		gateText
			.split(/[\s;]+/)
			.map((entry) => entry.split(',').map((v) => v.trim()))
			.filter(([x, y]) => x !== '' && !isNaN(+x) && y !== undefined && !isNaN(+y))
			.map(([x, y, side]): GateSpec => {
				const door = ['n', 'e', 's', 'w'].includes(side) ? (side as Side) : undefined;
				return { x: Math.round(+x), y: Math.round(+y), door };
			})
	);
	let streetDensity = $state(0.5);
	let roomDensity = $state(0.8);
	let hover = $state<{ x: number; y: number } | null>(null);

	const map = $derived(
		generateTunnelMap({
			seed,
			width,
			height,
			gates: gateMode === 'custom' ? customGates : gates,
			interiorGateChance: interiorChance,
			streetDensity,
			roomDensity
		})
	);

	/** One SVG path made of unit squares for every tile matching `pred`. */
	function tilesPath(pred: (x: number, y: number) => boolean) {
		let d = '';
		for (let y = 0; y < map.height; y++)
			for (let x = 0; x < map.width; x++)
				if (pred(x, y)) d += `M${x * TILE} ${y * TILE}h${TILE}v${TILE}h${-TILE}z`;
		return d;
	}

	const inCity = (x: number, y: number) => (map.grid[y]?.[x] ?? 'void') !== 'void';

	const cityPath = $derived(tilesPath(inCity));
	const roadPath = $derived(tilesPath((x, y) => map.grid[y][x] === 'road'));

	/** Outline segments where the city meets the surrounding earth. */
	const edgePath = $derived.by(() => {
		let d = '';
		for (let y = 0; y < map.height; y++)
			for (let x = 0; x < map.width; x++) {
				if (!inCity(x, y)) continue;
				const px = x * TILE;
				const py = y * TILE;
				if (!inCity(x, y - 1)) d += `M${px} ${py}h${TILE}`;
				if (!inCity(x, y + 1)) d += `M${px} ${py + TILE}h${TILE}`;
				if (!inCity(x - 1, y)) d += `M${px} ${py}v${TILE}`;
				if (!inCity(x + 1, y)) d += `M${px + TILE} ${py}v${TILE}`;
			}
		return d;
	});

	const ROOM_COLORS = ['#3b2f1c', '#43321a', '#3a2a1f', '#463722', '#35301f'];
	const roomFill = (r: Room) => ROOM_COLORS[(r.w * r.h) % ROOM_COLORS.length];

	/** Door marker drawn on the shared edge between the door tile and its access road. */
	function doorRect(r: Room) {
		const dx = r.access.x - r.door.x;
		const dy = r.access.y - r.door.y;
		const cx = r.door.x * TILE + TILE / 2 + (dx * TILE) / 2;
		const cy = r.door.y * TILE + TILE / 2 + (dy * TILE) / 2;
		const long = TILE * 0.6;
		const short = 3;
		return dx !== 0
			? { x: cx - short / 2, y: cy - long / 2, w: short, h: long }
			: { x: cx - long / 2, y: cy - short / 2, w: long, h: short };
	}

	/** Arrow from a gate out of the city. */
	function exitArrow(r: Room) {
		const e = r.exit!;
		const dx = Math.sign(e.x - r.door.x);
		const dy = Math.sign(e.y - r.door.y);
		const sx = e.x * TILE + TILE / 2 - dx * TILE;
		const sy = e.y * TILE + TILE / 2 - dy * TILE;
		const ex = sx + dx * TILE * 2.2;
		const ey = sy + dy * TILE * 2.2;
		return { sx, sy, ex, ey };
	}

	const hoveredRoom = $derived(
		hover ? (map.rooms[map.roomAt[hover.y]?.[hover.x] ?? -1] ?? null) : null
	);
	const hoveredType = $derived(hover ? (map.grid[hover.y]?.[hover.x] ?? 'void') : null);

	const roomCount = $derived(map.rooms.filter((r) => r.kind === 'room').length);
	const gateCount = $derived(map.rooms.filter((r) => r.kind === 'gate').length);

	function regenerate() {
		seed = Math.floor(Math.random() * 1e6);
	}

	function tileAt(e: PointerEvent | MouseEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		const pt = svg.createSVGPoint();
		pt.x = e.clientX;
		pt.y = e.clientY;
		const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
		return { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
	}

	function onMove(e: PointerEvent) {
		hover = tileAt(e);
	}

	/** In custom mode: click a gate to remove it, click anywhere else to add one centred there. */
	function onClick(e: MouseEvent) {
		if (gateMode !== 'custom') return;
		const t = tileAt(e);
		const room = map.rooms[map.roomAt[t.y]?.[t.x] ?? -1];
		const entries = gateText.split(/[\s;]+/).filter(Boolean);
		if (room?.kind === 'gate' && room.specIndex !== undefined) {
			entries.splice(room.specIndex, 1);
		} else {
			entries.push(`${t.x - 2},${t.y - 2}`);
		}
		gateText = entries.join(' ');
	}

	function useCurrentGates() {
		gateText = map.rooms
			.filter((r) => r.kind === 'gate')
			.map((r) => {
				const dx = r.access.x - r.door.x;
				const dy = r.access.y - r.door.y;
				const side = dx > 0 ? 'e' : dx < 0 ? 'w' : dy > 0 ? 's' : 'n';
				return `${r.x},${r.y},${side}`;
			})
			.join(' ');
		gateMode = 'custom';
	}
</script>

<svelte:head><title>Tunnels · Map 1</title></svelte:head>

<div class="min-h-screen bg-[#05060a] p-4 font-mono text-slate-300 sm:p-6">
	<header class="mb-4 flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="text-[10px] tracking-[0.3em] text-slate-500">TUNNEL SURVEY · UNDERGROUND CITY</p>
			<h1 class="text-2xl font-bold tracking-[0.2em] text-slate-100">TUNNELS 1</h1>
			<p class="mt-1 text-xs text-slate-500">
				{map.roadCount} road tiles · {roomCount} rooms · {gateCount} gates · seed {map.seed}
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
				<input type="range" min="40" max="120" step="2" bind:value={width} />
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-slate-500">Height {height}</span>
				<input type="range" min="30" max="90" step="2" bind:value={height} />
			</label>
			{#if gateMode === 'random'}
				<label class="flex flex-col gap-1">
					<span class="text-slate-500">Gates {gates}</span>
					<input type="range" min="1" max="8" step="1" bind:value={gates} />
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-slate-500">Inner gates {Math.round(interiorChance * 100)}%</span>
					<input type="range" min="0" max="1" step="0.05" bind:value={interiorChance} />
				</label>
			{/if}
			<label class="flex flex-col gap-1">
				<span class="text-slate-500">Streets {Math.round(streetDensity * 100)}%</span>
				<input type="range" min="0" max="1" step="0.05" bind:value={streetDensity} />
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-slate-500">Rooms {Math.round(roomDensity * 100)}%</span>
				<input type="range" min="0" max="1" step="0.05" bind:value={roomDensity} />
			</label>
			<button
				onclick={regenerate}
				class="rounded border border-amber-600/60 bg-amber-500/10 px-3 py-1.5 text-amber-300 hover:bg-amber-500/20"
			>
				Regenerate
			</button>
		</div>
	</header>

	<section class="mb-4 flex flex-wrap items-center gap-3 text-xs">
		<span class="text-slate-500">Gate placement</span>
		<div class="flex overflow-hidden rounded border border-slate-700">
			{#each ['random', 'custom'] as const as mode (mode)}
				<button
					onclick={() => (gateMode = mode)}
					class="px-3 py-1 capitalize {gateMode === mode
						? 'bg-cyan-500/20 text-cyan-200'
						: 'text-slate-400 hover:text-slate-200'}">{mode}</button
				>
			{/each}
		</div>
		{#if gateMode === 'custom'}
			<label class="flex min-w-72 flex-1 items-center gap-2">
				<span class="text-slate-500">x,y[,n|e|s|w]</span>
				<input
					bind:value={gateText}
					spellcheck="false"
					class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
				/>
			</label>
			<span class="text-slate-500">Click map to add · click a gate to remove</span>
		{:else}
			<button
				onclick={useCurrentGates}
				class="rounded border border-slate-700 px-3 py-1 text-slate-400 hover:text-slate-200"
				>Pin these gates as custom</button
			>
		{/if}
	</section>

	<div class="overflow-auto rounded-lg border border-slate-800 bg-[#08090c]">
		<!-- Clicking is a pointer shortcut; the coordinate field above is the keyboard path. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<svg
			viewBox="0 0 {map.width * TILE} {map.height * TILE}"
			class="mx-auto block h-auto max-h-[calc(100vh-11rem)] w-full min-w-[640px]"
			role="img"
			aria-label="Randomly generated underground city map"
			onpointermove={onMove}
			onpointerleave={() => (hover = null)}
			onclick={onClick}
			style:cursor={gateMode === 'custom' ? 'crosshair' : undefined}
		>
			<defs>
				<pattern id="earth" width="10" height="10" patternUnits="userSpaceOnUse">
					<rect width="10" height="10" fill="#0c0d10" />
					<circle cx="3" cy="4" r="0.7" fill="#15161b" />
					<circle cx="8" cy="9" r="0.5" fill="#121318" />
				</pattern>
				<pattern id="rock" width="8" height="8" patternUnits="userSpaceOnUse">
					<rect width="8" height="8" fill="#1a1b21" />
					<circle cx="2" cy="3" r="0.8" fill="#24262e" />
					<circle cx="6" cy="7" r="0.6" fill="#202229" />
				</pattern>
			</defs>

			<!-- surrounding earth -->
			<rect width={map.width * TILE} height={map.height * TILE} fill="url(#earth)" />

			<!-- excavated city area -->
			<path d={cityPath} fill="url(#rock)" />
			<path d={edgePath} stroke="#5a4a32" stroke-width="1.5" fill="none" />

			<!-- streets -->
			<path d={roadPath} fill="#4b4f5c" />

			<!-- rooms + gates -->
			{#each map.rooms as r (r.id)}
				{@const gate = r.kind === 'gate'}
				<rect
					x={r.x * TILE + 1}
					y={r.y * TILE + 1}
					width={r.w * TILE - 2}
					height={r.h * TILE - 2}
					rx="2"
					fill={gate ? '#0f3a3a' : roomFill(r)}
					stroke={gate ? '#3fd0c9' : '#b8873a'}
					stroke-width={gate ? 1.5 : 1}
					opacity={hoveredRoom && hoveredRoom.id !== r.id ? 0.75 : 1}
				/>
				{@const door = doorRect(r)}
				<rect
					x={door.x}
					y={door.y}
					width={door.w}
					height={door.h}
					fill={gate ? '#7ff5ef' : '#f2c46d'}
				/>
				{#if gate && !r.exit}
					<!-- interior gate: vertical shaft up/down -->
					<text
						x={(r.x + r.w / 2) * TILE}
						y={(r.y + r.h / 2) * TILE + 14}
						text-anchor="middle"
						font-size="11"
						fill="#7ff5ef">⇅</text
					>
				{/if}
				{#if gate && r.exit}
					{@const a = exitArrow(r)}
					<line
						x1={a.sx}
						y1={a.sy}
						x2={a.ex}
						y2={a.ey}
						stroke="#7ff5ef"
						stroke-width="2"
						marker-end="url(#arrow)"
					/>
				{/if}
				{#if gate}
					<text
						x={(r.x + r.w / 2) * TILE}
						y={(r.y + r.h / 2) * TILE + (r.exit ? 3 : 0)}
						text-anchor="middle"
						font-size="8"
						fill="#7ff5ef"
						font-family="monospace">GATE</text
					>
				{/if}
			{/each}

			<defs>
				<marker
					id="arrow"
					viewBox="0 0 10 10"
					refX="5"
					refY="5"
					markerWidth="4"
					markerHeight="4"
					orient="auto-start-reverse"
				>
					<path d="M0 0 L10 5 L0 10 z" fill="#7ff5ef" />
				</marker>
			</defs>

			<!-- hover -->
			{#if hoveredRoom}
				<rect
					x={hoveredRoom.x * TILE}
					y={hoveredRoom.y * TILE}
					width={hoveredRoom.w * TILE}
					height={hoveredRoom.h * TILE}
					fill="none"
					stroke="#e2e8f0"
					stroke-width="1.5"
				/>
				<rect
					x={hoveredRoom.access.x * TILE}
					y={hoveredRoom.access.y * TILE}
					width={TILE}
					height={TILE}
					fill="none"
					stroke="#f2c46d"
					stroke-width="1.5"
					stroke-dasharray="3 2"
				/>
			{:else if hover && hoveredType !== 'void'}
				<rect
					x={hover.x * TILE}
					y={hover.y * TILE}
					width={TILE}
					height={TILE}
					fill="none"
					stroke="#e2e8f0"
					stroke-width="1"
				/>
			{/if}
		</svg>
	</div>

	<footer class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
		<span class="flex items-center gap-2"><span class="h-3 w-3 bg-[#4b4f5c]"></span>Street</span>
		<span class="flex items-center gap-2"
			><span class="h-3 w-3 border border-[#b8873a] bg-[#43321a]"></span>Room (1–5 × 1–5)</span
		>
		<span class="flex items-center gap-2"
			><span class="h-3 w-3 border border-[#3fd0c9] bg-[#0f3a3a]"></span>Gate (4×5 · edge exit → or
			inner shaft ⇅)</span
		>
		<span class="flex items-center gap-2"
			><span class="h-1.5 w-3 bg-[#f2c46d]"></span>Door (single access)</span
		>
		<span class="flex items-center gap-2"><span class="h-3 w-3 bg-[#1a1b21]"></span>Rock</span>
		<span class="ml-auto text-slate-400">
			{#if hoveredRoom}
				{hoveredRoom.kind === 'gate' ? 'Gate' : 'Room'} #{hoveredRoom.id} · {hoveredRoom.w}×{hoveredRoom.h}
				· door ({hoveredRoom.door.x}, {hoveredRoom.door.y}) → road ({hoveredRoom.access.x}, {hoveredRoom
					.access.y})
			{:else if hover && hoveredType && hoveredType !== 'void'}
				({hover.x}, {hover.y}) · {hoveredType === 'road' ? 'street' : hoveredType}
			{:else}
				Hover a tile or room
			{/if}
		</span>
	</footer>
</div>
