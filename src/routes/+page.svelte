<script lang="ts">
	import AppSidebar from '#lib/components/home/app-sidebar.svelte';
	import MapView from '#lib/components/home/map-view.svelte';
</script>

<svelte:head><title>Hollow Guard Map</title></svelte:head>

<main class="flex h-full overflow-hidden">
	<AppSidebar />
	<MapView />
</main>
