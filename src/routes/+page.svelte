<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
	<h1 class="text-3xl font-bold">Hackfest 26</h1>
	<nav class="flex flex-wrap justify-center gap-4">
		<a
			href={resolve('/hollow')}
			class="rounded-lg bg-neutral-800 px-6 py-3 text-white hover:bg-neutral-700"
		>
			Hollow
		</a>
		<a
			href={resolve('/tunnel-gen')}
			class="rounded-lg bg-neutral-800 px-6 py-3 text-white hover:bg-neutral-700"
		>
			Tunnels 1
		</a>
	</nav>
</main>
