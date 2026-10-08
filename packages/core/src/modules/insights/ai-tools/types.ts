import type { AwilixContainer } from 'awilix'
import type { z } from 'zod'

export interface InsightsToolContext {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
  apiKeySecret?: string
  sessionId?: string
}

export interface InsightsAiToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  displayName?: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures?: string[]
  tags?: string[]
  isMutation?: boolean
  maxCallsPerTurn?: number
  supportsAttachments?: boolean
  handler: (input: TInput, context: InsightsToolContext) => Promise<TOutput>
}
