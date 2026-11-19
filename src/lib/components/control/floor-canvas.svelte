<script lang="ts">
	import { onMount } from 'svelte';
	import { FACILITY_INFO } from '#lib/hollow/data.js';
	import { ALERT_INFO } from '#lib/hollow/alerts.js';
	import { isActive, type Tile } from '#lib/hollow/events.js';
	import { nearestRoad, tunnelRun } from '#lib/hollow/scenario.js';
	import { STATUS_INFO } from '#lib/hollow/sensors.js';
	import { SICK_STEPS, sickStep, sicknessOf } from '#lib/hollow/sickness.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { cssHex, onThemeChange } from '#lib/hollow/theme.js';
	import { floorBounds } from '#lib/hollow/world.js';
	import { live } from '#lib/live/events.svelte.js';
	import {
		addBlackout,
		addBlockedTunnel,
		control,
		type FacilityTable
	} from './control-state.svelte.js';

	/**
	 * A flat, top-down map of one level with its events drawn on top. Clicking places an
	 * event of the open tab's kind: a blackout, a blocked tunnel, or (air / water) picks the
	 * facility to edit.
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

	/** The air or water facility under a tile, if the open tab edits that kind. */
	function facilityAt(t: Tile) {
		const kind =
			control.tab === 'airQuality' ? 'air' : control.tab === 'waterCuts' ? 'water' : null;
		if (!kind) return null;
		const id = floor.map.roomAt[t.y]?.[t.x] ?? -1;
		return sim.places.find((p) => p.room.id === id && p.kind === kind) ?? null;
	}

	function onclick(e: PointerEvent) {
		const t = tileAt(e);
		if (control.busy) return;
		if (control.tab === 'blackouts') void addBlackout(t.x, t.y);
		else if (control.tab === 'blockedTunnels') {
			const run = runAt(t);
			if (run.length >= 2) void addBlockedTunnel(run);
		} else {
			const p = facilityAt(t);
			if (p) control.facility[control.tab as FacilityTable] = p.key;
		}
	}

	const cursor = $derived.by(() => {
		if (!hover) return 'default';
		if (control.tab === 'blackouts') return 'crosshair';
		if (control.tab === 'blockedTunnels')
			return runAt(hover).length >= 2 ? 'crosshair' : 'not-allowed';
		if (control.tab === 'sickness') return 'default';
		return facilityAt(hover) ? 'pointer' : 'default';
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
			dark: ALERT_INFO.blackout.color,
			blocked: '#f59e0b',
			fg: cssHex('var(--foreground)'),
			bg: cssHex('var(--background)')
		};
		const tab = control.tab;
		const sickness =
			tab === 'sickness' ? sicknessOf(floor, control.sicknessDraft ?? sim.events.sickness) : null;
		const steps = SICK_STEPS.map((st) => cssHex(st.color));
		const focusKey = tab === 'airQuality' || tab === 'waterCuts' ? control.facility[tab] : null;
		const focus = focusKey ? sim.places.find((p) => p.key === focusKey) : null;
		const served = new Set(
			focus ? (sim.impact(focus)?.neighborhoods.flatMap((n) => n.blocks) ?? []) : []
		);

		// Tunnels.
		ctx.fillStyle = col.road;
		ctx.globalAlpha = 0.3;
		const { grid } = floor.map;
		for (let y = 0; y < grid.length; y++)
			for (let x = 0; x < grid[y].length; x++)
				if (grid[y][x] === 'road') ctx.fillRect(px(x), py(y), s + 0.3, s + 0.3);

		// Rooms: housing by power (or sickness), facilities in their colour.
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
			} else if (served.has(r.id)) {
				ctx.globalAlpha = 0.55;
				ctx.fillStyle = cssHex(STATUS_INFO[sim.status(focus!)?.status ?? 'normal'].color);
			} else if (floor.residents[r.id] > 0 && !sim.lit[r.id]) {
				ctx.globalAlpha = 0.55;
				ctx.fillStyle = col.dark;
			} else {
				ctx.globalAlpha = floor.residents[r.id] > 0 ? 0.45 : 0.25;
				ctx.fillStyle = col.room;
			}
			ctx.fillRect(x + 0.25, y + 0.25, Math.max(0.5, w - 0.5), Math.max(0.5, h - 0.5));
		}
		ctx.globalAlpha = 1;

		// Failing air and water facilities get a status ring; the selected one a bold outline.
		for (const p of sim.places) {
			if (p.kind !== 'air' && p.kind !== 'water') continue;
			const st = sim.status(p);
			const cx = px(p.room.x + p.room.w / 2);
			const cy = py(p.room.y + p.room.h / 2);
			if (st && st.status !== 'normal') {
				ctx.strokeStyle = cssHex(STATUS_INFO[st.status].color);
				ctx.lineWidth = 2.5;
				ctx.beginPath();
				ctx.arc(cx, cy, Math.max(p.room.w, p.room.h) * s * 0.5 + 5, 0, Math.PI * 2);
				ctx.stroke();
			}
			if (p.key === focusKey) {
				ctx.strokeStyle = col.fg;
				ctx.lineWidth = 2;
				ctx.strokeRect(px(p.room.x) - 3, py(p.room.y) - 3, p.room.w * s + 6, p.room.h * s + 6);
			}
		}

		// Blackout areas.
		for (const b of sim.local.blackouts) {
			const active = isActive(b);
			ctx.strokeStyle = active ? col.dark : col.room;
			ctx.lineWidth = active ? 1.5 : 1;
			ctx.setLineDash(active ? [] : [4, 4]);
			ctx.beginPath();
			ctx.arc(px(b.x + 0.5), py(b.y + 0.5), b.radius * s, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.setLineDash([]);

		// Blocked tunnels: the tiles, plus a marker so a 2-tile stretch is findable.
		for (const t of sim.local.blockedTunnels) {
			const active = isActive(t);
			ctx.fillStyle = active ? col.blocked : col.room;
			for (const tile of t.tiles) ctx.fillRect(px(tile.x), py(tile.y), s, s);
			const mid = t.tiles[Math.floor(t.tiles.length / 2)];
			ctx.strokeStyle = active ? col.blocked : col.room;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(px(mid.x + 0.5), py(mid.y + 0.5), 7, 0, Math.PI * 2);
			ctx.stroke();
		}

		// What a click would do here.
		if (hover) {
			if (tab === 'blackouts') {
				ctx.strokeStyle = col.dark;
				ctx.setLineDash([3, 3]);
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.arc(px(hover.x + 0.5), py(hover.y + 0.5), control.radius * s, 0, Math.PI * 2);
				ctx.stroke();
				ctx.setLineDash([]);
			} else if (tab === 'blockedTunnels') {
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
		aria-label="Map of the level. Click to place an event."
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
