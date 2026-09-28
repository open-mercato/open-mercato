import type { z } from 'zod'
import type { AwilixContainer } from 'awilix'

/**
 * Local AI tool shape, declared structurally rather than imported.
 *
 * This package carries `@open-mercato/ai-assistant` as neither a runtime dependency nor a peer, exactly
 * as `workflows` and `customers` do: the generator walks every module root for a default/`aiTools`
 * export of this shape and emits it into `ai-tools.generated.ts`, which the ai-assistant tool loader
 * registers through `registerMcpTool`. One registry serves both the MCP server (external agents) and the
 * in-app chat runtime.
 */
export interface MarketingToolContext {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
}

export interface MarketingAiToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  displayName?: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures?: string[]
  tags?: string[]
  isMutation?: boolean
  isDestructive?: boolean | ((input: TInput) => boolean)
  handler: (input: TInput, context: MarketingToolContext) => Promise<TOutput>
}

export type MarketingToolScope = { tenantId: string; organizationId: string }

/**
 * Every tool in the pack is scoped, with no fallback.
 *
 * An agent principal without a tenant is not a principal this module can serve: answering with data from
 * "somewhere" is how a cross-tenant leak looks from the inside.
 */
export function requireToolScope(context: MarketingToolContext): MarketingToolScope {
  const tenantId = context.tenantId?.trim()
  const organizationId = context.organizationId?.trim()
  if (!tenantId || !organizationId) {
    throw new Error('[internal] marketing AI tools require a tenant and organization scope')
  }
  return { tenantId, organizationId }
}
