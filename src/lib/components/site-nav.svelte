<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import MapIcon from '@lucide/svelte/icons/map';
	import RadioTowerIcon from '@lucide/svelte/icons/radio-tower';
	import { cn } from '#lib/utils.js';
	import logo from '#lib/assets/favicon.svg';

	const links = [
		{ href: resolve('/'), label: 'Map', icon: MapIcon },
		{ href: resolve('/control'), label: 'Control center', icon: RadioTowerIcon }
		// The tunnel generator (/tunnel-gen) is hidden from the nav but still reachable by URL.
	];
</script>

<header
	class="relative z-30 flex h-12 shrink-0 items-center gap-4 border-b border-sidebar-border bg-sidebar pr-4 text-sidebar-foreground sm:gap-6"
>
	<a
		href={resolve('/')}
		class="group flex h-full shrink-0 items-center outline-none"
		aria-label="The Hollow, home"
	>
		<!-- Icon cell, cut off by a slanted edge. -->
		<span class="relative grid h-full w-16 place-items-center pr-3">
			<svg
				class="absolute inset-0 size-full"
				viewBox="0 0 64 48"
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				<polygon points="0,0 64,0 48,48 0,48" class="fill-sidebar-accent" />
				<line
					x1="64"
					y1="0"
					x2="48"
					y2="48"
					class="stroke-sidebar-border"
					stroke-width="1"
					vector-effect="non-scaling-stroke"
				/>
			</svg>
			<img src={logo} alt="" class="relative size-8" />
		</span>
		<span
			class="rounded-sm px-3 text-sm leading-none font-semibold tracking-[0.2em] whitespace-nowrap uppercase group-focus-visible:ring-2 group-focus-visible:ring-ring"
		>
			The Hollow
		</span>
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
						<l.icon class="size-4" aria-hidden="true" />
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
