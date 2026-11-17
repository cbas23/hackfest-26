<script lang="ts">
	import type { Baseline, Severity } from '../detect.js';

	interface Point {
		week: number;
		value?: number;
		incident?: string;
		now?: boolean;
	}

	let {
		points,
		baseline,
		severity,
		label
	}: {
		points: Point[];
		baseline: Baseline;
		severity?: Severity;
		label: string;
	} = $props();

	const W = 760;
	const H = 230;
	const P = { l: 34, r: 16, t: 28, b: 26 };

	const max = $derived(
		Math.ceil((Math.max(baseline.high, ...points.map((p) => p.value ?? 0)) * 1.25) / 10) * 10
	);
	const x = (i: number) => P.l + (i / Math.max(points.length - 1, 1)) * (W - P.l - P.r);
	const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
	const ticks = $derived([0, 1, 2, 3, 4].map((i) => Math.round((max / 4) * i)));

	const known = $derived(points.map((p, i) => ({ ...p, i })).filter((p) => p.value !== undefined));
	const line = $derived(known.map((p) => `${x(p.i)},${y(p.value!)}`).join(' '));
	const area = $derived(
		known.length
			? `M${x(known[0].i)},${y(0)} L${line.replaceAll(' ', ' L')} L${x(known[known.length - 1].i)},${y(0)} Z`
			: ''
	);
	const now = $derived(known.find((p) => p.now));
	const hot = $derived(
		severity === 'alert' ? '#ef4444' : severity === 'watch' ? '#f59e0b' : '#38bdf8'
	);
</script>

<svg viewBox="0 0 {W} {H}" class="w-full" role="img" aria-label={label}>
	<defs>
		<linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stop-color="#3b82f6" stop-opacity="0.35" />
			<stop offset="1" stop-color="#3b82f6" stop-opacity="0" />
		</linearGradient>
	</defs>

	{#each ticks as t (t)}
		<line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="rgb(255 255 255 / 0.06)" />
		<text x={P.l - 8} y={y(t) + 4} text-anchor="end" font-size="11" fill="#94a3b8">{t}</text>
	{/each}

	<!-- normal range band and normal line -->
	<rect
		x={P.l}
		y={y(baseline.high)}
		width={W - P.l - P.r}
		height={Math.max(y(baseline.low) - y(baseline.high), 1)}
		fill="rgb(148 163 184 / 0.22)"
		stroke="rgb(203 213 225 / 0.35)"
	/>
	<line
		x1={P.l}
		x2={W - P.r}
		y1={y(baseline.mean)}
		y2={y(baseline.mean)}
		stroke="#e2e8f0"
		stroke-width="1.5"
		stroke-dasharray="6 4"
	/>
	<text x={P.l + 8} y={y(baseline.high) - 5} font-size="11" fill="#cbd5e1"
		>Normal range ({Math.round(baseline.low)}–{Math.round(baseline.high)})</text
	>

	{#if area}<path d={area} fill="url(#trend-fill)" />{/if}
	<polyline points={line} fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linejoin="round" />

	{#each points as p, i (p.week)}
		{#if p.value !== undefined && !p.now}
			<circle
				cx={x(i)}
				cy={y(p.value)}
				r={p.incident ? 5 : 3.5}
				fill={p.incident ? '#f59e0b' : '#3b82f6'}
				stroke="#121a2c"
				stroke-width="1.5"
			>
				<title>Week {p.week}: {p.value}{p.incident ? ` (${p.incident})` : ''}</title>
			</circle>
		{/if}
		{#if p.value === undefined}
			<circle
				cx={x(i)}
				cy={y(baseline.mean)}
				r="5"
				fill="none"
				stroke="#64748b"
				stroke-dasharray="2 2"
			/>
		{/if}
		<text
			x={x(i)}
			y={H - 6}
			text-anchor="middle"
			font-size="11"
			fill={p.now ? '#e2e8f0' : '#64748b'}>{p.now ? 'Now' : `W${p.week}`}</text
		>
	{/each}

	{#if now}
		<line
			x1={x(now.i)}
			x2={x(now.i)}
			y1={y(now.value!)}
			y2={y(0)}
			stroke={hot}
			stroke-opacity="0.5"
		/>
		<circle cx={x(now.i)} cy={y(now.value!)} r="12" fill={hot} opacity="0.25" />
		<circle cx={x(now.i)} cy={y(now.value!)} r="6" fill={hot} stroke="white" stroke-width="2" />
		<g transform="translate({Math.min(x(now.i), W - P.r - 52)}, {y(now.value!) - 34})">
			<rect
				x="-52"
				y="-4"
				width="104"
				height="24"
				rx="5"
				fill="rgb(127 29 29 / 0.85)"
				stroke={hot}
			/>
			<text x="0" y="13" text-anchor="middle" font-size="13" font-weight="600" fill="#fecaca"
				>{now.value} patients</text
			>
		</g>
	{/if}
</svg>
