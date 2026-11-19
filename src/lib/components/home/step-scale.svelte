<script lang="ts">
	import { cn } from '#lib/utils.js';

	/**
	 * A five-step colour scale with a label under each step (water health, airflow). Pass
	 * `active` to ring one step.
	 */
	let {
		steps,
		active = -1,
		class: className
	}: {
		steps: readonly { color: string; label: string; short: string }[];
		active?: number;
		class?: string;
	} = $props();
</script>

<div class={cn('flex flex-col gap-1', className)}>
	<div class="grid gap-0.5" style="grid-template-columns:repeat({steps.length}, minmax(0, 1fr))">
		{#each steps as step, i (step.color)}
			<span
				class={cn(
					'h-2.5 rounded-sm',
					i === active && 'ring-2 ring-foreground ring-offset-1 ring-offset-background'
				)}
				style="background:{step.color}"
				title={step.label}
			></span>
		{/each}
	</div>
	<div
		class="grid gap-0.5 text-center text-[10px] text-muted-foreground"
		style="grid-template-columns:repeat({steps.length}, minmax(0, 1fr))"
	>
		{#each steps as step (step.color)}
			<span class="truncate">{step.short}</span>
		{/each}
	</div>
</div>
