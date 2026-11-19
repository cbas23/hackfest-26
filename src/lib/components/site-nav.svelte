<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import MapIcon from '@lucide/svelte/icons/map';
	import RouteIcon from '@lucide/svelte/icons/route';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import PickaxeIcon from '@lucide/svelte/icons/pickaxe';
	import RadioTowerIcon from '@lucide/svelte/icons/radio-tower';
	import { cn } from '#lib/utils.js';

	const links = [
		{ href: resolve('/'), label: 'Map', icon: MapIcon },
		{ href: resolve('/control'), label: 'Control center', icon: RadioTowerIcon },
		{ href: resolve('/hollow'), label: 'Directions', icon: RouteIcon },
		{ href: resolve('/hotline'), label: 'Hotline', icon: PhoneIcon, live: true },
		{ href: resolve('/tunnel-gen'), label: 'Tunnel generator', icon: PickaxeIcon }
	];
</script>

<header
	class="relative z-30 flex h-12 shrink-0 items-center gap-4 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground sm:gap-8"
>
	<a
		href={resolve('/')}
		class="rounded-sm text-base leading-none font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring"
	>
		The Hollow
	</a>

	<nav aria-label="Site" class="h-full min-w-0">
		<ul class="flex h-full items-stretch gap-1">
			{#each links as l (l.href)}
				{@const current = page.url.pathname === l.href}
				<li>
					<a
						href={l.href}
						aria-current={current ? 'page' : undefined}
						title={l.label}
						class={cn(
							'relative flex h-full items-center gap-2 px-2.5 text-sm transition-colors outline-none focus-visible:bg-sidebar-accent sm:px-3',
							current
								? 'font-medium text-foreground'
								: 'text-muted-foreground hover:text-foreground'
						)}
					>
						<span class="relative">
							<l.icon class="size-4" aria-hidden="true" />
							{#if l.live}
								<span class="absolute -top-0.5 -right-0.5 flex size-1.5" aria-hidden="true">
									<span
										class="absolute inline-flex size-full rounded-full bg-destructive opacity-75 motion-safe:animate-ping"
									></span>
									<span class="relative inline-flex size-1.5 rounded-full bg-destructive"></span>
								</span>
							{/if}
						</span>
						<span class="sr-only whitespace-nowrap sm:not-sr-only">{l.label}</span>
						{#if current}
							<span
								class="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-primary sm:inset-x-3"
								aria-hidden="true"
							></span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	</nav>
</header>
