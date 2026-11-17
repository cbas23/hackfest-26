<script lang="ts">
	import { session } from '../orders.svelte.js';
	import type { Pipeline } from '../pipeline.js';
	import Icon from './Icon.svelte';

	/** What the Supply and Dash agents updated after the latest pipeline run. */
	let { p, stage }: { p: Pipeline; stage: number } = $props();

	const approvedHere = $derived(p.plan ? session.approved[p.plan.target.place] : undefined);
	const card = 'rounded-2xl border border-white/10 bg-[#141b2d]/90 p-4 shadow-xl shadow-black/20';
</script>

<div
	class="grid gap-4 transition-opacity duration-700 md:grid-cols-2 {stage > 4 ? '' : 'opacity-30'}"
>
	<section class={card}>
		<h2 class="mb-2 flex items-center gap-2 font-semibold text-slate-100">
			<Icon name="box" class="h-5 w-5 text-violet-300" /> Supply agent updated
		</h2>
		{#if p.plan}
			<p class="text-sm text-slate-300">
				{p.plan.amount} inhalers from {p.plan.from} to {p.plan.target.place}. Lasts ~{p.plan
					.daysAfter} days.
			</p>
			<p class="mt-1 text-sm {approvedHere ? 'text-emerald-300' : 'text-amber-300'}">
				{approvedHere ? 'Approved.' : 'Waiting for a person to approve.'}
			</p>
			<span
				title="MedDash comes in the next PR"
				class="mt-3 inline-block cursor-not-allowed rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-slate-400"
				>Review in MedDash · soon</span
			>
		{:else}
			<p class="text-sm text-slate-400">Stock is fine on {p.level}. No reorder.</p>
		{/if}
	</section>
	<section class={card}>
		<h2 class="mb-2 flex items-center gap-2 font-semibold text-slate-100">
			<Icon name="map" class="h-5 w-5 text-amber-300" /> Dash agent updated
		</h2>
		{#if p.plan}
			<p class="text-sm text-slate-300">
				New delivery: {p.plan.from} → {p.plan.target.place}.
			</p>
			<p class="mt-1 text-sm text-slate-400">{p.thoughts.dash.at(-1)}</p>
			<span
				title="MedDash comes in the next PR"
				class="mt-3 inline-block cursor-not-allowed rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-slate-400"
				>Dash map · soon</span
			>
		{:else}
			<p class="text-sm text-slate-400">No delivery needed.</p>
		{/if}
	</section>
</div>
