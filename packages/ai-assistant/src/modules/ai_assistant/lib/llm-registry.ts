/**
 * Bootstrapped access to the shared `llmProviderRegistry` singleton.
 *
 * The registry in `@open-mercato/shared` is a plain module-level singleton
 * with no self-registration: built-in adapters and OpenAI-compatible presets
 * only exist after `./llm-bootstrap` has been evaluated. A module that reads
 * the shared singleton directly therefore sees an empty registry whenever it
 * happens to be the first thing a cold process loads, and
 * `resolveFirstConfigured()` reports "no provider configured" even though the
 * environment carries valid credentials.
 *
 * Every module inside `ai_assistant` imports the registry from here so that
 * bootstrap is guaranteed by the import graph rather than by which route the
 * user happens to hit first. `lib/__tests__/llm-registry-imports.test.ts`
 * enforces that rule.
 *
 * @see ./llm-bootstrap.ts
 * @see packages/shared/src/lib/ai/llm-provider-registry.ts
 */

import './llm-bootstrap'

export {
  llmProviderRegistry,
  type LlmProviderRegistry,
  type ResolveFirstConfiguredOptions,
} from '@open-mercato/shared/lib/ai/llm-provider-registry'
