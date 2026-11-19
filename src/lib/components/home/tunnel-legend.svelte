<script lang="ts">
	import { cn } from '#lib/utils.js';

	/** Key for the tunnels lens: open tunnels, blocked tiles, and the darkened chambers. */
	let { class: className }: { class?: string } = $props();

	const KEY = [
		{ label: 'Open tunnel', color: 'var(--map-tunnels-road)' },
		{ label: 'Blocked', color: 'var(--map-tunnels-blocked)' },
		{ label: 'Chambers', color: 'var(--map-tunnels-room-roof)' }
	];
</script>

<ul class={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]', className)}>
	{#each KEY as k (k.label)}
		<li class="flex items-center gap-1.5">
			<span class="size-2.5 rounded-sm border border-border" style="background:{k.color}"></span>
			{k.label}
		</li>
	{/each}
</ul>
