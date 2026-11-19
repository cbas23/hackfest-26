<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { LEVELS } from '#lib/hollow/data.js';
	import { placeColor } from '#lib/hollow/nav.js';
	import HouseIcon from '@lucide/svelte/icons/house';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import LocateIcon from '@lucide/svelte/icons/locate-fixed';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import XIcon from '@lucide/svelte/icons/x';
	import { exampleAddress, parseAddress, placeByKey } from './address.js';
	import { home, mapNav, setAddress } from './home-state.svelte.js';
	import PlaceIcon from './place-icon.svelte';

	const place = $derived(placeByKey(home.address));
	let editing = $state(false);
	let text = $state('');
	let error = $state('');
	const example = exampleAddress();
	const showForm = $derived(!place || editing);

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const found = parseAddress(text);
		if (typeof found === 'string') {
			error = found;
			return;
		}
		setAddress(found.key);
		mapNav.focusPlace(found);
		editing = false;
		text = '';
		error = '';
	}

	function pick() {
		if (home.pickingHome) {
			home.pickingHome = false;
			return;
		}
		// Blocks are picked on a single level: open the home's level, or the one last shown.
		if (home.overview) mapNav.goTo(place?.floor ?? home.level);
		home.pickingHome = true;
		editing = false;
		error = '';
	}
</script>

<section class="mx-3 mt-4" aria-labelledby="home-heading">
	<h2 id="home-heading" class="mb-2 px-3 text-xs font-medium text-muted-foreground">Your home</h2>
	<div class="flex flex-col gap-2 rounded-lg border bg-card p-3">
		{#if place && !editing}
			<div class="flex items-center gap-3">
				<PlaceIcon kind="block" color={placeColor(place)} size={32} />
				<div class="flex min-w-0 flex-1 flex-col">
					<span class="truncate text-sm font-medium">{place.label}</span>
					<span class="truncate text-xs text-muted-foreground"
						>{LEVELS[place.floor].code} {LEVELS[place.floor].name}</span
					>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Show my home on the map"
					title="Show on the map"
					onclick={() => mapNav.focusPlace(place)}><LocateIcon /></Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Remove my home"
					title="Remove"
					onclick={() => setAddress(null)}><XIcon /></Button
				>
			</div>
		{/if}

		{#if showForm}
			<form class="flex gap-1.5" onsubmit={submit}>
				<Input
					bind:value={text}
					placeholder="Block, e.g. {example}"
					aria-label="Home block"
					aria-invalid={error ? true : undefined}
					class="h-8 text-sm"
					oninput={() => (error = '')}
				/>
				<Button type="submit" size="sm" disabled={!text.trim()}>Set</Button>
			</form>
			{#if error}<p class="text-xs text-destructive">{error}</p>{/if}
		{/if}

		<div class="flex gap-1.5">
			<Button
				variant={home.pickingHome ? 'default' : 'outline'}
				size="sm"
				class="flex-1"
				aria-pressed={home.pickingHome}
				onclick={pick}
			>
				<MapPinIcon />
				{home.pickingHome ? 'Click your block… (cancel)' : 'Pick on the map'}
			</Button>
			{#if place}
				<Button
					variant="outline"
					size="sm"
					aria-label={editing ? 'Stop typing an address' : 'Type an address'}
					title={editing ? 'Cancel' : 'Type an address'}
					onclick={() => ((editing = !editing), (error = ''))}
				>
					{#if editing}<XIcon />{:else}<PencilIcon />{/if}
				</Button>
			{/if}
		</div>
		{#if !place && !home.pickingHome}
			<p class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
				<HouseIcon class="size-3" /> Saved in this browser only
			</p>
		{/if}
	</div>
</section>
