/**
 * Local AI tool shape for the EUDR module.
 *
 * Mirrors the catalog module pattern: keep the module contribution as plain
 * serializable tool objects so the generator can discover them without adding
 * runtime AI assistant imports to the core module graph.
 */
import type { AwilixContainer } from 'awilix'
import type { z } from 'zod'

export interface EudrToolContext {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
  apiKeySecret?: string
  sessionId?: string
}

export interface EudrAiToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  displayName?: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures?: string[]
  tags?: string[]
  isMutation?: boolean
  isBulk?: boolean
  maxCallsPerTurn?: number
  supportsAttachments?: boolean
  handler: (input: TInput, context: EudrToolContext) => Promise<TOutput>
}

export function assertTenantScope(ctx: EudrToolContext): {
  tenantId: string
  organizationId: string
} {
  if (!ctx.tenantId || !ctx.organizationId) {
    throw new Error('[internal] Tenant and organization context is required for eudr.* tools')
  }
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}
