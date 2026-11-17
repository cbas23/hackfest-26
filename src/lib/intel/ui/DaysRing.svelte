<script lang="ts">
	/** Small pie ring: days of stock left out of a target, with the number in the middle. */
	let { days, target, ok }: { days: number; target: number; ok: boolean } = $props();

	const R = 18;
	const C = 2 * Math.PI * R;
	const share = $derived(Math.max(0, Math.min(1, days / target)));
	const color = $derived(ok ? '#34d399' : '#a78bfa');
</script>

<svg
	viewBox="0 0 44 44"
	class="h-11 w-11 shrink-0"
	role="img"
	aria-label="{days} of {target} days of stock"
>
	<circle cx="22" cy="22" r={R} fill="none" stroke="rgb(255 255 255 / 0.08)" stroke-width="5" />
	<circle
		cx="22"
		cy="22"
		r={R}
		fill="none"
		stroke={color}
		stroke-width="5"
		stroke-linecap="round"
		stroke-dasharray="{share * C} {C}"
		transform="rotate(-90 22 22)"
		style="transition: stroke-dasharray 0.6s ease"
	/>
	<text x="22" y="26" text-anchor="middle" font-size="12" font-weight="700" fill={color}
		>{days}d</text
	>
</svg>
