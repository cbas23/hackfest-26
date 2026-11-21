<script lang="ts">
	import { resolve } from '$app/paths';
	import logo from '#lib/assets/favicon.svg';

	// Title only: the Map (/) is the default page. The Control center (/control) and the
	// tunnel generator (/tunnel-gen) are hidden from the nav but still reachable by URL.
</script>

<header
	class="relative z-30 flex h-12 shrink-0 items-center gap-4 border-b border-sidebar-border bg-sidebar pr-4 text-sidebar-foreground sm:gap-6"
>
	<a
		href={resolve('/')}
		class="group flex h-full shrink-0 items-center outline-none"
		aria-label="Hollow Guard Map, home"
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
			Hollow Guard Map
		</span>
	</a>
</header>
