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
  defaultModel?: string
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
