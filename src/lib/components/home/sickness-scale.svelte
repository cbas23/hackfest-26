<script lang="ts">
	import { SICK_STEPS, sickStep } from '#lib/hollow/sickness.js';
	import { cn } from '#lib/utils.js';

	/** Optional score (0–1) to mark on the scale. */
	let { score = null, class: className }: { score?: number | null; class?: string } = $props();
	const active = $derived(score === null ? -1 : sickStep(score));
</script>

<div class={cn('flex flex-col gap-1', className)}>
	<div class="grid grid-cols-5 gap-0.5">
		{#each SICK_STEPS as step, i (step.color)}
			<span
				class={cn(
					'h-2.5 rounded-sm',
					i === active && 'ring-2 ring-foreground ring-offset-1 ring-offset-background'
				)}
				style="background:{step.color}"
				title="{step.range} sick"
			></span>
		{/each}
	</div>
	<div class="grid grid-cols-5 gap-0.5 text-center text-[10px] text-muted-foreground tabular-nums">
		{#each SICK_STEPS as step (step.color)}
			<span>{step.short}</span>
		{/each}
	</div>
</div>
