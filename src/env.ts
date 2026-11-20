import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_CONVEX_URL: {
		public: true,
		description:
			'Convex deployment URL for the live events (written to .env.local by `bun run dev:convex`). Unset: the map runs offline on the starter scenario.',
		schema: (value) => value || undefined
	},
	OPENROUTER_API_KEY: {
		description:
			'OpenRouter API key for the AI SDK (server only, see `#lib/server/ai.ts`). Unset: AI calls throw.',
		schema: (value) => value || undefined
	}
});
