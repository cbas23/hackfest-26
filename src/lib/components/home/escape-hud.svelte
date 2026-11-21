<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { LEVELS } from '#lib/hollow/data.js';
	import { cn } from '#lib/utils.js';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import SirenIcon from '@lucide/svelte/icons/siren';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import XIcon from '@lucide/svelte/icons/x';
	import { directions } from './directions.svelte.js';

	let {
		arrived,
		class: className = ''
	}: {
		/** True once the route has reached the safe block. */
		arrived: boolean;
		class?: string;
	} = $props();

	const route = $derived(directions.route);
	const dest = $derived(directions.toPlace);
	const minutes = (s: number) => Math.max(1, Math.round(s / 60));
</script>

{#if route && dest}
	<div
		class={cn(
			'alert-in flex max-w-[calc(100%-2rem)] items-center gap-2.5 rounded-full border bg-background/95 py-1 pr-1 pl-3 text-sm shadow-2xl backdrop-blur',
			arrived ? 'border-emerald-500/70' : 'border-destructive/60',
			className
		)}
		role="status"
		aria-live="polite"
	>
		{#if arrived}
			<ShieldCheckIcon class="size-4 shrink-0 text-emerald-500" />
			<span class="font-semibold text-emerald-500">Safe</span>
		{:else}
			<SirenIcon class="size-4 shrink-0 animate-pulse text-destructive" />
		{/if}
		<span class="min-w-0 truncate font-medium">
			{dest.label}
			<span class="text-muted-foreground">· {LEVELS[dest.floor].code}</span>
		</span>
		{#if !arrived}
			<span class="shrink-0 font-bold text-emerald-500 tabular-nums"
				>{minutes(route.seconds)} min</span
			>
		{/if}
		<div class="flex shrink-0">
			<Button
				size="icon-sm"
				variant="ghost"
				class="rounded-full"
				aria-label="Replay"
				onclick={() => directions.escape()}
			>
				<RotateCcwIcon />
			</Button>
			<Button
				size="icon-sm"
				variant="ghost"
				class="rounded-full"
				aria-label="End"
				onclick={() => directions.close()}
			>
				<XIcon />
			</Button>
		</div>
	</div>
{/if}
