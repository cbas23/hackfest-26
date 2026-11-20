import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { OPENROUTER_API_KEY } from '$app/env/private';

/** DeepSeek's newest Flash snapshot on OpenRouter (pinned, so answers don't shift under us). */
export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash-1017';

let provider: ReturnType<typeof createOpenRouter> | undefined;

/**
 * An AI SDK model served through OpenRouter, for `generateText` / `streamText` / `generateObject`
 * from `ai`. Server only: the key never reaches the browser.
 */
export function aiModel(id: string = DEFAULT_MODEL) {
	if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set (add it to .env.local)');
	provider ??= createOpenRouter({ apiKey: OPENROUTER_API_KEY });
	return provider.chat(id);
}
