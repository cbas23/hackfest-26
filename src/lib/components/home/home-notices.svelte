<script lang="ts">
	import { flip } from 'svelte/animate';
	import { backOut, cubicIn } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import type { TransitionConfig } from 'svelte/transition';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { homeNotices, type HomeNotice, type NoticeKind } from '#lib/hollow/notices.js';
	import { STATUS_INFO } from '#lib/hollow/status.js';
	import { getHollow, simulateFloor } from '#lib/hollow/simulation.js';
	import { live } from '#lib/live/state.svelte.js';
	import { cn } from '#lib/utils.js';
	import BellIcon from '@lucide/svelte/icons/bell';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import DropletsIcon from '@lucide/svelte/icons/droplets';
	import FanIcon from '@lucide/svelte/icons/fan';
	import WindIcon from '@lucide/svelte/icons/wind';
	import XIcon from '@lucide/svelte/icons/x';
	import ZapOffIcon from '@lucide/svelte/icons/zap-off';
	import { placeByKey } from './address.js';
	import { home, mapNav, type LayerId } from './home-state.svelte.js';

	let { class: className = '' }: { class?: string } = $props();

	const KIND: Record<NoticeKind, { icon: typeof ZapOffIcon; layer: LayerId | null }> = {
		power: { icon: ZapOffIcon, layer: 'power' },
		water: { icon: DropletsIcon, layer: 'water' },
		air: { icon: FanIcon, layer: 'air' },
		sickness: { icon: WindIcon, layer: 'sickness' }
	};

	const place = $derived(placeByKey(home.address));
	/** The home's notices, recomputed whenever the live state changes. */
	const notices = $derived.by<HomeNotice[]>(() => {
		void live.version;
		return place ? homeNotices(simulateFloor(getHollow().floor(place.floor)), place) : [];
	});

	/** Notices the viewer closed, for the current address. */
	const dismissed = new SvelteSet<string>();
	/** True for a few seconds after the address changes, to say there's nothing to report. */
	let allClear = $state(false);
	let clearTimer: ReturnType<typeof setTimeout> | undefined;

	// ── Live changes ─────────────────────────────────────────────────────────
	type Change = 'new' | 'worse' | 'better' | 'updated';
	const CHANGE_LABEL: Record<Change, string> = {
		new: 'New',
		worse: 'Worsened',
		better: 'Improving',
		updated: 'Updated'
	};
	/** What happened to each kind's notice in the last simulation update (shown for a while). */
	const changes = new SvelteMap<NoticeKind, Change>();
	/** Bumped on every change to a kind's notice, to replay its card's animation. */
	const stamps = new SvelteMap<NoticeKind, number>();
	/** Notices that just went away because the problem was fixed. */
	let resolved = $state<{ id: string; kind: NoticeKind; title: string }[]>([]);
	/** Pending timers (not reactive), cleared when the component goes away. */
	const timers: ReturnType<typeof setTimeout>[] = [];
	const later = (ms: number, fn: () => void) => void timers.push(setTimeout(fn, ms));

	const RESOLVED_TITLE: Record<NoticeKind, string> = {
		power: 'Power restored at your home',
		water: 'Water good again',
		air: 'Air good again',
		sickness: 'Lung sickness easing'
	};

	const rank = (n: HomeNotice) => STATUS_INFO[n.severity].rank;
	const byKind = (list: HomeNotice[]) => new Map(list.map((n) => [n.kind, n]));

	let prevAddress: string | null | undefined;
	let prev = new Map<NoticeKind, HomeNotice>();

	function mark(kind: NoticeKind, change: Change) {
		changes.set(kind, change);
		stamps.set(kind, (stamps.get(kind) ?? 0) + 1);
		const stamp = stamps.get(kind);
		later(4500, () => {
			if (stamps.get(kind) === stamp) changes.delete(kind);
		});
	}

	// Compare each simulation update with the last one: a new address starts over and shows
	// everything; a change on the same address flags what got worse, better or was fixed.
	$effect(() => {
		const list = notices;
		const address = home.address;
		untrack(() => {
			const next = byKind(list);
			if (address !== prevAddress) {
				prevAddress = address;
				prev = next;
				dismissed.clear();
				changes.clear();
				resolved = [];
				clearTimeout(clearTimer);
				allClear = !!place && !list.length;
				if (allClear) clearTimer = setTimeout(() => (allClear = false), 5000);
				return;
			}
			for (const [kind, n] of next) {
				const before = prev.get(kind);
				if (!before) mark(kind, 'new');
				else if (rank(n) !== rank(before)) mark(kind, rank(n) > rank(before) ? 'worse' : 'better');
				else if (n.title !== before.title || n.detail !== before.detail) mark(kind, 'updated');
			}
			for (const [kind] of prev) {
				if (next.has(kind)) continue;
				changes.delete(kind);
				const item = { id: `${kind}:${Date.now()}`, kind, title: RESOLVED_TITLE[kind] };
				resolved = [...resolved.filter((r) => r.kind !== kind), item];
				later(6000, () => (resolved = resolved.filter((r) => r !== item)));
			}
			if (next.size) allClear = false;
			prev = next;
		});
	});
	$effect(() => () => {
		clearTimeout(clearTimer);
		for (const t of timers) clearTimeout(t);
	});

	const shown = $derived(notices.filter((n) => !dismissed.has(n.id)));
	const hidden = $derived(notices.length - shown.length);

	const motion = (ms: number) => (prefersReducedMotion.current ? 0 : ms);

	/** In: slides in from the right edge, overshooting a little, and sharpens from a blur. */
	function slideIn(_: Element, { delay = 0 } = {}): TransitionConfig {
		return {
			delay: motion(delay),
			duration: motion(420),
			easing: backOut,
			css: (t, u) =>
				`transform: translateX(${u * 110}%) scale(${0.92 + t * 0.08}); opacity: ${Math.min(1, t * 1.6)}; filter: blur(${u * 4}px)`
		};
	}

	/** Out: slides back to the right, then the gap closes so the cards below move up. */
	function slideOut(node: Element): TransitionConfig {
		const h = (node as HTMLElement).offsetHeight;
		return {
			duration: motion(320),
			easing: cubicIn,
			css: (t, u) => {
				const slide = Math.min(1, u * 1.6);
				const shrink = Math.max(0, (u - 0.45) / 0.55);
				return `transform: translateX(${slide * 110}%); opacity: ${1 - slide}; height: ${h * (1 - shrink)}px; margin-bottom: ${-8 * shrink}px; overflow: hidden`;
			}
		};
	}

	function open(n: HomeNotice) {
		if (!place) return;
		const layer = KIND[n.kind].layer;
		if (layer) home.section = layer;
		mapNav.focusPlace(place);
	}
</script>

{#if place}
	<div
		class={cn(
			'pointer-events-none flex w-80 max-w-[calc(100%-2rem)] flex-col items-end gap-2',
			className
		)}
		role="region"
		aria-label="Notifications for {place.label}"
		aria-live="polite"
	>
		<!-- A new address replays the whole stack. -->
		{#key home.address}
			{#if hidden && !shown.length}
				<div>
					<Button
						variant="outline"
						size="sm"
						class="pointer-events-auto bg-background/90 backdrop-blur transition-none"
						aria-label="Show {hidden} notification{hidden === 1 ? '' : 's'} for your home"
						onclick={() => dismissed.clear()}
					>
						<BellIcon />
						Your home
						<span
							class="grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white tabular-nums"
							>{hidden}</span
						>
					</Button>
				</div>
			{/if}

			{#if shown.length > 1}
				<button
					type="button"
					class="pointer-events-auto rounded px-1.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					in:slideIn|global
					onclick={() => notices.forEach((n) => dismissed.add(n.id))}>Dismiss all</button
				>
			{/if}

			{#each shown as n, i (n.id)}
				{@const info = STATUS_INFO[n.severity]}
				{@const Icon = KIND[n.kind].icon}
				{@const urgent = n.severity === 'critical' || n.severity === 'high'}
				{@const change = changes.get(n.kind)}
				<div
					class="pointer-events-auto w-full"
					animate:flip={{ duration: motion(260) }}
					in:slideIn|global={{ delay: 80 + i * 90 }}
					out:slideOut
				>
					{#key stamps.get(n.kind)}
						<Alert.Root
							role="status"
							class={cn(
								change && 'notice-changed',
								'notice overflow-hidden border-l-4 bg-background/95 py-2.5 pr-10 pl-3 shadow-lg backdrop-blur',
								urgent && 'notice-urgent'
							)}
							style="--notice:{info.color};border-color:color-mix(in oklab, {info.color} 50%, var(--border));border-left-color:{info.color}"
						>
							<Icon class="notice-icon size-4!" style="color:{info.color}" aria-hidden="true" />
							<Alert.Title class="flex items-center gap-1.5 text-sm font-semibold">
								<span>{n.title}</span>
								{#if change}
									<span
										class="notice-badge rounded-full px-1.5 py-px text-[9px] font-semibold tracking-wide uppercase"
										style="color:{info.color};background:color-mix(in oklab, {info.color} 18%, transparent)"
										>{CHANGE_LABEL[change]}</span
									>
								{/if}
							</Alert.Title>
							<Alert.Description class="flex flex-col gap-1 text-xs">
								<span
									class="text-[10px] font-medium tracking-wide uppercase"
									style="color:{info.color}">{info.label} · {place.label}</span
								>
								<span>{n.detail}</span>
								<button
									type="button"
									class="w-fit text-[11px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
									onclick={() => open(n)}>Show on the map</button
								>
							</Alert.Description>
							<Alert.Action class="top-1.5 right-1.5">
								<Button
									variant="ghost"
									size="icon-sm"
									class="size-6"
									aria-label="Dismiss {n.title}"
									onclick={() => dismissed.add(n.id)}><XIcon /></Button
								>
							</Alert.Action>
						</Alert.Root>
					{/key}
				</div>
			{/each}

			{#each resolved as r (r.id)}
				{@const Icon = KIND[r.kind].icon}
				<div
					class="pointer-events-auto w-full"
					animate:flip={{ duration: motion(260) }}
					in:slideIn
					out:slideOut
				>
					<Alert.Root
						role="status"
						class="notice border-l-4 border-emerald-500/50 border-l-emerald-500 bg-background/95 py-2.5 pr-10 shadow-lg backdrop-blur"
						style="--notice:#10b981"
					>
						<Icon class="notice-icon text-emerald-500" aria-hidden="true" />
						<Alert.Title class="text-sm font-semibold">{r.title}</Alert.Title>
						<Alert.Description class="text-xs">Resolved · {place.label}</Alert.Description>
						<Alert.Action class="top-1.5 right-1.5">
							<Button
								variant="ghost"
								size="icon-sm"
								class="size-6"
								aria-label="Dismiss {r.title}"
								onclick={() => (resolved = resolved.filter((x) => x !== r))}><XIcon /></Button
							>
						</Alert.Action>
					</Alert.Root>
				</div>
			{/each}

			{#if allClear && !notices.length}
				<div class="pointer-events-auto w-full" in:slideIn|global={{ delay: 80 }} out:slideOut>
					<Alert.Root
						role="status"
						class="notice border-l-4 border-emerald-500/50 border-l-emerald-500 bg-background/95 py-2.5 shadow-lg backdrop-blur"
						style="--notice:#10b981"
					>
						<CircleCheckIcon class="notice-icon text-emerald-500" aria-hidden="true" />
						<Alert.Title class="text-sm font-semibold">All clear at your home</Alert.Title>
						<Alert.Description class="text-xs"
							>No alerts for {place.label} right now.</Alert.Description
						>
					</Alert.Root>
				</div>
			{/if}
		{/key}
	</div>
{/if}

<style>
	/* A light sweep across the card as it lands. */
	:global(.notice)::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: linear-gradient(
			100deg,
			transparent 30%,
			color-mix(in oklab, var(--notice) 22%, transparent) 50%,
			transparent 70%
		);
		transform: translateX(-100%);
		animation: notice-sweep 900ms 350ms ease-out both;
	}
	/* The icon pops in after the card, and keeps pulsing on urgent ones. */
	:global(.notice-icon) {
		animation: notice-pop 420ms 300ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	:global(.notice-urgent .notice-icon) {
		animation:
			notice-pop 420ms 300ms cubic-bezier(0.34, 1.56, 0.64, 1) both,
			notice-pulse 1.8s 900ms ease-in-out infinite;
	}
	/* A card whose notice just changed flashes its outline. */
	:global(.notice-changed) {
		animation: notice-flash 1.2s ease-out;
	}
	:global(.notice-badge) {
		animation: notice-pop 360ms 150ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	@keyframes notice-flash {
		0%,
		40% {
			box-shadow:
				0 0 0 2px var(--notice),
				0 0 24px -4px var(--notice);
		}
	}
	@keyframes notice-sweep {
		to {
			transform: translateX(100%);
		}
	}
	@keyframes notice-pop {
		from {
			transform: scale(0) rotate(-30deg);
			opacity: 0;
		}
	}
	@keyframes notice-pulse {
		50% {
			transform: scale(1.18);
			filter: drop-shadow(0 0 4px var(--notice));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.notice)::after,
		:global(.notice-icon),
		:global(.notice-urgent .notice-icon),
		:global(.notice-changed),
		:global(.notice-badge) {
			animation: none;
		}
	}
</style>
