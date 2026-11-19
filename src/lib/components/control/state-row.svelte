<script lang="ts">
	import type { Snippet } from 'svelte';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import { Button } from '#lib/components/ui/button/index.js';
	import { control } from './control-state.svelte.js';

	/** One point or blocked tunnel in a panel's list, with a delete button. */
	let {
		title,
		sub,
		color,
		onremove,
		children
	}: {
		title: string;
		sub?: string;
		/** Accent on the left edge. */
		color?: string;
		onremove: () => void;
		/** Extra controls (sliders), shown under the title. */
		children?: Snippet;
	} = $props();
</script>

<li
	class="flex flex-col gap-2 rounded-md border bg-card p-2.5 text-xs"
	style={color ? `border-left:3px solid ${color}` : ''}
>
	<div class="flex items-start gap-2">
		<div class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span class="truncate font-medium text-foreground">{title}</span>
			{#if sub}<span class="truncate text-muted-foreground">{sub}</span>{/if}
		</div>
		<Button
			variant="ghost"
			size="icon-sm"
			disabled={control.busy}
			onclick={onremove}
			aria-label="Delete"
			title="Delete"><TrashIcon /></Button
		>
	</div>
	{#if children}{@render children()}{/if}
</li>
