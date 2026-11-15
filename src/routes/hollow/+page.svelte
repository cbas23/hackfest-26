<script lang="ts">
	import { onMount } from 'svelte';
	import {
		DISTRICTS,
		KIND_LABELS,
		SHAFTS,
		SHAFT_COLORS,
		STATUS_COLORS,
		levelById
	} from '#lib/hollow/data.js';
	import { createHollowScene, type HollowScene, type Selection } from '#lib/hollow/scene.js';

	let container: HTMLDivElement;
	let hollow: HollowScene | undefined;

	let selection = $state<Selection>(null);
	let hover = $state<Selection>(null);
	let focused = $state<string | null>(null);

	function focus(id: string | null) {
		focused = id;
		hollow?.focusLevel(id);
	}

	function handleSelect(sel: Selection) {
		selection = sel;
		hollow?.select(sel);
		if (sel?.type === 'level') focus(sel.item.id);
		else if (sel?.type === 'district' && focused && focused !== sel.item.level)
			focus(sel.item.level);
	}

	function reset() {
		selection = null;
		focused = null;
		hollow?.resetView();
	}

	onMount(() => {
		hollow = createHollowScene(container, {
			onSelect: handleSelect,
			onHover: (s) => (hover = s)
		});
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') reset();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			hollow?.dispose();
		};
	});

	const shaftsTouching = (levelId: string) => {
		const idx = levelById(levelId).index;
		return SHAFTS.filter((s) => {
			const a = levelById(s.from).index;
			const b = levelById(s.to).index;
			return idx >= Math.min(a, b) && idx <= Math.max(a, b);
		});
	};

	const meter = (v: number) => `${Math.round(v * 100)}%`;
</script>

<svelte:head>
	<title>The Hollow · Map</title>
</svelte:head>

<div class="fixed inset-0 overflow-hidden bg-[#05060a] font-mono text-slate-300 select-none">
	<div bind:this={container} class="absolute inset-0 isolate"></div>

	<!-- title -->
	<header class="pointer-events-none absolute top-4 left-4 z-10 sm:top-6 sm:left-6">
		<p class="text-[10px] tracking-[0.3em] text-slate-500">DIRECTORATE SURVEY · REV 2087</p>
		<h1 class="text-2xl font-bold tracking-[0.2em] text-slate-100 sm:text-3xl">THE HOLLOW</h1>
		<p class="mt-1 max-w-xs text-xs text-slate-500">
			Six levels · ≈ 2 billion residents · surface sealed 30 yrs
		</p>
	</header>

	{#if focused}
		<button
			class="absolute top-28 left-4 z-10 rounded border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-300 hover:text-slate-100 sm:left-6"
			onclick={reset}>← Full view <span class="text-slate-600">(Esc)</span></button
		>
	{/if}

	<!-- info panel -->
	{#if selection}
		<aside
			class="absolute right-4 bottom-4 left-4 z-10 max-h-[55vh] overflow-y-auto rounded-lg border border-slate-700/80 bg-slate-950/85 p-4 backdrop-blur sm:top-6 sm:right-6 sm:bottom-auto sm:left-auto sm:max-h-[calc(100vh-3rem)] sm:w-80"
		>
			<button
				class="absolute top-2 right-3 text-slate-500 hover:text-slate-200"
				aria-label="Close"
				onclick={() => handleSelect(null)}>✕</button
			>

			{#if selection.type === 'level'}
				{@const l = selection.item}
				<p class="text-[10px] tracking-widest text-slate-500">{l.code} · {l.depth}</p>
				<h2 class="mb-2 text-lg font-bold text-slate-100">{l.name}</h2>
				<p class="mb-3 text-xs leading-relaxed text-slate-400">{l.description}</p>
				<dl class="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
					<dt class="text-slate-500">Population</dt>
					<dd>{l.population}</dd>
					{#each [['Light', l.light, '#fde68a'], ['Air', l.air, '#7dd3fc'], ['Heat', l.heat, '#f97316']] as const as [label, v, c] (label)}
						<dt class="text-slate-500">{label}</dt>
						<dd class="flex items-center gap-2">
							<span class="h-1.5 flex-1 rounded bg-slate-800">
								<span class="block h-full rounded" style="width:{meter(v)};background:{c}"></span>
							</span>
						</dd>
					{/each}
				</dl>
				{@const ds = DISTRICTS.filter((d) => d.level === l.id)}
				<p class="mb-1 text-[10px] tracking-widest text-slate-500">ZONES</p>
				<ul class="mb-3 space-y-1 text-xs">
					{#each ds as d (d.id)}
						<li>
							<button
								class="flex w-full items-center gap-2 text-left hover:text-slate-100"
								onclick={() => handleSelect({ type: 'district', item: d })}
							>
								<span class="size-2 rounded-full" style="background:{STATUS_COLORS[d.status]}"
								></span>
								{d.name}
								<span class="ml-auto text-slate-600">{KIND_LABELS[d.kind]}</span>
							</button>
						</li>
					{/each}
				</ul>
				{@const sh = shaftsTouching(l.id)}
				{#if sh.length}
					<p class="mb-1 text-[10px] tracking-widest text-slate-500">SHAFTS</p>
					<ul class="space-y-1 text-xs">
						{#each sh as s (s.id)}
							<li>
								<button
									class="flex w-full items-center gap-2 text-left hover:text-slate-100"
									onclick={() => handleSelect({ type: 'shaft', item: s })}
								>
									<span class="h-2 w-0.5" style="background:{SHAFT_COLORS[s.status]}"></span>
									{s.name}
									<span class="ml-auto text-slate-600">{s.status}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if selection.type === 'district'}
				{@const d = selection.item}
				{@const l = levelById(d.level)}
				<p class="text-[10px] tracking-widest text-slate-500">
					{l.code}
					{l.name.toUpperCase()} · {KIND_LABELS[d.kind].toUpperCase()}
				</p>
				<h2 class="mb-2 text-lg font-bold text-slate-100">{d.name}</h2>
				<span
					class="mb-3 inline-block rounded px-1.5 py-0.5 text-[10px] tracking-widest uppercase"
					style="color:{STATUS_COLORS[d.status]};border:1px solid {STATUS_COLORS[d.status]}"
					>{d.status}</span
				>
				<p class="mb-3 text-xs leading-relaxed text-slate-400">{d.description}</p>
				{#if d.population}
					<p class="text-xs"><span class="text-slate-500">Residents</span> {d.population}</p>
				{/if}
			{:else}
				{@const s = selection.item}
				<p class="text-[10px] tracking-widest text-slate-500">
					SHAFT · {levelById(s.from).code} ↕ {levelById(s.to).code}
				</p>
				<h2 class="mb-2 text-lg font-bold text-slate-100">{s.name}</h2>
				<span
					class="mb-3 inline-block rounded px-1.5 py-0.5 text-[10px] tracking-widest uppercase"
					style="color:{SHAFT_COLORS[s.status]};border:1px solid {SHAFT_COLORS[s.status]}"
					>{s.status}</span
				>
				<p class="text-xs leading-relaxed text-slate-400">{s.description}</p>
			{/if}
		</aside>
	{/if}

	<!-- hover tooltip -->
	{#if hover && hover.type !== 'level' && hover.item !== selection?.item}
		<div
			class="pointer-events-none absolute top-6 left-1/2 z-10 -translate-x-1/2 rounded border border-slate-700 bg-slate-950/90 px-3 py-1.5 text-xs"
		>
			{hover.item.name}
			<span class="text-slate-500">
				· {hover.type === 'district' ? KIND_LABELS[hover.item.kind] : 'shaft'}</span
			>
		</div>
	{/if}

	<!-- legend -->
	<footer
		class="pointer-events-none absolute bottom-4 left-4 z-10 hidden flex-col gap-2 text-[10px] text-slate-500 sm:left-6 md:flex"
	>
		<div class="flex flex-wrap gap-3">
			<span class="tracking-widest text-slate-600">ZONES</span>
			{#each Object.entries(STATUS_COLORS) as [k, c] (k)}
				<span class="flex items-center gap-1.5"
					><span class="size-2 rounded-full" style="background:{c}"></span>{k}</span
				>
			{/each}
		</div>
		<div class="flex flex-wrap gap-3">
			<span class="tracking-widest text-slate-600">SHAFTS</span>
			{#each Object.entries(SHAFT_COLORS) as [k, c] (k)}
				<span class="flex items-center gap-1.5"
					><span class="h-2.5 w-0.5" style="background:{c}"></span>{k}</span
				>
			{/each}
		</div>
		<p class="text-slate-600">Drag to orbit · scroll to zoom · click a level name or zone</p>
	</footer>
</div>

<style>
	:global(.hl-level) {
		pointer-events: auto;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		font-family: ui-monospace, monospace;
		line-height: 1.15;
		transition: opacity 0.4s;
		padding-right: 6px;
	}
	:global(.hl-level .hl-code) {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.15em;
	}
	:global(.hl-level .hl-name) {
		font-size: 12px;
		color: #e2e8f0;
	}
	:global(.hl-level .hl-depth) {
		font-size: 10px;
		color: #64748b;
	}
	:global(.hl-level:hover .hl-name),
	:global(.hl-level.hl-active .hl-name) {
		color: #fff;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	:global(.hl-district),
	:global(.hl-shaft) {
		font-family: ui-monospace, monospace;
		font-size: 10px;
		letter-spacing: 0.05em;
		white-space: nowrap;
		color: #cbd5e1;
		text-shadow:
			0 0 4px #000,
			0 0 8px #000;
		transition: opacity 0.4s;
		padding-bottom: 2px;
	}
	:global(.hl-shaft) {
		font-size: 9px;
		color: #94a3b8;
		font-style: italic;
	}
	:global(.hl-blackout) {
		color: #64748b;
	}
	:global(.hl-failing) {
		color: #fdba74;
	}
	:global(.hl-hostile) {
		color: #fda4af;
	}
	:global(.hl-shaft-sealed) {
		color: #fda4af;
	}
</style>
