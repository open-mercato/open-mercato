/**
 * LLM provider bootstrap — registers built-in adapters and OpenAI-compatible
 * presets with the shared `llmProviderRegistry` singleton.
 *
 * This runs at module load via the side-effect import in `./ai-sdk.ts`.
 * Safe to call multiple times — each registration is idempotent (replaces
 * existing by id), so Next.js hot-reload does not duplicate providers.
 *
 * Adapter registration is wrapped in individual try/catch blocks. A
 * failing import (e.g. missing peer dependency) skips that adapter with a
 * a logger warning but leaves the rest of the registry working.
 *
 * @see packages/shared/src/lib/ai/llm-provider-registry.ts
 * @see .ai/specs/implemented/2026-04-14-llm-provider-ports-and-adapters.md
 */

import { createLogger } from '@open-mercato/shared/lib/logger'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { createAnthropicAdapter } from './llm-adapters/anthropic'
import { createGoogleAdapter } from './llm-adapters/google'
import { createOpenAICompatibleProvider } from './llm-adapters/openai'
import { OPENAI_COMPATIBLE_PRESETS } from './openai-compatible-presets'

const logger = createLogger('ai_assistant')

let bootstrapped = false

/**
 * Registers all built-in LLM providers with the shared singleton.
 * Idempotent — the second and subsequent calls are no-ops (unless the
 * registry was reset by a test, in which case registration runs again).
 */
export function registerBuiltInLlmProviders(): void {
  if (bootstrapped && llmProviderRegistry.list().length > 0) {
    return
  }

  // Native protocol adapters.
  try {
    llmProviderRegistry.register(createAnthropicAdapter())
  } catch (error) {
    logger.warn('Failed to register Anthropic adapter', { err: error })
  }

  try {
    llmProviderRegistry.register(createGoogleAdapter())
  } catch (error) {
    logger.warn('Failed to register Google adapter', { err: error })
  }

  // OpenAI-compatible presets — all share one protocol adapter under the
  // hood but appear as separate providers in the registry.
  for (const preset of OPENAI_COMPATIBLE_PRESETS) {
    try {
      llmProviderRegistry.register(createOpenAICompatibleProvider(preset))
    } catch (error) {
      logger.warn('Failed to register OpenAI-compatible preset', { presetId: preset.id, err: error })
    }
  }

  bootstrapped = true
}

/**
 * Resets the bootstrap state. Intended for tests that call
 * `llmProviderRegistry.reset()` and then want a fresh bootstrap run.
 */
export function resetLlmBootstrapState(): void {
  bootstrapped = false
}

// Auto-bootstrap on module load so any consumer importing from
// `@open-mercato/ai-assistant/lib/llm-bootstrap` triggers registration.
registerBuiltInLlmProviders()
