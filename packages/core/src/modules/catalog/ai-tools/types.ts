/**
 * Local AI tool shape for the catalog module (Phase 1 WS-C, Step 3.10).
 *
 * Mirrors the pattern established by the customers pack (Step 3.9): the
 * catalog module declares its read-only tools as plain objects whose shape
 * is a strict subset of `AiToolDefinition` from `@open-mercato/ai-assistant`.
 * Keeping the shape local avoids pulling the ai-assistant package into the
 * core module graph for jest and sidesteps a cross-package `moduleNameMapper`.
 * The generator walks every module root for a default / `aiTools` export with
 * this shape.
 */
import type { z } from 'zod'
import type { AwilixContainer } from 'awilix'

export interface CatalogToolContext {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
  apiKeySecret?: string
  sessionId?: string
}

/**
 * Shape returned by `loadBeforeRecord` on a single-record mutation tool.
 * Mirrors `AiToolLoadBeforeSingleRecord` from `@open-mercato/ai-assistant/lib/types`.
 */
export interface CatalogToolLoadBeforeSingleRecord {
  recordId: string
  entityType: string
  recordVersion: string | null
  before: Record<string, unknown>
}

/**
 * Shape returned by `loadBeforeRecords` on a bulk mutation tool. Mirrors
 * `AiToolLoadBeforeRecord` from `@open-mercato/ai-assistant/lib/types` — the
 * Step 5.6 `prepareMutation` runtime wraps this into the `records[]` array on
 * the emitted `mutation-preview-card`.
 */
export interface CatalogToolLoadBeforeRecord {
  recordId: string
  entityType: string
  label: string
  recordVersion: string | null
  before: Record<string, unknown>
}

export interface CatalogAiToolDefinition<TInput = unknown, TOutput = unknown> {
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
  handler: (input: TInput, context: CatalogToolContext) => Promise<TOutput>
  loadBeforeRecord?: (
    input: TInput,
    context: CatalogToolContext,
  ) => Promise<CatalogToolLoadBeforeSingleRecord | null>
  loadBeforeRecords?: (
    input: TInput,
    context: CatalogToolContext,
  ) => Promise<CatalogToolLoadBeforeRecord[]>
}

export function assertTenantScope(ctx: CatalogToolContext): {
  tenantId: string
  organizationId: string | null
} {
  if (!ctx.tenantId) {
    throw new Error('Tenant context is required for catalog.* tools')
  }
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}
