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

export interface AiAgentDefinition {
  id: string
  moduleId: string
  label: string
  description: string
  systemPrompt: string
  allowedTools: string[]
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

export function defineAiAgent(definition: AiAgentDefinition): AiAgentDefinition {
  return definition
}
