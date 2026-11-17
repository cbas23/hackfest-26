<script lang="ts">
	import * as Accordion from '#lib/components/ui/accordion/index.js';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';

	// Placeholder entries until real data is wired in.
	const items = [
		{ id: 'item-1', title: 'Item 1', subtitle: 'Placeholder', body: 'Details for item 1.' },
		{ id: 'item-2', title: 'Item 2', subtitle: 'Placeholder', body: 'Details for item 2.' },
		{ id: 'item-3', title: 'Item 3', subtitle: 'Placeholder', body: 'Details for item 3.' },
		{ id: 'item-4', title: 'Item 4', subtitle: 'Placeholder', body: 'Details for item 4.' }
	];
</script>

<aside class="flex h-full w-80 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
	<header class="px-4 py-3">
		<h2 class="text-center text-sm font-semibold">Sidebar</h2>
	</header>
	<Separator />
	<ScrollArea class="min-h-0 flex-1">
		<Accordion.Root type="multiple" class="flex flex-col gap-3 p-4">
			{#each items as item (item.id)}
				<Accordion.Item value={item.id} class="rounded-lg border bg-card px-3">
					<Accordion.Trigger class="items-center hover:no-underline">
						<div class="flex items-center gap-3">
							<Avatar.Root class="size-10">
								<Avatar.Fallback>{item.title.slice(0, 1)}</Avatar.Fallback>
							</Avatar.Root>
							<div class="flex min-w-0 flex-col">
								<span class="truncate">{item.title}</span>
								<span class="truncate text-xs text-muted-foreground">{item.subtitle}</span>
							</div>
						</div>
					</Accordion.Trigger>
					<Accordion.Content>
						<p class="text-muted-foreground">{item.body}</p>
					</Accordion.Content>
				</Accordion.Item>
			{/each}
		</Accordion.Root>
	</ScrollArea>
</aside>
