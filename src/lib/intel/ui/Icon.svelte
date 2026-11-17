<script lang="ts" module>
	/** Small stroke icons (24×24 grid), drawn here so the page needs no icon package. */
	export const ICONS = {
		overview: 'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0M12 3v9l6 3',
		intel: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
		map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
		agents:
			'M12 8V4H8M4 12a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM9 13v1M15 13v1',
		resources: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
		alert: 'M12 3 2 20h20L12 3zM12 10v4M12 17.5v.5',
		up: 'M12 19V5M5 12l7-7 7 7',
		scale: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
		pill: 'M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7zM8.5 8.5l7 7',
		file: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
		check: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM8 12l3 3 5-6',
		pulse: 'M3 12h4l3-8 4 16 3-8h4',
		clinic: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v8M8 12h8',
		people:
			'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6',
		building: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6M9 11h.01M15 11h.01',
		sensor: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10',
		bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
		wrench: 'M14 7a4 4 0 0 0 5 5l2 2-7 7-2-2a4 4 0 0 0-5-5L3 10l7-7z',
		chevron: 'M9 6l6 6-6 6',
		bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.5 1 2.5h6c0-1 .4-1.9 1-2.5A6 6 0 0 0 12 3z',
		target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
		box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5'
	} as const;
	export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
	let { name, class: cls = 'h-5 w-5' }: { name: IconName; class?: string } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={cls}
	aria-hidden="true"
>
	<path d={ICONS[name]} />
</svg>
