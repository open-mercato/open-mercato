/**
 * Local AI tool shape for the workflows module.
 *
 * `@open-mercato/core` carries `@open-mercato/ai-assistant` only as a dev/peer
 * dependency, so — exactly as `customers` and `inbox_ops` already do — this
 * module declares its tools as plain objects against a structural subset of
 * `AiToolDefinition` instead of importing the framework at runtime. The
 * generator walks every module root for a default/`aiTools` export of this
 * shape and emits it into `ai-tools.generated.ts`, which the ai-assistant
 * tool-loader registers through `registerMcpTool`.
 */
import type { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { hasFeature } from '@open-mercato/shared/security/features'
import type { DefinitionValidationIssue } from '../lib/definition-error-body'

export interface WorkflowsToolContext {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
  apiKeySecret?: string
  sessionId?: string
}

export interface WorkflowsAiToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  displayName?: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures?: string[]
  tags?: string[]
  isMutation?: boolean
  isDestructive?: boolean | ((input: TInput) => boolean)
  handler: (input: TInput, context: WorkflowsToolContext) => Promise<TOutput>
}

/**
 * Every tool in this pack answers with the same envelope: a boolean outcome and
 * a list of STRUCTURED issues — never a prose error string. `issues` is the
 * identical `{path, code, message, expected?, got?}` shape the definition
 * create/update routes return in their 400 body.
 */
export interface WorkflowsToolEnvelope {
  ok: boolean
  issues: DefinitionValidationIssue[]
}

export function issue(
  path: Array<string | number>,
  code: string,
  message: string,
  extra: { expected?: string; got?: string } = {},
): DefinitionValidationIssue {
  return { path, code, message, ...extra }
}

export function failure(...issues: DefinitionValidationIssue[]): WorkflowsToolEnvelope {
  return { ok: false, issues }
}

export interface WorkflowsToolScope {
  tenantId: string
  organizationId: string | null
}

/**
 * Tenant scope is mandatory for every tool in this pack. An agent principal is
 * still a principal: without a tenant there is no safe query to run, so the
 * tool refuses rather than reading across tenants.
 */
export function resolveScope(ctx: WorkflowsToolContext): WorkflowsToolScope | null {
  if (!ctx.tenantId) return null
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

export const MISSING_TENANT_ISSUE = issue(
  ['tenantId'],
  'missing_tenant_context',
  'Tenant context is required for workflows.* tools',
)

/**
 * Defense in depth. The tool runtime already gates `requiredFeatures` through
 * the wildcard-aware matcher before a handler runs; re-checking here keeps the
 * guarantee when a handler is invoked directly (tests, in-process callers) and
 * makes the refusal a structured issue rather than a thrown string.
 */
export function missingFeatures(
  ctx: WorkflowsToolContext,
  required: readonly string[],
): string[] {
  if (ctx.isSuperAdmin) return []
  return required.filter((feature) => !hasFeature(ctx.userFeatures, feature))
}

export function featureRefusal(missing: readonly string[]): WorkflowsToolEnvelope {
  return failure(
    issue(
      ['requiredFeatures'],
      'insufficient_permissions',
      `Missing required feature(s): ${missing.join(', ')}`,
      { expected: missing.join(', ') },
    ),
  )
}

/**
 * Organization where-clause fragment for a tenant-scoped lookup. A null
 * organization stays tenant-wide, matching the REST routes' behaviour when the
 * caller's scope spans every organization.
 */
export function organizationWhere(scope: WorkflowsToolScope): Record<string, unknown> {
  return scope.organizationId ? { organizationId: scope.organizationId } : {}
}
