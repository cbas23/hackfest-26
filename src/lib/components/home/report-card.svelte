<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { LEVELS } from '#lib/hollow/data.js';
	import { REPORT_MAX_LENGTH } from '#lib/hollow/report.js';
	import { live } from '#lib/live/state.svelte.js';
	import { cn } from '#lib/utils.js';
	import { fade } from 'svelte/transition';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import CheckIcon from '@lucide/svelte/icons/circle-check';
	import AlertIcon from '@lucide/svelte/icons/circle-alert';
	import SendIcon from '@lucide/svelte/icons/send';
	import { placeByKey } from './address.js';
	import { home } from './home-state.svelte.js';
	import { report, sendReport } from './report.svelte.js';

	/**
	 * The Report section: a button that opens a message box. The report agent edits the city's
	 * state to match the report (the map updates live); the line under the button says how it
	 * is going and clears a moment after it succeeds.
	 */

	const homePlace = $derived(placeByKey(home.address));
	const offline = $derived(live.status === 'offline');
	let open = $state(false);
	let text = $state('');
	const tooLong = $derived(text.length > REPORT_MAX_LENGTH);
	const canSend = $derived(!!homePlace && !!text.trim() && !tooLong);

	function send(e?: SubmitEvent) {
		e?.preventDefault();
		if (!canSend || !homePlace) return;
		// The agent works in the background: close the dialog and show progress under the button.
		void sendReport(text.trim(), homePlace.key);
		text = '';
		open = false;
	}
</script>

<section class="px-4 pt-4 pb-5" aria-labelledby="report-heading">
	<h2 id="report-heading" class="mb-2 text-xs font-medium text-muted-foreground">Report</h2>
	<Button
		size="sm"
		class="w-full"
		disabled={!homePlace || offline || report.status === 'working'}
		onclick={() => (open = true)}
	>
		<MegaphoneIcon />Send a report
	</Button>
	<div class="text-xs" role="status" aria-live="polite">
		{#if report.status === 'working'}
			<p class="mt-3 flex items-center gap-2 text-muted-foreground" transition:fade>
				<LoaderIcon class="size-4 shrink-0 animate-spin" aria-hidden="true" />Reviewing report…
			</p>
		{:else if report.status === 'done'}
			<p class="mt-3 flex items-center gap-2" transition:fade>
				<CheckIcon class="size-4 shrink-0 text-(--status-normal)" aria-hidden="true" />Report
				received
			</p>
		{:else if report.status === 'failed'}
			<p class="mt-3 flex items-start gap-2 text-destructive" transition:fade>
				<AlertIcon class="size-4 shrink-0" aria-hidden="true" />{report.error}
			</p>
		{:else if offline}
			<p class="mt-2 text-[11px] text-muted-foreground">Reports need the live city connection.</p>
		{:else if !homePlace}
			<p class="mt-2 text-[11px] text-muted-foreground">Save your home above to send a report.</p>
		{/if}
	</div>
</section>

<Dialog.Root bind:open>
	<Dialog.Content>
		<form class="flex flex-col gap-4" onsubmit={send}>
			<Dialog.Header>
				<Dialog.Title>Report a problem</Dialog.Title>
				<Dialog.Description>
					{#if homePlace}
						From {homePlace.label} · {LEVELS[homePlace.floor].code}
						{LEVELS[homePlace.floor].name}.
					{/if}
					The report desk reads it with the current state of the city and updates the map. All data is
					simulated.
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-1.5">
				<Textarea
					bind:value={text}
					rows={4}
					class="max-h-48"
					placeholder="e.g. There's bad air in my house right now"
					aria-label="What's wrong"
					aria-invalid={tooLong}
					onkeydown={(e) => {
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
					}}
				/>
				<span
					class={cn(
						'self-end text-[11px] text-muted-foreground tabular-nums',
						tooLong && 'text-destructive'
					)}
				>
					{text.length}/{REPORT_MAX_LENGTH}
				</span>
			</div>
			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={!canSend}><SendIcon />Send report</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
