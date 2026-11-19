<script lang="ts">
	import type { Snippet } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import { STATUS_INFO, type Status } from '#lib/hollow/sensors.js';
	import type { EventRef } from '#lib/hollow/events.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { cn } from '#lib/utils.js';
	import { control, removeEvent, reopen, resolve } from './control-state.svelte.js';

	let {
		event,
		active,
		title,
		sub,
		severity,
		children
	}: {
		event: EventRef;
		active: boolean;
		title: string;
		sub?: string;
		severity?: Status;
		/** Extra controls (sliders, severity), shown under the title. */
		children?: Snippet;
	} = $props();
</script>

<li
	class={cn('flex flex-col gap-2 rounded-md border bg-card p-2.5 text-xs', !active && 'opacity-60')}
	style={severity && active ? `border-left:3px solid ${STATUS_INFO[severity].color}` : ''}
>
	<div class="flex items-start gap-2">
		<div class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span class="flex items-center gap-1.5">
				<span class={cn('truncate font-medium text-foreground', !active && 'line-through')}
					>{title}</span
				>
				{#if severity}
					<span
						class="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase"
						style="color:{STATUS_INFO[severity].color};background:color-mix(in oklab, {STATUS_INFO[
							severity
						].color} 15%, transparent)">{STATUS_INFO[severity].label}</span
					>
				{/if}
				{#if !active}<span class="text-[10px] text-muted-foreground">fixed</span>{/if}
			</span>
			{#if sub}<span class="truncate text-muted-foreground">{sub}</span>{/if}
		</div>
		<div class="flex shrink-0 gap-1">
			{#if active}
				<Button
					variant="outline"
					size="icon-sm"
					disabled={control.busy}
					onclick={() => resolve([event])}
					aria-label="Mark fixed"
					title="Mark fixed"><CheckIcon /></Button
				>
			{:else}
				<Button
					variant="outline"
					size="icon-sm"
					disabled={control.busy}
					onclick={() => reopen([event])}
					aria-label="Reopen"
					title="Reopen"><Undo2Icon /></Button
				>
			{/if}
			<Button
				variant="ghost"
				size="icon-sm"
				disabled={control.busy}
				onclick={() => removeEvent(event)}
				aria-label="Delete"
				title="Delete"><TrashIcon /></Button
			>
		</div>
	</div>
	{#if children && active}{@render children()}{/if}
</li>
