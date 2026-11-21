<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { LEVELS, SHAFTS, SHAFT_COLORS } from '#lib/hollow/data.js';
	import { placeColor, type Place } from '#lib/hollow/nav.js';
	import { cn } from '#lib/utils.js';
	import RouteIcon from '@lucide/svelte/icons/route';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import HouseIcon from '@lucide/svelte/icons/house';
	import LocateIcon from '@lucide/svelte/icons/locate-fixed';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { exampleAddress, parseAddress, placeByKey } from './address.js';
	import { directions, searchPlaces, type End } from './directions.svelte.js';
	import { home, mapNav, setAddress } from './home-state.svelte.js';
	import PlaceIcon from './place-icon.svelte';

	/**
	 * The viewer's home and directions in one sidebar section. It grows with the task: an address form while
	 * no home is saved, a one-line home with a directions button once it is, and the route
	 * planner (starting from home) while directions are open.
	 */

	// ── Home ─────────────────────────────────────────────────────────────────
	const homePlace = $derived(placeByKey(home.address));
	let editing = $state(false);
	let text = $state('');
	let error = $state('');
	const example = exampleAddress();
	const showForm = $derived(!homePlace || editing);

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const found = parseAddress(text);
		if (typeof found === 'string') {
			error = found;
			return;
		}
		setAddress(found.key);
		mapNav.focusPlace(found);
		stopEditing();
	}

	function stopEditing() {
		editing = false;
		text = '';
		error = '';
	}

	function pickHome() {
		if (home.pickingHome) {
			home.pickingHome = false;
			return;
		}
		// Blocks are picked on a single level: open the home's level, or the one last shown.
		if (home.overview) mapNav.goTo(homePlace?.floor ?? home.level);
		home.pickingHome = true;
		// Phones: picking needs the map, so close the drawer over it.
		home.panelOpen = false;
		directions.picking = null;
		stopEditing();
	}

	// ── Directions ───────────────────────────────────────────────────────────
	/** The field being typed in, and what's typed. */
	let field = $state<End | null>(null);
	let query = $state('');
	const results = $derived(field ? searchPlaces(query, home.level) : []);
	const route = $derived(directions.route);

	const minutes = (s: number) => Math.max(1, Math.round(s / 60));
	const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

	function startDirections() {
		stopEditing();
		directions.start();
	}

	function choose(end: End, p: Place) {
		directions.set(end, p);
		field = null;
		query = '';
		// With one end set, show it; once both are set the map frames the route instead.
		if (!directions.route) {
			// On phones, keep the drawer open: the other end is still to fill in.
			const open = home.panelOpen;
			mapNav.focusPlace(p);
			home.panelOpen = open;
		}
	}

	/** How an end reads in its field: the saved home is named as such. */
	const endLabel = (p: Place | null) =>
		!p ? '' : p.key === home.address ? `Home · ${p.label}` : p.label;

	const ENDS = [
		{ end: 'from', label: 'Starting point' },
		{ end: 'to', label: 'Destination' }
	] as const;
</script>

<section
	class="flex flex-col gap-3 border-b border-sidebar-border px-4 pt-4 pb-5"
	aria-labelledby="home-heading"
>
	<div class="flex h-7 items-center justify-between gap-2">
		<h2 id="home-heading" class="text-xs font-medium text-muted-foreground">
			{directions.open ? 'Directions' : 'Your home'}
		</h2>
		{#if directions.open}
			<Button
				variant="ghost"
				size="icon-sm"
				class="-mr-2"
				onclick={() => directions.close()}
				aria-label="Close directions"
				title="Close"><XIcon /></Button
			>
		{:else if homePlace && !editing}
			{@render homeMenu()}
		{/if}
	</div>

	{#if directions.open}
		{@render planner()}
	{:else}
		{#if homePlace && !editing}
			{@render homeRow(homePlace)}
		{/if}
		{#if showForm}
			{@render addressForm()}
		{/if}
	{/if}
</section>

{#snippet homeMenu()}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" size="icon-sm" class="-mr-2" aria-label="Home options">
					<EllipsisIcon />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-48">
			<DropdownMenu.Item onSelect={() => (editing = true)}>
				<PencilIcon />Type a new address
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={pickHome}>
				<MapPinIcon />Pick on the map
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item variant="destructive" onSelect={() => setAddress(null)}>
				<TrashIcon />Remove my home
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

{#snippet homeRow(place: Place)}
	<button
		type="button"
		class="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
		title="Show on the map"
		aria-label="Show my home, {place.label}, on the map"
		onclick={() => mapNav.focusPlace(place)}
	>
		<PlaceIcon kind="block" color={placeColor(place)} size={36} />
		<span class="flex min-w-0 flex-1 flex-col">
			<span class="truncate text-sm font-semibold">{place.label}</span>
			<span class="truncate text-xs text-muted-foreground"
				>{LEVELS[place.floor].code} · {LEVELS[place.floor].name}</span
			>
		</span>
		<LocateIcon
			class="size-4 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100"
			aria-hidden="true"
		/>
	</button>
	{#if home.pickingHome}
		<div class="flex">{@render pickHomeButton()}</div>
	{:else}
		<Button size="sm" class="w-full" onclick={startDirections}>
			<RouteIcon />Directions from home
		</Button>
	{/if}
{/snippet}

{#snippet pickHomeButton()}
	<Button
		variant={home.pickingHome ? 'default' : 'outline'}
		size="sm"
		class="flex-1"
		aria-pressed={home.pickingHome}
		onclick={pickHome}
	>
		<MapPinIcon />
		{home.pickingHome ? 'Click your block… (cancel)' : 'Pick on the map'}
	</Button>
{/snippet}

{#snippet addressForm()}
	{#if !homePlace}
		<p class="text-xs text-muted-foreground">
			Save your block to get notices about it and directions from your door.
		</p>
	{/if}
	<form class="flex gap-1.5" onsubmit={submit}>
		<Input
			bind:value={text}
			placeholder="Block, e.g. {example}"
			aria-label="Home block"
			aria-invalid={error ? true : undefined}
			class="h-8 bg-background"
			oninput={() => (error = '')}
		/>
		<Button type="submit" size="sm" disabled={!text.trim()}>Set</Button>
	</form>
	{#if error}<p class="-mt-1 text-xs text-destructive">{error}</p>{/if}
	<div class="flex gap-1.5">
		{@render pickHomeButton()}
		{#if homePlace}
			<Button variant="ghost" size="sm" onclick={stopEditing}>Cancel</Button>
		{:else}
			<Button variant="ghost" size="sm" onclick={startDirections}>
				<RouteIcon />Directions
			</Button>
		{/if}
	</div>
{/snippet}

{#snippet planner()}
	<div class="flex items-stretch gap-2">
		<div class="flex w-4 flex-col items-center py-3" aria-hidden="true">
			<span class="size-2.5 shrink-0 rounded-full border-2 border-foreground bg-sky-500"></span>
			<span class="my-1 w-0 flex-1 border-l-2 border-dotted border-muted-foreground/60"></span>
			<span class="size-2.5 shrink-0 rounded-full bg-destructive"></span>
		</div>
		<div class="flex min-w-0 flex-1 flex-col gap-1.5">
			{#each ENDS as { end, label } (end)}
				{@const place = end === 'from' ? directions.fromPlace : directions.toPlace}
				{@const picking = directions.picking === end}
				<div class="relative flex gap-1">
					<Input
						class={cn('h-8 bg-background', picking && 'border-primary')}
						placeholder={picking ? 'Click a place on the map…' : label}
						aria-label={label}
						autocomplete="off"
						value={field === end ? query : endLabel(place)}
						onfocus={() => ((field = end), (query = ''))}
						oninput={(e) => (query = e.currentTarget.value)}
						onblur={() => setTimeout(() => field === end && (field = null), 150)}
					/>
					<Button
						variant={picking ? 'default' : 'ghost'}
						size="icon-sm"
						class="size-8 shrink-0"
						aria-label="Choose the {label.toLowerCase()} on the map"
						aria-pressed={picking}
						title="Choose on the map"
						onclick={() => {
							directions.pick(end);
							// Phones: picking needs the map, so close the drawer over it.
							if (directions.picking) home.panelOpen = false;
						}}><CrosshairIcon /></Button
					>
					{#if field === end}
						{@render suggestions(end, place)}
					{/if}
				</div>
			{/each}
		</div>
		<Button
			variant="ghost"
			size="icon-sm"
			class="self-center"
			onclick={() => directions.swap()}
			aria-label="Swap start and destination"
			title="Swap"><ArrowUpDownIcon /></Button
		>
	</div>

	{#if route}
		<div class="flex flex-col gap-2 border-t border-sidebar-border pt-3">
			<p class="flex items-baseline gap-2">
				<span class="text-2xl font-semibold tracking-tight text-emerald-500"
					>{minutes(route.seconds)} min</span
				>
				<span class="text-xs text-muted-foreground"
					>{km(route.walkMeters)} on foot{route.liftMeters
						? ` · ${km(route.liftMeters)} by shaft`
						: ''}</span
				>
			</p>
			<ol class="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Route levels">
				{#each route.legs as leg, i (i)}
					{@const shown = !home.overview && leg.floor === home.level}
					<li>
						<Button
							variant={shown ? 'default' : 'secondary'}
							size="xs"
							class="rounded-full"
							title="Show this part of the route"
							onclick={() => mapNav.showRoute(leg.floor)}>{LEVELS[leg.floor].code}</Button
						>
					</li>
					{#if route.rides[i]}
						{@const ride = route.rides[i]}
						<li class="text-muted-foreground" title="{SHAFTS[ride.shaft].status} shaft">
							<span style="color:{SHAFT_COLORS[SHAFTS[ride.shaft].status]}"
								>{ride.to > ride.from ? '▼' : '▲'}</span
							>
							Shaft
						</li>
					{/if}
				{/each}
			</ol>
		</div>
	{:else if route === null}
		<p class="flex gap-2 border-t border-sidebar-border pt-3 text-xs text-amber-500" role="status">
			<TriangleAlertIcon class="mt-px size-3.5 shrink-0" />
			No route. Blocked tunnels cut every way there.
		</p>
	{/if}
{/snippet}

{#snippet suggestions(end: End, place: Place | null)}
	<ul
		class="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover py-1 text-popover-foreground shadow-lg"
	>
		{#if homePlace && homePlace.key !== place?.key}
			<li>
				<button
					class="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-sm hover:bg-accent"
					onmousedown={() => choose(end, homePlace)}
				>
					<span
						class="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground"
						><HouseIcon class="size-3.5" /></span
					>
					<span class="min-w-0">
						<span class="block truncate">Home</span>
						<span class="block truncate text-xs text-muted-foreground">{homePlace.label}</span>
					</span>
				</button>
			</li>
		{/if}
		{#each results as p (p.key)}
			<li>
				<button
					class="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-accent"
					onmousedown={() => choose(end, p)}
				>
					<PlaceIcon kind={p.kind} color={placeColor(p)} size={24} />
					<span class="min-w-0">
						<span class="block truncate text-sm">{p.label}</span>
						<span class="block truncate text-xs text-muted-foreground">{p.sub}</span>
					</span>
				</button>
			</li>
		{:else}
			<li class="px-2.5 py-1.5 text-xs text-muted-foreground">No places found</li>
		{/each}
	</ul>
{/snippet}
