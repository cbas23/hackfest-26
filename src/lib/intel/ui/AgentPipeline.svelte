<script lang="ts">
	import { onDestroy } from 'svelte';
	import { AI_MOCK_LABEL } from '../ai-mock.js';
	import { session } from '../orders.svelte.js';
	import { runPipeline, SAMPLE_SHIFT_REPORT, type NodeId, type Pipeline } from '../pipeline.js';
	import Icon, { type IconName } from './Icon.svelte';

	// Agent pipeline: reports in → merge → analysis → Supply and Dash agents update.
	// Numbers come from code; the agents' wording is a mock until the Claude API is connected.

	interface NodeInfo {
		title: string;
		sub: string;
		icon: IconName;
		tone: string;
		ring: string;
	}
	const NODES: Record<NodeId, NodeInfo> = {
		clinic: {
			title: 'Clinic shift report',
			sub: 'typed in by clinic staff',
			icon: 'file',
			tone: 'text-emerald-300',
			ring: 'ring-emerald-400/60'
		},
		kiosk: {
			title: 'Anonymous kiosks',
			sub: 'ration-kiosk health form',
			icon: 'people',
			tone: 'text-sky-300',
			ring: 'ring-sky-400/60'
		},
		intake: {
			title: 'Intake agent',
			sub: 'reads and merges',
			icon: 'agents',
			tone: 'text-emerald-300',
			ring: 'ring-emerald-400/60'
		},
		investigator: {
			title: 'Investigator agent',
			sub: 'history, insights, warnings',
			icon: 'intel',
			tone: 'text-blue-300',
			ring: 'ring-blue-400/60'
		},
		supply: {
			title: 'Supply agent',
			sub: 'inhaler plan',
			icon: 'box',
			tone: 'text-violet-300',
			ring: 'ring-violet-400/60'
		},
		dash: {
			title: 'Dash agent',
			sub: 'delivery queue',
			icon: 'map',
			tone: 'text-amber-300',
			ring: 'ring-amber-400/60'
		}
	};

	/** Stages: 0 idle · 1 inputs · 2 intake · 3 investigator · 4 supply+dash · 5 done. */
	const STAGE_OF: Record<NodeId, number> = {
		clinic: 1,
		kiosk: 1,
		intake: 2,
		investigator: 3,
		supply: 4,
		dash: 4
	};

	let report = $state(SAMPLE_SHIFT_REPORT);
	let editing = $state(false);
	// Nothing is shown until a report is submitted; the page fills in as the agents finish.
	let p = $state.raw<Pipeline | undefined>();
	let stage = $state(0);

	/** The latest run and its stage, for parts of the page shown elsewhere (agent updates). */
	let {
		result = $bindable(),
		progress = $bindable()
	}: { result?: Pipeline | undefined; progress?: number } = $props();
	$effect(() => {
		result = p;
		progress = stage;
	});
	let shown = $state<Record<NodeId, number>>({
		clinic: 0,
		kiosk: 0,
		intake: 0,
		investigator: 0,
		supply: 0,
		dash: 0
	});
	let run = 0;
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	async function reveal(id: number, nodes: NodeId[], ms: number) {
		const most = Math.max(...nodes.map((n) => p!.thoughts[n].length));
		for (let l = 1; l <= most; l++) {
			if (id !== run) return false;
			for (const n of nodes) shown[n] = Math.min(l, p!.thoughts[n].length);
			await sleep(ms);
		}
		return id === run;
	}

	async function start() {
		const id = ++run;
		editing = false;
		p = runPipeline(report, session.sheet?.stock);
		shown = { clinic: 0, kiosk: 0, intake: 0, investigator: 0, supply: 0, dash: 0 };
		stage = 1;
		if (!(await reveal(id, ['clinic', 'kiosk'], 550))) return;
		stage = 2;
		await sleep(500);
		if (!(await reveal(id, ['intake'], 1100))) return;
		stage = 3;
		await sleep(500);
		if (!(await reveal(id, ['investigator'], 1000))) return;
		stage = 4;
		await sleep(500);
		if (!(await reveal(id, ['supply', 'dash'], 1000))) return;
		stage = 5;
	}
	onDestroy(() => run++);

	const nodeState = (n: NodeId) =>
		stage === 0
			? 'idle'
			: stage < STAGE_OF[n]
				? 'waiting'
				: stage === STAGE_OF[n]
					? 'working'
					: 'done';
	/** An edge into a stage is lit while that stage works, solid after. */
	const edge = (into: number) => (stage === into ? 'flow' : stage > into ? 'done' : 'off');

	const card = 'rounded-2xl border border-white/10 bg-[#141b2d]/90 p-4 shadow-xl shadow-black/20';
</script>

{#snippet node(id: NodeId)}
	{@const n = NODES[id]}
	{@const st = nodeState(id)}
	<div
		class="flex h-full flex-col rounded-xl border border-white/10 bg-[#0f1626] p-3 transition-all duration-500 {st ===
		'working'
			? `ring-2 ${n.ring} shadow-lg`
			: ''} {st === 'waiting' ? 'opacity-50' : ''}"
	>
		<div class="flex items-center gap-2">
			<span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 {n.tone}"
				><Icon name={n.icon} class="h-4 w-4" /></span
			>
			<div class="min-w-0 flex-1">
				<div class="truncate text-sm font-semibold text-slate-100">{n.title}</div>
				<div class="truncate text-[11px] text-slate-500">{n.sub}</div>
			</div>
			<span
				class="shrink-0 text-[10px] font-semibold {st === 'working'
					? n.tone
					: st === 'done'
						? 'text-emerald-300'
						: 'text-slate-500'}">{st === 'idle' ? 'ready' : st}</span
			>
		</div>
		{#if p && shown[id] > 0}
			<div
				class="mt-2 space-y-1 rounded-lg rounded-tl-sm bg-white/[0.05] px-2.5 py-2 text-xs text-slate-200"
			>
				{#each p.thoughts[id].slice(0, shown[id]) as t (t)}
					<p class="animate-[fadein_0.4s_ease]">{t}</p>
				{/each}
			</div>
		{/if}
		{#if st === 'working'}
			<span class="mt-2 inline-flex gap-1" aria-label="working">
				<span class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"></span>
				<span class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0.15s]"
				></span>
				<span class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0.3s]"
				></span>
			</span>
		{/if}
	</div>
{/snippet}

{#snippet connector(kind: 'in' | 'mid' | 'out', into: number)}
	{@const e = edge(into)}
	<svg
		viewBox="0 0 40 100"
		preserveAspectRatio="none"
		class="hidden h-full w-full lg:block"
		aria-hidden="true"
	>
		{#each kind === 'in' ? ['M0 25 C20 25 20 50 40 50', 'M0 75 C20 75 20 50 40 50'] : kind === 'out' ? ['M0 50 C20 50 20 25 40 25', 'M0 50 C20 50 20 75 40 75'] : ['M0 50 L40 50'] as d (d)}
			<path
				{d}
				fill="none"
				vector-effect="non-scaling-stroke"
				stroke-width="2"
				class={e === 'flow'
					? 'flow stroke-sky-400'
					: e === 'done'
						? 'stroke-sky-400/50'
						: 'stroke-white/10'}
				stroke-dasharray={e === 'flow' ? '6 6' : undefined}
			/>
		{/each}
	</svg>
	<div class="flex justify-center py-1 text-slate-600 lg:hidden">↓</div>
{/snippet}

<!-- Input -->
<section class={card}>
	<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
		<h2 class="flex items-center gap-2 font-semibold text-slate-100">
			<Icon name="file" class="h-5 w-5 text-emerald-300" /> New clinic shift report
		</h2>
		<span class="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300"
			>{AI_MOCK_LABEL}</span
		>
	</div>
	{#if editing}
		<textarea
			bind:value={report}
			rows="3"
			class="w-full resize-none rounded-lg border border-white/10 bg-[#0d1220] p-2 text-sm text-slate-200 focus:border-emerald-400 focus:outline-none"
		></textarea>
	{:else}
		<p class="text-sm text-slate-400 italic">“{report}”</p>
	{/if}
	<div class="mt-3 flex flex-wrap gap-2">
		<button
			onclick={start}
			disabled={!report.trim() || (stage > 0 && stage < 5)}
			class="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
			>{stage > 0 && stage < 5 ? 'Agents working…' : 'Submit report'}</button
		>
		<button
			onclick={() => (editing = !editing)}
			class="rounded-full border border-white/15 px-4 py-1.5 text-sm text-slate-200 hover:bg-white/5"
			>{editing ? 'Done editing' : 'Edit report'}</button
		>
	</div>
</section>

<!-- Pipeline diagram -->
<section class={card}>
	<div
		class="grid gap-y-1 lg:grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)]"
	>
		<div class="flex flex-col gap-3">
			<div class="flex-1">{@render node('clinic')}</div>
			<div class="flex-1">{@render node('kiosk')}</div>
		</div>
		{@render connector('in', 2)}
		<div class="flex flex-col justify-center">{@render node('intake')}</div>
		{@render connector('mid', 3)}
		<div class="flex flex-col justify-center">{@render node('investigator')}</div>
		{@render connector('out', 4)}
		<div class="flex flex-col gap-3">
			<div class="flex-1">{@render node('supply')}</div>
			<div class="flex-1">{@render node('dash')}</div>
		</div>
	</div>
</section>

<style>
	:global(.flow) {
		animation: flow 0.8s linear infinite;
	}
	@keyframes flow {
		to {
			stroke-dashoffset: -12;
		}
	}
	@keyframes -global-fadein {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
