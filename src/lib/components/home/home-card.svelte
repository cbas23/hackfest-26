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
	import { exampleAddress, parseAddress, placeByKey } from './address.js';
	import { directions, searchPlaces, type End } from './directions.svelte.js';
	import { home, mapNav, setAddress } from './home-state.svelte.js';
	import PlaceIcon from './place-icon.svelte';

	/**
	 * The viewer's home and directions in one card. It grows with the task: an address form while
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

<section class="mx-3 mt-4" aria-labelledby="home-heading">
	<h2 id="home-heading" class="mb-2 px-3 text-xs font-medium text-muted-foreground">
		{directions.open ? 'Directions' : 'Your home'}
	</h2>
	<div class="rounded-lg border bg-card p-2.5">
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
	</div>
</section>

{#snippet homeRow(place: Place)}
	<div class="flex flex-col gap-2.5">
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
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="ghost" size="icon-sm" aria-label="Home options">
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
		</div>
		{#if home.pickingHome}
			<div class="flex">{@render pickHomeButton()}</div>
		{:else}
			<Button size="sm" class="w-full" onclick={startDirections}>
				<RouteIcon />Directions from home
			</Button>
		{/if}
	</div>
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
	<div class="flex flex-col gap-2">
		<form class="flex gap-1.5" onsubmit={submit}>
			<Input
				bind:value={text}
				placeholder="Block, e.g. {example}"
				aria-label="Home block"
				aria-invalid={error ? true : undefined}
				class="h-8"
				oninput={() => (error = '')}
			/>
			<Button type="submit" size="sm" disabled={!text.trim()}>Set</Button>
		</form>
		{#if error}<p class="text-xs text-destructive">{error}</p>{/if}
		<div class="flex gap-1.5">
			{@render pickHomeButton()}
			{#if homePlace}
				<Button variant="outline" size="sm" onclick={stopEditing}>Cancel</Button>
			{:else}
				<Button variant="ghost" size="sm" onclick={startDirections}>
					<RouteIcon />Directions
				</Button>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet planner()}
	<div class="flex flex-col gap-2">
		<div class="flex items-start gap-2">
			<div class="flex flex-col items-center gap-1 pt-2.5" aria-hidden="true">
				<span class="size-2.5 rounded-full border-2 border-foreground bg-sky-500"></span>
				<span class="h-6 border-l-2 border-dotted border-muted-foreground"></span>
				<span class="size-2.5 rounded-full bg-destructive"></span>
			</div>
			<div class="flex min-w-0 flex-1 flex-col gap-1.5">
				{#each ENDS as { end, label } (end)}
					{@const place = end === 'from' ? directions.fromPlace : directions.toPlace}
					{@const picking = directions.picking === end}
					<div class="relative flex gap-1">
						<Input
							class={cn('h-8', picking && 'border-primary')}
							placeholder={picking ? 'Click a place on the map…' : label}
							aria-label={label}
							autocomplete="off"
							value={field === end ? query : endLabel(place)}
							onfocus={() => ((field = end), (query = ''))}
							oninput={(e) => (query = e.currentTarget.value)}
							onblur={() => setTimeout(() => field === end && (field = null), 150)}
						/>
						<Button
							variant={picking ? 'default' : 'outline'}
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
			<div class="flex flex-col gap-1">
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => directions.close()}
					aria-label="Close directions"
					title="Close"><XIcon /></Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => directions.swap()}
					aria-label="Swap start and destination"
					title="Swap"><ArrowUpDownIcon /></Button
				>
			</div>
		</div>

		<div class="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
			<label class="flex items-center gap-1.5">
				<input type="checkbox" class="accent-primary" bind:checked={directions.permit} />
				Directorate permit
			</label>
			<label class="flex items-center gap-1.5">
				<input type="checkbox" class="accent-primary" bind:checked={directions.unregistered} />
				Unmapped routes
			</label>
		</div>

		{#if route}
			<div class="rounded-md bg-muted/50 p-2.5">
				<p class="text-base font-semibold">
					<span class="text-emerald-500">{minutes(route.seconds)} min</span>
					<span class="text-xs font-normal text-muted-foreground"
						>· {km(route.walkMeters)} on foot{route.liftMeters
							? ` · ${km(route.liftMeters)} by shaft`
							: ''}</span
					>
				</p>
				<ol class="mt-2 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Route levels">
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
								{SHAFTS[ride.shaft].name}
							</li>
						{/if}
					{/each}
				</ol>
			</div>
		{:else if route === null}
			<p class="rounded-md bg-muted/50 p-2.5 text-xs text-amber-500">
				No route. Blocked tunnels cut every way there, or it needs a permit or an unmapped shaft;
				try the options above.
			</p>
		{/if}
	</div>
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
