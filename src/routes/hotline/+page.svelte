<script lang="ts">
	import { onMount } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { resolve } from '$app/paths';
	import { cubicOut } from 'svelte/easing';
	import {
		ALERT_INFO,
		CAT_INFO,
		LEVEL_COUNT,
		alertLevel,
		buildReport,
		callerText,
		extract,
		findKeywords,
		hottestBand,
		levelRisk,
		type Category,
		type Line,
		type Report
	} from '#lib/hotline/engine.js';
	import { DEMO_CALL } from '#lib/hotline/seed.js';
	import HotlineMap from '#lib/hotline/HotlineMap.svelte';
	import { buildWaterLetter, type WaterLetter } from '#lib/hotline/letter.js';
	import MailIcon from '@lucide/svelte/icons/mail';
	import SendIcon from '@lucide/svelte/icons/send';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { planTasks, type Task } from '#lib/hotline/dispatch.js';
	import BotIcon from '@lucide/svelte/icons/bot';
	import TruckIcon from '@lucide/svelte/icons/truck';
	import RouteIcon from '@lucide/svelte/icons/route';
	import { buildings, type Building } from '#lib/hotline/places.js';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import PlayIcon from '@lucide/svelte/icons/play';

	const HOTLINE = import.meta.env.VITE_HOTLINE_NUMBER || 'Hotline number not set';

	/** Reports already counted in the scores on screen. */
	let shown = $state.raw<Report[]>([]);
	/** The call being played back right now. */
	let live = $state<{ report: Report; lines: Line[]; typing: string; stage: number } | null>(null);
	let lastCall = $state.raw<{ report: Report; before: number; after: number } | null>(null);
	let connected = $state(false);
	let heatCat = $state<Category>('lungs');
	let flashLevel = $state<number | null>(null);
	/** Level (1-based) the map is zoomed into while a caller talks about it. */
	let focusLevel = $state<number | null>(null);
	/** Building the caller named, once we know it. */
	let focusBuilding = $state.raw<Building | null>(null);
	const RADAR_RADIUS = 45;
	const reportsAt = (key: string) => shown.filter((r) => r.building?.key === key).length;
	const radarTarget = $derived(
		focusBuilding ? { building: focusBuilding, count: reportsAt(focusBuilding.key) } : null
	);
	const radarHits = $derived.by(() => {
		const b = focusBuilding;
		if (!b) return [];
		return (buildings()[b.level - 1] ?? [])
			.filter((o) => o.key !== b.key && Math.hypot(o.x - b.x, o.y - b.y) <= RADAR_RADIUS)
			.map((o) => ({ building: o, count: reportsAt(o.key) }))
			.filter((h) => h.count > 0);
	});

	const outbreak = $derived(hottestBand(shown, 'lungs'));
	const water = $derived(hottestBand(shown, 'water'));
	const heatBand = $derived(hottestBand(shown, heatCat));
	const levelHeat = $derived(
		Array.from({ length: LEVEL_COUNT }, (_, i) => {
			const risk = levelRisk(shown, heatCat, i + 1);
			return { risk, color: heat(risk) };
		})
	);
	const waterHeat = $derived(
		Array.from({ length: LEVEL_COUNT }, (_, i) => {
			const risk = levelRisk(shown, 'water', i + 1);
			return { risk, color: heat(risk) };
		})
	);
	const headline = new Tween(0, { duration: 1800, easing: cubicOut });
	$effect(() => {
		headline.target = outbreak.risk;
	});
	const headLevel = $derived(alertLevel(headline.current));
	const recent = $derived(shown.filter((r) => Date.now() - r.t < 6 * 3_600_000).length);

	// ── Playback queue ──────────────────────────────────────────────────────
	const queue: Report[] = [];
	let playing = $state(false);
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	async function play(report: Report) {
		tasks = [];
		activeTask = null;
		agent = 'listening';
		showSide('why');
		live = { report, lines: [], typing: '', stage: 0 };
		// Real calls already happened, so replay them a bit faster than the stage demo.
		const PACE = report.source === 'phone' ? 0.6 : 1;
		for (const line of report.transcript) {
			if (line.role === 'agent') {
				live.lines.push(line);
				// Hold each agent line long enough to read it out loud.
				await sleep(PACE * (1500 + line.text.length * 45));
			} else {
				// The caller "speaks" at about talking speed.
				for (let i = 1; i <= line.text.length; i++) {
					live.typing = line.text.slice(0, i);
					await sleep(PACE * 40);
				}
				live.typing = '';
				live.lines.push(line);
				// As soon as the caller names their level, fly the map into it.
				// Then, if they named a building, the map flies to it and runs the radar.
				if (focusLevel === null || !focusBuilding) {
					const said = extract(callerText(live.lines));
					if (focusLevel === null && !said.levelGuessed) focusLevel = said.level;
					if (!focusBuilding && said.building) focusBuilding = said.building;
				}
				await sleep(PACE * (1200 + line.text.length * 15));
			}
		}
		focusLevel ??= report.level;
		focusBuilding ??= report.building;
		// Reveal: extracted fields, then the math, then the score moves.
		for (let s = 1; s <= 3; s++) {
			live.stage = s;
			await sleep(900);
		}
		const before = outbreak.risk;
		shown = [...shown, report];
		lastCall = { report, before, after: hottestBand(shown, 'lungs').risk };
		flashLevel = report.level;
		setTimeout(() => (flashLevel = null), 2500);
		// Dash Agent works out supply runs from what the caller said.
		agent = 'planning';
		await sleep(1600);
		const planned = planTasks(report, hottestBand(shown, 'lungs'));
		tasks = planned;
		agent = planned.length ? 'ready' : 'idle';
		if (planned.length) showSide('dash');
		const letter = buildWaterLetter(report, shown, RADAR_RADIUS);
		if (letter) {
			waterLetter = letter;
			letterSent = null;
			letterSubject = letter.subject;
			letterBody = letter.summary;
		}
		if (planned.length) return; // Stay on this level until the coordinator closes the runs.
		await sleep(5000);
		closeTasks();
		await sleep(1200);
	}

	// ── Side tabs ───────────────────────────────────────────────────────────
	type SideTab = 'why' | 'dash' | 'water';
	let sideTab = $state<SideTab>('why');
	const SIDE_TABS: { id: SideTab; label: string; color: string }[] = [
		{ id: 'why', label: 'WHY THIS CALL', color: '#ef4444' },
		{ id: 'dash', label: 'DASH AGENT', color: '#ef4444' }
	];

	// ── Dash Agent ──────────────────────────────────────────────────────────
	let agent = $state<'idle' | 'listening' | 'planning' | 'ready'>('idle');
	let tasks = $state.raw<Task[]>([]);
	let activeTask = $state<string | null>(null);
	let approved = $state<Record<string, boolean>>({});
	const active = $derived(tasks.find((t) => t.id === activeTask) ?? null);
	const pendingTasks = $derived(tasks.filter((t) => !approved[t.id]).length);

	/** The map's Water toggle is the water feature: water heat map, blue radar, the letter. */
	function showHeat(c: Category) {
		heatCat = c;
		if (c === 'water') sideTab = 'water';
		else if (sideTab === 'water') sideTab = tasks.length ? 'dash' : 'why';
	}
	function showSide(t: SideTab) {
		sideTab = t;
		if (heatCat === 'water') heatCat = 'lungs';
	}

	// ── Contact Agent (water letter) ────────────────────────────────────────
	let waterLetter = $state.raw<WaterLetter | null>(null);
	let letterSent = $state<string | null>(null);
	/** The human's edits; sent instead of the draft. */
	let letterSubject = $state('');
	let letterBody = $state('');
	/** The quote split around its water keywords, for highlighting. */
	function quoteParts(L: WaterLetter) {
		const out: { text: string; kw: boolean }[] = [];
		let rest = L.quote;
		for (const k of L.keywords) {
			const i = rest.indexOf(k);
			if (i < 0) continue;
			if (i) out.push({ text: rest.slice(0, i), kw: false });
			out.push({ text: k, kw: true });
			rest = rest.slice(i + k.length);
		}
		if (rest) out.push({ text: rest, kw: false });
		return out;
	}

	function closeTasks() {
		tasks = [];
		activeTask = null;
		agent = 'idle';
		// Back out to all levels so the room sees the whole Hollow update.
		focusLevel = null;
		focusBuilding = null;
	}

	async function drain() {
		if (playing) return;
		playing = true;
		while (queue.length) await play(queue.shift()!);
		playing = false;
	}

	function receive(report: Report) {
		if (shown.some((r) => r.id === report.id) || queue.some((r) => r.id === report.id)) return;
		queue.push(report);
		drain();
	}

	// ── Controls ────────────────────────────────────────────────────────────
	async function simulate() {
		try {
			const res = await fetch('/api/hotline/report', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ transcript: DEMO_CALL })
			});
			if (!res.ok) throw new Error();
			if (!connected) receive(await res.json());
		} catch {
			// Offline fallback: score it right here so the demo still works.
			receive(buildReport({ transcript: DEMO_CALL, source: 'simulated' }, shown));
		}
	}

	async function reset() {
		await fetch('/api/hotline/report', { method: 'DELETE' }).catch(() => {});
		live = null;
		lastCall = null;
		approved = {};
		waterLetter = null;
		letterSent = null;
		closeTasks();
	}

	onMount(() => {
		const es = new EventSource('/api/hotline/events');
		es.onopen = () => (connected = true);
		es.onerror = () => (connected = false);
		es.onmessage = (m) => {
			const e = JSON.parse(m.data);
			if (e.type === 'snapshot') {
				queue.length = 0;
				shown = e.reports;
				headline.set(hottestBand(shown, 'lungs').risk, { duration: 0 });
			} else if (e.type === 'report') receive(e.report);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement) return;
			if (e.key === 'd') simulate();
			if (e.key === 'r') reset();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			es.close();
			window.removeEventListener('keydown', onKey);
		};
	});

	// ── Helpers ─────────────────────────────────────────────────────────────
	function heat(risk: number) {
		// green → yellow → orange → red
		const stops = [
			[0, [34, 197, 94]],
			[40, [234, 179, 8]],
			[60, [249, 115, 22]],
			[80, [239, 68, 68]],
			[100, [190, 18, 60]]
		] as const;
		for (let i = 1; i < stops.length; i++) {
			const [p1, c1] = stops[i];
			const [p0, c0] = stops[i - 1];
			if (risk <= p1) {
				const k = (risk - p0) / (p1 - p0);
				return (
					'#' +
					c0
						.map((c, j) =>
							Math.round(c + (c1[j] - c) * k)
								.toString(16)
								.padStart(2, '0')
						)
						.join('')
				);
			}
		}
		return '#be123c';
	}

	function segments(text: string) {
		const out: { text: string; cat?: Category }[] = [];
		let at = 0;
		for (const m of findKeywords(text)) {
			if (m.start > at) out.push({ text: text.slice(at, m.start) });
			out.push({ text: text.slice(m.start, m.end), cat: m.cat });
			at = m.end;
		}
		if (at < text.length) out.push({ text: text.slice(at) });
		return out;
	}

	const fmt = (n: number) => n.toFixed(n % 1 ? 2 : 1).replace(/\.?0+$/, '');
</script>

<svelte:head><title>Hollow Hotline · Live</title></svelte:head>

{#snippet highlighted(text: string)}
	{#each segments(text) as s, i (i)}
		{#if s.cat}
			<mark
				class="rounded px-0.5 font-semibold text-white"
				style="background:{CAT_INFO[s.cat].color}cc;box-shadow:0 0 12px {CAT_INFO[s.cat].color}88"
				>{s.text}</mark
			>
		{:else}{s.text}{/if}
	{/each}
{/snippet}

<div class="flex h-screen flex-col overflow-hidden bg-[#070a12] text-slate-200">
	<!-- Header -->
	<header class="flex items-center justify-between border-b border-white/10 px-6 py-3">
		<div class="flex items-center gap-3">
			<a
				href={resolve('/')}
				class="mr-2 rounded-full border border-white/15 px-3 py-1 text-xs text-slate-300 hover:bg-white/5"
				>← Map</a
			>
			<span class="relative flex size-3">
				<span class="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75"
				></span>
				<span class="relative inline-flex size-3 rounded-full bg-red-500"></span>
			</span>
			<h1 class="text-lg font-bold tracking-[0.2em] text-white">HOLLOW HOTLINE</h1>
			<span class="text-xs tracking-widest text-slate-500">LIVE</span>
		</div>
		<div
			class="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-1.5"
		>
			<PhoneIcon class="size-4 text-emerald-400" />
			<span class="font-mono text-lg font-semibold text-emerald-300">{HOTLINE}</span>
		</div>
		<div class="flex items-center gap-4 text-xs text-slate-400">
			<span>{shown.length} reports · {recent} in last 6 h</span>
			<span class="flex items-center gap-1.5">
				<span class="size-2 rounded-full {connected ? 'bg-emerald-400' : 'bg-slate-600'}"></span>
				{connected ? 'Server live' : 'Offline mode'}
			</span>
		</div>
	</header>

	<main
		class="grid min-h-0 flex-1 gap-4 p-4"
		style="grid-template-columns:{sideTab === 'water'
			? 'minmax(0,0.8fr) minmax(0,1.9fr)'
			: 'minmax(0,0.9fr) minmax(0,1.6fr) minmax(0,0.85fr)'}"
	>
		<!-- Left: live transcript -->
		<section class="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.02]">
			<div class="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
				<h2 class="text-xs font-bold tracking-widest text-slate-400">LIVE TRANSCRIPT</h2>
				{#if live}
					<span class="flex items-center gap-1.5 text-xs text-red-400">
						<span class="size-1.5 animate-pulse rounded-full bg-red-500"></span>
						{live.report.source === 'phone' ? 'Incoming call' : 'Simulated call'}
					</span>
				{/if}
			</div>
			<div class="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto p-4">
				<div class="space-y-2.5">
					{#if !live}
						<div class="grid h-64 place-items-center text-center text-sm text-slate-500">
							<div>
								<PhoneIcon class="mx-auto mb-3 size-8 opacity-40" />
								Waiting for a call…<br />
								<span class="text-xs">Anonymous. No app. Works when the network is down.</span>
							</div>
						</div>
					{:else}
						{#each live.lines as l, i (i)}
							<div
								class="animate-in duration-300 fade-in slide-in-from-bottom-2 {l.role === 'caller'
									? 'ml-6'
									: 'mr-6'}"
							>
								<p
									class="mb-0.5 text-[10px] font-bold tracking-widest {l.role === 'caller'
										? 'text-right text-sky-300/70'
										: 'text-violet-300/70'}"
								>
									{l.role === 'caller' ? 'CALLER' : 'WARDEN LINE'}
								</p>
								<p
									class="rounded-xl px-3 py-2 text-sm leading-relaxed {l.role === 'caller'
										? 'rounded-tr-sm bg-sky-500/10 text-slate-100'
										: 'rounded-tl-sm bg-violet-500/10 text-slate-300'}"
								>
									{#if l.role === 'caller'}{@render highlighted(l.text)}{:else}{l.text}{/if}
								</p>
							</div>
						{/each}
						{#if live.typing}
							<div class="ml-6">
								<p class="mb-0.5 text-right text-[10px] font-bold tracking-widest text-sky-300/70">
									CALLER
								</p>
								<p
									class="rounded-xl rounded-tr-sm bg-sky-500/10 px-3 py-2 text-sm leading-relaxed text-slate-100"
								>
									{@render highlighted(live.typing)}<span class="ml-0.5 animate-pulse">▍</span>
								</p>
							</div>
						{/if}
					{/if}
				</div>
			</div>
			<!-- Extracted fields -->
			{#if live && live.stage >= 1}
				{@const r = live.report}
				<div
					class="grid animate-in grid-cols-4 gap-2 border-t border-white/10 p-3 text-center duration-500 fade-in slide-in-from-bottom-4"
				>
					<div class="rounded-lg bg-white/5 p-2">
						<p class="text-[10px] text-slate-500">LEVEL</p>
						<p class="text-lg font-bold text-white">{r.level}</p>
						{#if r.building}<p class="truncate text-[10px] text-amber-300">
								{r.building.label}
							</p>{/if}
					</div>
					<div class="rounded-lg bg-white/5 p-2">
						<p class="text-[10px] text-slate-500">CALLER</p>
						<p class="truncate text-sm font-bold text-white">
							{r.anonymous ? 'Anonymous' : r.name}
						</p>
					</div>
					<div class="rounded-lg bg-white/5 p-2">
						<p class="text-[10px] text-slate-500">AFFECTED</p>
						<p class="text-lg font-bold text-white">{r.people}</p>
					</div>
					<div class="flex flex-wrap content-center justify-center gap-1 rounded-lg bg-white/5 p-2">
						{#each r.categories as c (c)}
							<span
								class="rounded px-1.5 text-[10px] font-bold text-white"
								style="background:{CAT_INFO[c].color}">{CAT_INFO[c].label}</span
							>
						{/each}
					</div>
				</div>
			{/if}
		</section>

		<!-- Center: level heat map -->
		<section
			class="relative flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.02]"
			class:hidden={sideTab === 'water'}
		>
			<div class="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
				<h2 class="text-xs font-bold tracking-widest text-slate-400">RISK BY LEVEL</h2>
				<div class="flex gap-1">
					{#each ['lungs', 'water'] as const as c (c)}
						<button
							onclick={() => showHeat(c)}
							class="relative rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition {heatCat ===
							c
								? 'text-white'
								: 'text-slate-500 hover:text-slate-300'}"
							style={heatCat === c ? `background:${CAT_INFO[c].color}` : ''}
						>
							{CAT_INFO[c].score}
							{#if c === 'water' && waterLetter && !letterSent}
								<span
									class="absolute -top-2 -right-2 grid size-4 animate-pulse place-items-center rounded-full bg-blue-500 text-[9px] font-black text-white ring-2 ring-[#070a12]"
									>1</span
								>
							{/if}
						</button>
					{/each}
				</div>
			</div>
			<div class="relative min-h-0 flex-1">
				<HotlineMap
					levels={levelHeat}
					flash={flashLevel === null ? null : flashLevel - 1}
					focus={focusLevel === null ? null : focusLevel - 1}
					target={active && sideTab !== 'water' ? null : radarTarget}
					radar={radarHits}
					radius={RADAR_RADIUS}
					radarColor={sideTab === 'water' ? '#3b82f6' : '#34d399'}
					route={sideTab === 'water' ? null : (active?.draw ?? null)}
					band={heatBand.risk >= 40 ? heatBand : null}
				/>
				<p
					class="pointer-events-none absolute top-3 left-4 text-[10px] tracking-[0.3em] text-slate-500"
				>
					▲ SURFACE · ALL LEVELS
				</p>

				<!-- Agents: badges only; their details live in the side tabs -->
				<div class="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
					<button
						onclick={() => showSide('dash')}
						class="relative flex items-center gap-2.5 rounded-full border bg-black/80 py-1.5 pr-4 pl-1.5 text-left backdrop-blur transition-colors {agent ===
						'ready'
							? 'border-violet-400/70 shadow-[0_0_24px_-6px_#8b5cf6]'
							: 'border-white/15 hover:border-white/30'}"
					>
						<span
							class="relative grid size-8 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600"
						>
							<BotIcon class="size-4.5 text-white" />
							{#if agent === 'listening' || agent === 'planning'}
								<span
									class="absolute -inset-1 animate-ping rounded-full border-2 border-violet-400/70"
								></span>
							{/if}
						</span>
						<div class="leading-tight">
							<p class="text-[11px] font-black tracking-[0.2em] text-white">DASH AGENT</p>
							<p class="text-[10px] text-violet-200/80">
								{agent === 'listening'
									? 'Listening to the call…'
									: agent === 'planning'
										? 'Planning supply runs…'
										: pendingTasks
											? 'Tap to review'
											: 'Standing by'}
							</p>
						</div>
						{#if pendingTasks}
							<span
								class="absolute -top-1.5 -right-1.5 grid size-5 animate-in place-items-center rounded-full bg-red-500 text-[11px] font-black text-white ring-2 ring-black duration-300 zoom-in-50"
								>{pendingTasks}</span
							>
						{/if}
					</button>
				</div>
			</div>
			<div
				class="flex justify-center gap-4 border-t border-white/10 px-4 py-2 text-[10px] text-slate-500"
			>
				{#each Object.values(ALERT_INFO) as a (a.label)}
					<span class="flex items-center gap-1"
						><span class="size-2 rounded-full" style="background:{a.color}"></span>{a.label}</span
					>
				{/each}
			</div>
		</section>

		<!-- Right: headline score + why it moved -->
		<section class="flex min-h-0 flex-col gap-4">
			{#if sideTab !== 'water'}
				<div
					class="relative overflow-hidden rounded-2xl border-2 p-5 transition-colors duration-1000"
					style="border-color:{ALERT_INFO[headLevel]
						.color};background:radial-gradient(circle at 70% 0%, {ALERT_INFO[headLevel]
						.color}33, transparent 70%)"
				>
					<p class="text-xs font-bold tracking-widest text-slate-400">OUTBREAK RISK</p>
					<p class="text-xs text-slate-500">
						Levels {outbreak.lo} to {outbreak.hi} · lung sickness
					</p>
					<p
						class="mt-2 font-mono text-8xl leading-none font-black tabular-nums"
						style="color:{ALERT_INFO[headLevel].color};text-shadow:0 0 40px {ALERT_INFO[headLevel]
							.color}88"
					>
						{Math.floor(headline.current)}<span class="text-5xl">%</span>
					</p>
					<div class="mt-3 flex items-center justify-between">
						<span
							class="rounded-full px-3 py-1 text-xs font-bold text-white"
							style="background:{ALERT_INFO[headLevel].color}">{ALERT_INFO[headLevel].label}</span
						>
						{#if lastCall}
							<span
								class="animate-in text-sm font-bold text-white duration-700 fade-in slide-in-from-bottom-2"
							>
								{Math.floor(lastCall.before)}% → {Math.floor(lastCall.after)}%
							</span>
						{/if}
					</div>
					<div class="mt-4 grid grid-cols-2 gap-2">
						<div class="rounded-lg bg-black/30 p-2">
							<p class="text-[10px] tracking-wider text-slate-500">
								WATER · L{water.lo}–{water.hi}
							</p>
							<p
								class="font-mono text-2xl font-bold"
								style="color:{ALERT_INFO[alertLevel(water.risk)].color}"
							>
								{Math.floor(water.risk)}%
							</p>
						</div>
						<div class="rounded-lg bg-black/30 p-2">
							<p class="text-[10px] tracking-wider text-slate-500">CALLS · LAST 6 H</p>
							<p class="font-mono text-2xl font-bold text-white">{recent}</p>
						</div>
					</div>
				</div>
			{/if}

			<!-- Side tabs: why the call counted, and the Dash Agent's supply runs -->
			<div class="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.02]">
				{#if sideTab !== 'water'}
					<div class="flex gap-1 border-b border-white/10 p-1.5">
						{#each SIDE_TABS as t (t.id)}
							{@const count =
								t.id === 'dash'
									? pendingTasks
									: t.id === 'water'
										? waterLetter && !letterSent
											? 1
											: 0
										: 0}
							<button
								onclick={() => showSide(t.id)}
								class="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold tracking-wider transition {sideTab ===
								t.id
									? 'bg-white/10 text-white'
									: 'text-slate-500 hover:text-slate-300'}"
							>
								{#if t.id === 'dash'}
									<span
										class="grid size-5 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600"
										><BotIcon class="size-3 text-white" /></span
									>
								{/if}
								{t.label}
								{#if count}
									<span
										class="grid min-w-4 place-items-center rounded-full px-1 text-[10px] text-white"
										style="background:{t.color}">{count}</span
									>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
				<div
					class="min-h-0 flex-1 p-4 {sideTab === 'water'
						? 'flex flex-col overflow-hidden'
						: 'overflow-y-auto'}"
				>
					{#if sideTab === 'why'}
						{#if live && live.stage >= 2}
							{@const r = live.report}
							{@const near = r.nearby.lungs ?? 0}
							<div class="space-y-2 font-mono text-sm">
								{#each [['Severity', fmt(r.severity), r.severity >= 2 ? 'trouble breathing / fever' : r.severity > 1 ? '2+ symptoms' : '1 symptom'], ['Household', fmt(r.household), `${r.people} ${r.people === 1 ? 'person' : 'people'}`], ['Recency', fmt(r.recency), 'just now'], ['Cluster', `1 + ${fmt(Math.min(2, near * 0.25))}`, `${near} lung reports within 2 levels`]] as row, i (row[0])}
									<div
										class="flex animate-in items-center gap-3 duration-500 fade-in slide-in-from-right-4"
										style="animation-delay:{i * 150}ms;animation-fill-mode:both"
									>
										<span class="w-5 text-slate-600">{i ? '×' : ''}</span>
										<span class="w-20 text-slate-400">{row[0]}</span>
										<span class="w-20 text-lg font-bold whitespace-nowrap text-white">{row[1]}</span
										>
										<span class="text-xs text-slate-500">{row[2]}</span>
									</div>
								{/each}
								<div
									class="mt-2 flex animate-in items-center gap-3 border-t border-white/10 pt-2 duration-500 fade-in"
									style="animation-delay:700ms;animation-fill-mode:both"
								>
									<span class="w-5 text-slate-600">=</span>
									<span class="w-20 text-slate-400">Points</span>
									<span class="text-2xl font-black text-red-400"
										>{fmt(Math.round((r.points.lungs ?? 0) * 100) / 100)}</span
									>
								</div>
							</div>
							{#if near > 0}
								<p
									class="mt-4 animate-in rounded-lg bg-red-500/10 p-3 text-sm leading-snug text-red-200 duration-700 fade-in"
									style="animation-delay:1000ms;animation-fill-mode:both"
								>
									This call landed right next to existing lung reports, so it counted for more. One
									voice can tip a warning.
								</p>
							{/if}
						{:else}
							<p class="text-sm leading-relaxed text-slate-500">
								Every call is weighted by how serious it is, how many people it affects, and how
								close it lands to other reports. A call next to an existing cluster counts for more.
							</p>
							<p class="mt-3 font-mono text-xs text-slate-600">
								risk = 100 × (1 − e^(−points / 20))
							</p>
						{/if}
					{:else if sideTab === 'dash'}
						{#if !tasks.length}
							<p class="text-sm leading-relaxed text-slate-500">
								After each call the Dash Agent plans supply runs: restocking clinics on a level with
								an outbreak, and doorstep deliveries for callers who can't reach a clinic. A person
								approves every run.
							</p>
						{/if}
						<div class="space-y-3">
							{#each tasks as t, i (t.id)}
								{@const done = approved[t.id]}
								{@const open = activeTask === t.id}
								<div
									class="animate-in overflow-hidden rounded-xl border duration-500 fill-mode-both fade-in slide-in-from-right-4 {open
										? 'border-sky-400/70'
										: t.kind === 'clinics'
											? 'border-red-500/50'
											: 'border-amber-400/50'}"
									style="animation-delay:{i * 200}ms"
								>
									<div
										class="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold tracking-widest text-white {t.kind ===
										'clinics'
											? 'bg-red-500/70'
											: 'bg-amber-500/70'}"
									>
										<TruckIcon class="size-3.5" />
										{t.kind === 'clinics' ? 'OUTBREAK · RESUPPLY CLINICS' : 'DOORSTEP DELIVERY'}
										{#if t.minutes !== null}<span class="ml-auto font-mono">~{t.minutes} min</span
											>{/if}
									</div>
									<div class="space-y-2 p-3">
										<p class="text-sm leading-snug font-semibold text-white">{t.title}</p>
										<p class="text-xs leading-snug text-slate-400">{t.body}</p>
										<div class="flex gap-2">
											<button
												onclick={() => (activeTask = open ? null : t.id)}
												disabled={!t.draw}
												class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-40 {open
													? 'border-sky-400 bg-sky-500/20 text-sky-200'
													: 'border-white/20 text-slate-200 hover:bg-white/10'}"
											>
												<RouteIcon class="size-3.5" />
												{open ? 'Hide route' : 'Show route'}
											</button>
											<button
												onclick={() => (approved[t.id] = true)}
												disabled={done}
												class="flex-1 rounded-full px-3 py-1 text-xs font-bold transition {done
													? 'bg-emerald-500/20 text-emerald-300'
													: 'bg-violet-600 text-white hover:bg-violet-500'}"
											>
												{done ? `Dispatched ✓ ETA ${t.minutes ?? '?'} min` : 'Approve dispatch'}
											</button>
										</div>
										{#if open}
											<div
												class="flex animate-in items-start justify-between gap-2 border-t border-white/10 pt-2 duration-300 fade-in"
											>
												<div>
													<p class="text-[10px] font-bold tracking-widest text-sky-300">
														DIRECTIONS
													</p>
													<p class="text-sm font-semibold text-white">
														{t.from.label} → {t.steps.at(-1)?.text.replace('Arrive at ', '') ??
															t.to.label}
													</p>
												</div>
												{#if t.minutes !== null}
													<span
														class="shrink-0 rounded-full bg-sky-500/20 px-2 py-0.5 font-mono text-xs font-bold text-sky-200"
														>{t.minutes} min</span
													>
												{/if}
											</div>
										{/if}
									</div>
								</div>
							{/each}
						</div>
						{#if tasks.length}
							<button
								onclick={closeTasks}
								class="mt-3 w-full rounded-full border border-white/15 py-1.5 text-xs text-slate-300 hover:bg-white/5"
								>Done, back to all levels</button
							>
						{/if}
					{:else if sideTab === 'water'}
						{#if !waterLetter}
							<div class="flex items-center justify-between gap-2">
								<p class="text-[11px] font-black tracking-[0.2em] text-white">CONTACT AGENT</p>
								<button
									onclick={() => showHeat('lungs')}
									class="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-300 hover:bg-white/5"
									>← Back to outbreak</button
								>
							</div>
							<div
								class="mt-4 rounded-xl border-2 border-amber-400/70 bg-amber-400/10 p-4 shadow-[0_0_30px_-10px_#fbbf24]"
								role="status"
							>
								<p class="text-sm font-bold text-amber-200">
									{live ? 'Call in progress…' : 'No water report yet'}
								</p>
								<p class="mt-1 text-sm leading-relaxed text-amber-100/90">
									Wait for the call to finish, then come back here. Once the conversation is done,
									the Contact Agent gathers what the caller said about the water and drafts a letter
									to the water infrastructure team, with the evidence and a radar map of affected
									residents.
								</p>
								<p class="mt-2 text-xs text-amber-200/70">
									Tip: press D to run the demo call, or Simulate call at the bottom.
								</p>
							</div>
						{:else}
							{@const L = waterLetter}
							<div class="mb-3 flex items-center gap-2">
								<span
									class="grid size-7 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-blue-700"
								>
									<MailIcon class="size-3.5 text-white" />
								</span>
								<div class="leading-tight">
									<p class="text-[11px] font-black tracking-[0.2em] text-white">CONTACT AGENT</p>
									<p class="text-[10px] text-sky-200/80">Draft letter · needs your approval</p>
								</div>
								<button
									onclick={() => showHeat('lungs')}
									class="ml-auto rounded-full border border-white/15 px-3 py-1 text-xs text-slate-300 hover:bg-white/5"
									>← Back to outbreak</button
								>
							</div>

							<div
								class="flex min-h-0 flex-1 animate-in flex-col overflow-hidden rounded-xl border border-sky-400/40 bg-slate-950/80 duration-500 fade-in slide-in-from-right-4"
							>
								<div class="space-y-0.5 border-b border-white/10 px-3 py-2 text-[11px]">
									<p class="flex flex-wrap gap-x-4">
										<span
											><span class="text-slate-500">To:</span>
											<span class="font-semibold text-white">{L.team}, {L.to}</span></span
										>
										<span
											><span class="text-slate-500">From:</span>
											<span class="text-slate-300">Hollow Hotline · Contact Agent</span></span
										>
									</p>
									<p class="flex items-center gap-1">
										<span class="shrink-0 text-slate-500">Subject:</span>
										<input
											bind:value={letterSubject}
											disabled={!!letterSent}
											aria-label="Letter subject"
											class="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-sky-200 hover:border-white/15 focus:border-sky-400/60 focus:bg-black/40 focus:outline-none disabled:opacity-70"
										/>
									</p>
								</div>
								<div class="grid min-h-0 flex-1 grid-cols-[2fr_1fr] gap-3 p-3">
									<!-- Left box: message, evidence, picture -->
									<div
										class="flex min-h-0 flex-col gap-3 rounded-lg border border-white/10 bg-black/20 p-3"
									>
										<div class="flex flex-col">
											<div class="mb-1 flex items-center justify-between text-[10px]">
												<span class="font-bold tracking-widest text-slate-400"
													>MESSAGE · EDIT BEFORE SENDING</span
												>
												{#if letterBody !== L.summary || letterSubject !== L.subject}
													<button
														onclick={() => ((letterBody = L.summary), (letterSubject = L.subject))}
														disabled={!!letterSent}
														class="text-sky-300 hover:underline disabled:opacity-50"
														>Reset to draft</button
													>
												{/if}
											</div>
											<textarea
												bind:value={letterBody}
												disabled={!!letterSent}
												rows="3"
												aria-label="Letter message"
												class="w-full resize-none rounded-lg border border-white/15 bg-black/40 p-2 text-xs leading-relaxed text-slate-200 focus:border-sky-400/60 focus:outline-none disabled:opacity-70"
											></textarea>
										</div>

										<!-- Evidence -->
										<div class="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2.5">
											<p class="mb-1.5 text-[10px] font-bold tracking-widest text-sky-300">
												EVIDENCE
											</p>
											<p
												class="mb-2 border-l-2 border-sky-400/60 pl-2 text-xs leading-snug text-slate-200 italic"
											>
												“{#each quoteParts(L) as part, i (i)}{#if part.kw}<mark
															class="rounded bg-blue-500/80 px-0.5 font-semibold text-white not-italic"
															>{part.text}</mark
														>{:else}{part.text}{/if}{/each}”
												<span class="text-[10px] text-slate-500 not-italic"
													>· Anonymous caller, {L.building?.label ?? `Level ${L.level}`}</span
												>
											</p>
											<dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
												{#each L.evidence as e (e.label)}
													<div class="flex justify-between gap-3">
														<dt class="text-slate-400">{e.label}</dt>
														<dd
															class="text-right font-mono font-semibold {e.warn
																? 'text-amber-300'
																: 'text-slate-200'}"
														>
															{e.value}
														</dd>
													</div>
												{/each}
											</dl>
										</div>

										<!-- Picture: the live 3D map, zoomed to the caller's building with the radar -->
										<div
											class="flex min-h-40 flex-1 overflow-hidden rounded-lg border border-blue-500/40 bg-black/30"
										>
											<div class="relative min-w-0 flex-1">
												<HotlineMap
													levels={waterHeat}
													focus={L.level - 1}
													target={radarTarget}
													radar={radarHits}
													radius={RADAR_RADIUS}
													radarColor="#3b82f6"
													radarLabel={false}
												/>
											</div>
											<div
												class="flex w-44 shrink-0 flex-col gap-1 border-l border-white/10 p-3 text-[11px]"
											>
												<p class="text-[10px] font-bold tracking-widest text-slate-400">
													AFFECTED RESIDENTS
												</p>
												<p class="font-mono text-xl font-black text-white">
													≈ {L.radar.residents.toLocaleString()}
												</p>
												<p class="text-slate-400">
													{L.radar.blocks} blocks within {L.radar.radius} m
												</p>
												<ul class="mt-1 space-y-0.5">
													{#each L.radar.dots.slice(0, 4) as d (d.label)}
														<li class="truncate text-amber-200">
															● {d.label} <span class="font-mono text-white">({d.count})</span>
														</li>
													{/each}
												</ul>
											</div>
										</div>
									</div>

									<!-- Right box: requested actions -->
									<div
										class="flex min-h-0 flex-col overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-4"
									>
										<p class="mb-3 text-[10px] font-bold tracking-widest text-slate-400">
											REQUESTED ACTIONS
										</p>
										<ol class="space-y-4">
											{#each L.actions as a, i (a)}
												<li class="flex gap-3 text-xs leading-snug text-slate-200">
													<span
														class="grid size-6 shrink-0 place-items-center rounded-full bg-sky-500/20 font-mono text-[11px] font-bold text-sky-200"
														>{i + 1}</span
													>
													<span class="pt-0.5">{a}</span>
												</li>
											{/each}
										</ol>
									</div>
								</div>
								<div class="border-t border-white/10 p-3">
									{#if letterSent}
										<div
											class="flex items-center gap-2 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs text-emerald-300"
										>
											<CheckIcon class="size-4" />
											<span
												>Sent to {L.to} at {letterSent} · ticket {L.ticket} · awaiting acknowledgement{letterBody !==
													L.summary || letterSubject !== L.subject
													? ' · edited by coordinator'
													: ''}</span
											>
										</div>
									{:else}
										<p class="mb-2 text-[10px] text-slate-500">
											Nothing is sent until you approve it.
										</p>
										<button
											onclick={() =>
												(letterSent = new Date().toLocaleTimeString([], {
													hour: '2-digit',
													minute: '2-digit'
												}))}
											class="flex w-full items-center justify-center gap-2 rounded-full bg-sky-600 py-2 text-sm font-bold text-white hover:bg-sky-500"
										>
											<SendIcon class="size-4" /> Send to {L.to}
										</button>
									{/if}
								</div>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		</section>
	</main>

	<!-- Bottom: controls -->
	<footer class="space-y-2 px-4 pb-4">
		<div class="flex items-center justify-end gap-2 text-xs">
			<span class="mr-auto text-slate-600"
				>Fictional data · reports are anonymous · keys: D demo call, R reset</span
			>
			<button
				onclick={simulate}
				disabled={!!live && playing}
				class="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-slate-300 hover:bg-white/5 disabled:opacity-40"
			>
				<PlayIcon class="size-3.5" /> Simulate call
			</button>
			<button
				onclick={reset}
				class="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-slate-400 hover:bg-white/5"
			>
				<RotateCcwIcon class="size-3.5" /> Reset
			</button>
		</div>
	</footer>
</div>
