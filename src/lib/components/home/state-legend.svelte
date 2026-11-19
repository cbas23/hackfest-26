<script lang="ts">
	import { POINT_INFO, type PointKind } from '#lib/hollow/state.js';
	import { cn } from '#lib/utils.js';

	/** The two colours of a point lens: good (faint) and bad (the kind's colour). */
	let { kind, class: className }: { kind: PointKind; class?: string } = $props();
	const info = $derived(POINT_INFO[kind]);
</script>

<div class={cn('flex items-center gap-3 text-[11px] text-muted-foreground', className)}>
	{#each [{ label: info.good, color: 'var(--map-good)' }, { label: info.bad, color: info.color }] as s (s.label)}
		<span class="flex items-center gap-1.5">
			<span class="size-2.5 rounded-sm" style="background:{s.color}" aria-hidden="true"></span>
			{s.label}
		</span>
	{/each}
	<span class="ml-auto text-[10px]">Simulated</span>
</div>
