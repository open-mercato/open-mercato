import type { AwilixContainer } from 'awilix'
import type { ZodTypeAny } from 'zod'

export type AiAgentExecutionMode = 'chat' | 'object'

export type AiAgentMutationPolicy =
  | 'read-only'
  | 'confirm-required'
  | 'destructive-confirm-required'

export type AiAgentAcceptedMediaType = 'image' | 'pdf' | 'file'

export type AiAgentDataOperation = 'read' | 'search' | 'aggregate'

export interface AiAgentPageContextInput {
  entityType: string
  recordId: string
  container: AwilixContainer
  tenantId: string | null
  organizationId: string | null
}

export interface AiAgentStructuredOutput<TSchema = ZodTypeAny> {
  schemaName: string
  schema: TSchema
  mode?: 'generate' | 'stream'
}

export interface AiAgentDataCapabilities {
  entities?: string[]
  operations?: AiAgentDataOperation[]
  searchableFields?: string[]
}

export interface AiAgentSuggestion {
  label: string
  prompt: string
}

export interface AiAgentDefinition {
  id: string
  moduleId: string
  label: string
  description: string
  systemPrompt: string
  allowedTools: string[]
  suggestions?: AiAgentSuggestion[]
  executionMode?: AiAgentExecutionMode
  /**
   * Optional provider id this agent prefers (e.g. `'openai'`, `'anthropic'`).
   * Must match a registered `LlmProvider.id`. When the named provider is
   * registered but unconfigured at runtime the factory falls through
   * transparently to the next configured provider.
   *
   * Phase 1 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  defaultProvider?: string
  /**
   * Optional model id fed through `createModelFactory` for this agent.
   * Accepts either a plain model id (`claude-haiku-4-5-20251001`) or a
   * slash-qualified `<provider>/<model>` shorthand (e.g. `openai/gpt-5-mini`).
   * When the slash form is used the prefix must match a registered provider id;
   * the registry-membership guard prevents mis-splitting model ids that already
   * contain slashes (DeepInfra: `meta-llama/Llama-3.3-70B-Instruct-Turbo`).
   *
   * A higher-priority provider source still wins over the slash hint, but a
   * lower-priority one cannot overwrite a slash-qualified model (cross-axis
   * tie-break rule from spec §Phase-1).
   *
   * Phase 0 and Phase 1 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  defaultModel?: string
  /**
   * Optional base URL this agent prefers for its chosen provider.
   * Sits between `<MODULE>_AI_BASE_URL` (step 6) and the preset env override
   * (`baseURLEnvKeys`) in the resolution chain. Only honoured by adapters that
   * support baseURL (Anthropic Messages-protocol relays, all OpenAI-compatible
   * adapters, Google via @ai-sdk/google ≥3.0).
   *
   * Phase 2 of spec `2026-04-27-ai-agents-provider-model-baseurl-overrides`.
   */
  defaultBaseUrl?: string
  acceptedMediaTypes?: AiAgentAcceptedMediaType[]
  requiredFeatures?: string[]
  uiParts?: string[]
  readOnly?: boolean
  mutationPolicy?: AiAgentMutationPolicy
  maxSteps?: number
  output?: AiAgentStructuredOutput
  resolvePageContext?: (ctx: AiAgentPageContextInput) => Promise<string | null>
  keywords?: string[]
  domain?: string
  dataCapabilities?: AiAgentDataCapabilities
}

export interface AiAgentExtension {
  targetAgentId: string
  replaceAllowedTools?: string[]
  deleteAllowedTools?: string[]
  appendAllowedTools?: string[]
  replaceSystemPrompt?: string
  appendSystemPrompt?: string
  replaceSuggestions?: AiAgentSuggestion[]
  deleteSuggestions?: string[]
  appendSuggestions?: AiAgentSuggestion[]
  /**
   * @deprecated Use `appendSuggestions` for new code. Preserved as the
   * original append-only field for backward compatibility.
   */
  suggestions?: AiAgentSuggestion[]
}

export function defineAiAgent(definition: AiAgentDefinition): AiAgentDefinition {
  return definition
}

export function defineAiAgentExtension(extension: AiAgentExtension): AiAgentExtension {
  return extension
}
