/**
 * Local AI tool shape for the customers module (Phase 1 WS-C, Step 3.9).
 *
 * The customers module declares its read-only tool pack directly as plain
 * objects so jest can load it without pulling `@open-mercato/ai-assistant`
 * into the core package's module graph. This mirrors the pattern used by
 * `packages/core/src/modules/inbox_ops/ai-tools.ts`. The shape is a strict
 * subset of `AiToolDefinition` from `@open-mercato/ai-assistant`; the
 * generator walks every module root for a default/aiTools export with this
 * shape.
 */
import type { z } from 'zod'
import type { AwilixContainer } from 'awilix'

export interface CustomersToolContext {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
  apiKeySecret?: string
  sessionId?: string
}

export interface CustomersAiToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  displayName?: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures?: string[]
  tags?: string[]
  isMutation?: boolean
  maxCallsPerTurn?: number
  supportsAttachments?: boolean
  handler: (input: TInput, context: CustomersToolContext) => Promise<TOutput>
}

export function assertTenantScope(ctx: CustomersToolContext): {
  tenantId: string
  organizationId: string | null
} {
  if (!ctx.tenantId) {
    throw new Error('Tenant context is required for customers.* tools')
  }
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}
