<script lang="ts">
	import { onMount } from 'svelte';
	import { FACILITY_INFO } from '#lib/hollow/data.js';
	import { CONDITION_STEPS, conditionStep, tunnelWalk } from '#lib/hollow/conditions.js';
	import { POINT_INFO, POINT_KINDS, type PointKind, type Tile } from '#lib/hollow/state.js';
	import { nearestRoad, tunnelRun } from '#lib/hollow/scenario.js';
	import { SICK_STEPS, sickStep, sicknessOf } from '#lib/hollow/sickness.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { cssHex, onThemeChange } from '#lib/hollow/theme.js';
	import { floorBounds } from '#lib/hollow/world.js';
	import { live } from '#lib/live/state.svelte.js';
	import { addBlockedTunnel, addPoint, control, isPointTab } from './control-state.svelte.js';

	/**
	 * A flat, top-down map of one level with its state drawn on top. Clicking places what the
	 * open tab edits: a power, water or air point, or a blocked tunnel.
	 */

	const hollow = getHollow();
	let box: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let size = $state({ w: 0, h: 0 });
	let hover = $state<Tile | null>(null);
	let themeVersion = $state(0);

	const floor = $derived(hollow.floor(control.level));
	const sim = $derived.by(() => {
		void live.version;
		return simulateFloor(floor);
	});

	/** Tile → pixel transform that fits the level's dug area into the canvas. */
	const view = $derived.by(() => {
		const [x0, y0, x1, y1] = floorBounds(floor);
		const bw = x1 - x0 + 1;
		const bh = y1 - y0 + 1;
		const pad = 16;
		const scale = Math.max(0.1, Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh));
		return { x0, y0, scale, ox: (size.w - bw * scale) / 2, oy: (size.h - bh * scale) / 2 };
	});
	const px = (x: number) => view.ox + (x - view.x0) * view.scale;
	const py = (y: number) => view.oy + (y - view.y0) * view.scale;

	function tileAt(e: PointerEvent): Tile {
		const r = canvas.getBoundingClientRect();
		return {
			x: Math.floor((e.clientX - r.left - view.ox) / view.scale + view.x0),
			y: Math.floor((e.clientY - r.top - view.oy) / view.scale + view.y0)
		};
	}

	/** The tunnel stretch a click at `t` would block. */
	const runAt = (t: Tile) => {
		const start = nearestRoad(floor, t.x, t.y);
		return start ? tunnelRun(floor, start, control.tunnelLength) : [];
	};

	function onclick(e: PointerEvent) {
		const t = tileAt(e);
		if (control.busy) return;
		if (isPointTab(control.tab)) void addPoint(control.tab, t.x, t.y);
		else if (control.tab === 'tunnels') {
			const run = runAt(t);
			if (run.length >= 2) void addBlockedTunnel(run);
		}
	}

	const cursor = $derived.by(() => {
		if (!hover) return 'default';
		if (isPointTab(control.tab)) return 'crosshair';
		if (control.tab === 'tunnels') return runAt(hover).length >= 2 ? 'crosshair' : 'not-allowed';
		return 'default';
	});

	function draw() {
		void themeVersion;
		const ctx = canvas?.getContext('2d');
		if (!ctx || !size.w) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(size.w * dpr);
		canvas.height = Math.round(size.h * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, size.w, size.h);

		const s = view.scale;
		const col = {
			road: cssHex('var(--muted-foreground)'),
			room: cssHex('var(--muted-foreground)'),
			blocked: '#f59e0b',
			bg: cssHex('var(--background)')
		};
		const tab = control.tab;
		const kind = isPointTab(tab) ? tab : null;
		const kindColor = Object.fromEntries(
			POINT_KINDS.map((k) => [k, cssHex(POINT_INFO[k].color)])
		) as Record<PointKind, string>;
		const sickness =
			tab === 'sickness' ? sicknessOf(floor, control.sicknessDraft ?? sim.state.sickness) : null;
		const steps = SICK_STEPS.map((st) => cssHex(st.color));
		/** Housing by the open kind's steps (sickness on its tab, power on the tunnels tab). */
		const graded = kind ?? 'power';
		const score = sim.score(graded);
		const stepColors = CONDITION_STEPS[graded].map((st) => cssHex(st.color));

		// Tunnels.
		ctx.fillStyle = col.road;
		ctx.globalAlpha = 0.3;
		const { grid } = floor.map;
		for (let y = 0; y < grid.length; y++)
			for (let x = 0; x < grid[y].length; x++)
				if (grid[y][x] === 'road') ctx.fillRect(px(x), py(y), s + 0.3, s + 0.3);

		// Rooms: housing bad for the open kind (or by sickness), facilities in their colour.
		for (const r of floor.map.rooms) {
			const spec = floor.facilities.get(r.id);
			const x = px(r.x);
			const y = py(r.y);
			const w = r.w * s;
			const h = r.h * s;
			if (spec) {
				ctx.globalAlpha = 1;
				ctx.fillStyle = cssHex(FACILITY_INFO[spec.kind].color);
				ctx.fillRect(x, y, w, h);
				continue;
			}
			if (sickness?.[r.id]) {
				ctx.globalAlpha = 0.95;
				ctx.fillStyle = steps[sickStep(sickness[r.id]!.score)];
			} else if (!sickness && score[r.id] !== null && (kind || conditionStep(score[r.id]!) >= 3)) {
				// Point tabs: every step; the tunnels tab: only bad power, faintly.
				ctx.globalAlpha = kind ? 0.95 : 0.55;
				ctx.fillStyle = stepColors[conditionStep(score[r.id]!)];
			} else {
				ctx.globalAlpha = floor.residents[r.id] > 0 ? 0.45 : 0.25;
				ctx.fillStyle = col.room;
			}
			ctx.fillRect(x + 0.25, y + 0.25, Math.max(0.5, w - 0.5), Math.max(0.5, h - 0.5));
		}
		ctx.globalAlpha = 1;

		// Points: the open kind's bold (air with its radius), the others small and faint.
		for (const p of sim.local.points) {
			const mine = p.kind === kind;
			const cx = px(p.x + 0.5);
			const cy = py(p.y + 0.5);
			ctx.globalAlpha = mine ? 1 : 0.35;
			if (mine && POINT_INFO[p.kind].spread === 'area') {
				ctx.strokeStyle = kindColor[p.kind];
				ctx.lineWidth = 1.25;
				ctx.setLineDash([4, 4]);
				ctx.beginPath();
				ctx.arc(cx, cy, p.radius * s, 0, Math.PI * 2);
				ctx.stroke();
				ctx.setLineDash([]);
			}
			ctx.fillStyle = kindColor[p.kind];
			ctx.strokeStyle = col.bg;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(cx, cy, mine ? 3 + 3 * (p.strength ?? 1) : 2.5, 0, Math.PI * 2);
			ctx.fill();
			if (mine) ctx.stroke();
		}
		ctx.globalAlpha = 1;

		// Blocked tunnels: the tiles, plus a marker so a 2-tile stretch is findable.
		ctx.fillStyle = col.blocked;
		ctx.strokeStyle = col.blocked;
		ctx.lineWidth = 1.5;
		for (const t of sim.local.blockedTunnels) {
			for (const tile of t.tiles) ctx.fillRect(px(tile.x), py(tile.y), s, s);
			const mid = t.tiles[Math.floor(t.tiles.length / 2)];
			ctx.beginPath();
			ctx.arc(px(mid.x + 0.5), py(mid.y + 0.5), 7, 0, Math.PI * 2);
			ctx.stroke();
		}

		// What a click would do here.
		if (hover) {
			if (kind && POINT_INFO[kind].spread === 'area') {
				ctx.strokeStyle = kindColor[kind];
				ctx.setLineDash([3, 3]);
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.arc(px(hover.x + 0.5), py(hover.y + 0.5), control.radius * s, 0, Math.PI * 2);
				ctx.stroke();
				ctx.setLineDash([]);
			} else if (kind) {
				// Tunnel kinds: light up the tunnels a new point here would reach.
				const walk = tunnelWalk(floor, hover.x, hover.y);
				if (walk) {
					const { width } = floor.map;
					ctx.fillStyle = kindColor[kind];
					ctx.globalAlpha = 0.55;
					walk.dist.forEach((d, i) => {
						if (d < 0 || d > control.radius) return;
						const x = i % width;
						ctx.fillRect(px(x), py((i - x) / width), s, s);
					});
					ctx.globalAlpha = 1;
				}
			} else if (tab === 'tunnels') {
				ctx.globalAlpha = 0.7;
				ctx.fillStyle = col.blocked;
				for (const t of runAt(hover)) ctx.fillRect(px(t.x), py(t.y), s, s);
				ctx.globalAlpha = 1;
			}
		}
	}

	$effect(draw);

	onMount(() => {
		const ro = new ResizeObserver(([e]) => {
			size = { w: e.contentRect.width, h: e.contentRect.height };
		});
		ro.observe(box);
		const off = onThemeChange(() => themeVersion++);
		return () => {
			ro.disconnect();
			off();
		};
	});
</script>

<div bind:this={box} class="relative h-full w-full overflow-hidden">
	<canvas
		bind:this={canvas}
		class="absolute inset-0 h-full w-full"
		style="cursor:{cursor}"
		aria-label="Map of the level. Click to place a point or block a tunnel."
		onpointermove={(e) => (hover = tileAt(e))}
		onpointerleave={() => (hover = null)}
		onpointerdown={onclick}
	></canvas>
	{#if hover}
		<span
			class="pointer-events-none absolute bottom-2 left-2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
			>{hover.x}, {hover.y}</span
		>
	{/if}
</div>
