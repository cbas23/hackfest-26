<script lang="ts">
	import type { AlertKind } from '#lib/hollow/alerts.js';
	import ZapOffIcon from '@lucide/svelte/icons/zap-off';
	import WindIcon from '@lucide/svelte/icons/wind';
	import DropletOffIcon from '@lucide/svelte/icons/droplet-off';
	import HeartPulseIcon from '@lucide/svelte/icons/heart-pulse';

	let { kind, class: className = 'size-3.5' }: { kind: AlertKind | 'sickness'; class?: string } =
		$props();

	const ICONS = {
		blackout: ZapOffIcon,
		air: WindIcon,
		water: DropletOffIcon,
		sickness: HeartPulseIcon
	};
	const Icon = $derived(ICONS[kind]);
</script>

<Icon class={className} aria-hidden="true" />
