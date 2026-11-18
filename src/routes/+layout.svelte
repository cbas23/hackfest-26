<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import SiteNav from '#lib/components/site-nav.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<!-- Add inside <head> -->
	<script src="https://tweakcn.com/live-preview.min.js"></script>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex h-dvh flex-col overflow-hidden">
	<SiteNav />
	<div class="relative min-h-0 flex-1 overflow-auto">
		{@render children()}
	</div>
</div>
