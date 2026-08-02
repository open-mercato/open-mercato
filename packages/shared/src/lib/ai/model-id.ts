/**
 * Helpers for composing the `provider/model` display/persistence string used
 * across the AI runtime (e.g. inbox_ops `InboxProposal.llmModel`, the AI route
 * and settings responses).
 *
 * @see packages/ai-assistant/src/modules/ai_assistant/lib/model-factory.ts
 */

/**
 * Joins a provider id and a model id into the canonical `provider/model`
 * string, without doubling an existing prefix.
 *
 * A gateway model id may itself be `vendor/model` (e.g. OpenRouter's
 * `anthropic/claude-sonnet-4.5`); that MUST still be prefixed with the gateway
 * to `openrouter/anthropic/claude-sonnet-4.5`. Only an already-`${providerId}/`
 * prefixed model id is passed through unchanged, so re-composing a value that
 * already carries the provider (e.g. `openrouter/anthropic/…`) never yields
 * `openrouter/openrouter/anthropic/…`.
 */
export function joinProviderModel(providerId: string, modelId: string): string {
  const prefix = `${providerId}/`
  return modelId.startsWith(prefix) ? modelId : `${providerId}/${modelId}`
}
