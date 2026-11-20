<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import SirenIcon from '@lucide/svelte/icons/siren';
	import { directions } from './directions.svelte.js';
	import { home } from './home-state.svelte.js';

	const danger = $derived(directions.danger);
</script>

{#if home.address}
	<div class="mx-3 mt-3 px-3">
		{#if danger.length}
			<button
				class="group relative w-full overflow-hidden rounded-lg border border-destructive bg-destructive px-3 py-2.5 text-left text-white shadow-[0_0_24px_color-mix(in_oklch,var(--destructive)_55%,transparent)] transition-transform outline-none hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
				onclick={() => directions.escape()}
			>
				<span
					class="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/15 to-transparent"
					aria-hidden="true"
				></span>
				<span class="relative flex items-center gap-2.5">
					<SirenIcon class="size-5 shrink-0 animate-[wiggle_1s_ease-in-out_infinite]" />
					<span class="flex min-w-0 flex-col">
						<span class="text-sm font-bold tracking-wide uppercase">Get to safety</span>
						<span class="truncate text-xs opacity-90">{danger[0].title}</span>
					</span>
				</span>
			</button>
		{:else}
			<Button variant="outline" size="sm" class="w-full" onclick={() => directions.escape()}>
				<ShieldCheckIcon /> Find the nearest safe block
			</Button>
		{/if}
		{#if directions.escapeFailed}
			<p class="mt-1.5 text-xs text-destructive">
				No safe block can be reached right now. Every way out is blocked.
			</p>
		{/if}
	</div>
{/if}

<style>
	@keyframes -global-wiggle {
		0%,
		100% {
			transform: rotate(0);
		}
		25% {
			transform: rotate(-14deg);
		}
		75% {
			transform: rotate(14deg);
		}
	}
</style>
