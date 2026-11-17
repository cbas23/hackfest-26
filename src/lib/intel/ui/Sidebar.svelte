<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon, { type IconName } from './Icon.svelte';

	let { active, week }: { active: 'intel' | 'meddash'; week: string } = $props();

	const items: {
		id: string;
		label: string;
		icon: IconName;
		path?: '/' | '/intel' | '/hollow';
		soon?: boolean;
	}[] = [
		{ id: 'overview', label: 'Overview', icon: 'overview', path: '/' },
		{ id: 'intel', label: 'Intelligence', icon: 'intel', path: '/intel' },
		{ id: 'map', label: 'Map', icon: 'map', path: '/hollow' },
		{ id: 'meddash', label: 'MedDash', icon: 'pill', soon: true }
	];
</script>

<aside
	class="flex min-w-0 shrink-0 flex-col border-white/10 bg-[#0d1220] lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:border-r"
>
	<div class="flex items-center gap-3 px-5 py-4 lg:flex-col lg:gap-2 lg:py-7">
		<svg viewBox="0 0 64 64" class="h-10 w-10 lg:h-16 lg:w-16" aria-hidden="true">
			<defs>
				<linearGradient id="hg-arch" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="#60a5fa" />
					<stop offset="1" stop-color="#1d4ed8" />
				</linearGradient>
			</defs>
			<path d="M8 58V30a24 24 0 0 1 48 0v28h-9V30a15 15 0 0 0-30 0v28z" fill="url(#hg-arch)" />
			<path d="M24 58V32a8 8 0 0 1 16 0v26" fill="none" stroke="#93c5fd" stroke-width="3" />
			<path d="M4 58h56" stroke="#60a5fa" stroke-width="3" />
		</svg>
		<div class="lg:text-center">
			<div
				class="text-lg leading-5 font-bold tracking-wide text-slate-100 lg:text-2xl lg:leading-7"
			>
				HOLLOW<br class="hidden lg:block" /> GUARDIAN
			</div>
			<div class="hidden text-xs text-slate-400 lg:block">Monitor. Investigate. Respond.</div>
		</div>
	</div>

	<nav class="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:pb-0">
		{#each items as item (item.id)}
			{#if item.path && !item.soon}
				<a
					href={resolve(item.path)}
					class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm whitespace-nowrap {active ===
					item.id
						? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
						: 'text-slate-300 hover:bg-white/5 hover:text-white'}"
				>
					<Icon name={item.icon} />
					{item.label}
				</a>
			{:else}
				<span
					class="hidden cursor-default items-center gap-3 rounded-xl px-3 py-2.5 text-sm whitespace-nowrap text-slate-500 lg:flex"
					title="Coming in a later PR"
				>
					<Icon name={item.icon} />
					{item.label}
					<span class="rounded bg-white/5 px-1.5 text-[10px] text-slate-500">soon</span>
				</span>
			{/if}
		{/each}
	</nav>

	<div class="mt-auto hidden p-4 lg:block">
		<div class="rounded-xl border border-white/10 bg-[#121a2c] p-3 text-xs">
			<div class="flex items-center gap-2 font-semibold text-emerald-400">
				<span class="h-2 w-2 rounded-full bg-emerald-400"></span>
				System online
			</div>
			<div class="mt-1 text-slate-400">Week {week}</div>
			<div class="text-amber-300/80">Fictional data</div>
		</div>
	</div>
</aside>
