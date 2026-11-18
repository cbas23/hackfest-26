<script lang="ts">
	let { kind, color, size }: { kind: string; color: string; size: number } = $props();
</script>

<span
	class="grid shrink-0 place-items-center rounded-full border-2 border-foreground/90 shadow-md"
	style="width:{size}px;height:{size}px;background:{color}"
>
	<svg viewBox="0 0 24 24" class="h-[60%] w-[60%] fill-foreground" aria-hidden="true">
		{#if kind === 'shaft'}
			<path d="M7 3h10v18H7zM12 6l-3 3h6zM12 18l3-3H9z" />
		{:else if kind === 'farm'}
			<path d="M12 2c-3 3-5 6-5 9a5 5 0 0 0 4 4.9V22h2v-6.1A5 5 0 0 0 17 11c0-3-2-6-5-9z" />
		{:else if kind === 'plant'}
			<path d="M13 2 4 14h6l-1 8 9-12h-6z" />
		{:else if kind === 'air'}
			<path
				d="M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0-8c3 0 4 3 2 7-1-1-3-1-4 0-2-4-1-7 2-7zm8.7 15c-1.5 2.6-4.6 2.4-7.1-1.2 1.3-.4 2.3-2.1 2-3.5 4.4.3 6.6 2.1 5.1 4.7zM3.3 17c-1.5-2.6.2-5.2 4.6-5.6-.3 1.4.7 3.1 2 3.5-2.5 3.6-5.1 4.7-6.6 2.1z"
			/>
		{:else if kind === 'water'}
			<path d="M12 2s-6 7-6 12a6 6 0 0 0 12 0c0-5-6-12-6-12z" />
		{:else if kind === 'clinic'}
			<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />
		{:else if kind === 'market'}
			<path d="M4 4h16l-1 5H5zm1 7h14v9h-5v-5h-4v5H5z" />
		{:else if kind === 'directorate'}
			<path d="M12 2 3 6v6c0 5 4 9 9 10 5-1 9-5 9-10V6z" />
		{:else}
			<path d="M4 21V9l8-6 8 6v12h-6v-6h-4v6z" />
		{/if}
	</svg>
</span>
