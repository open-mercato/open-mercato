import type { AwilixContainer } from 'awilix'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { AgentRegistryEntry } from '../sdk/defineAgent'
import type { AgentInvoker, AgentRunCtx } from '../runtime/persistence'
import { AgentInvokeDeniedError } from '../runtime/errors'

const logger = createLogger('agent_orchestrator').child({ component: 'agent-invoke-access' })

export const AGENT_INVOKE_ENFORCEMENT_ENV = 'OM_AGENT_INVOKE_ENFORCEMENT'

export type InvokerAcl = {
  features: string[]
  isSuperAdmin: boolean
}

export type InvokerScope = {
  tenantId: string | null
  organizationId: string | null
}

type RbacServiceLike = {
  loadAcl: (
    principalId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations?: string[] | null }>
}

const EMPTY_ACL: InvokerAcl = { features: [], isSuperAdmin: false }

/**
 * Invoke enforcement is ON unless `OM_AGENT_INVOKE_ENFORCEMENT=off`: the kill
 * switch turns a deny into a logged warning and lets the run proceed.
 */
export function isAgentInvokeEnforcementEnabled(): boolean {
  return (process.env[AGENT_INVOKE_ENFORCEMENT_ENV] ?? 'on').trim().toLowerCase() !== 'off'
}

let bootWarningEmitted = false

export function warnIfAgentInvokeEnforcementDisabled(): void {
  if (bootWarningEmitted || isAgentInvokeEnforcementEnabled()) return
  bootWarningEmitted = true
  logger.warn('agent invoke enforcement is disabled; per-agent requiredFeatures denials are only logged', {
    env: AGENT_INVOKE_ENFORCEMENT_ENV,
  })
}

export function resolveInvoker(ctx: Pick<AgentRunCtx, 'invoker' | 'userId'>): AgentInvoker | null {
  if (ctx.invoker) return ctx.invoker
  if (typeof ctx.userId === 'string' && ctx.userId.length > 0) return { kind: 'user', userId: ctx.userId }
  return null
}

function principalIdForInvoker(invoker: AgentInvoker): string {
  switch (invoker.kind) {
    case 'user':
      return invoker.userId
    case 'api_key':
      return `api_key:${invoker.apiKeyId}`
    case 'workflow':
      return invoker.actingUserId
    case 'agent_token':
      return invoker.agentUserId
  }
}

/**
 * Loads the invoker's ACL in the run's scope. Fails closed: an unresolvable
 * RBAC service, a load error, or an organization restriction excluding the
 * run's organization all yield an empty, non-superadmin ACL.
 */
export async function loadInvokerAcl(
  container: AwilixContainer,
  invoker: AgentInvoker,
  scope: InvokerScope,
): Promise<InvokerAcl> {
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike
    const loaded = await rbac.loadAcl(principalIdForInvoker(invoker), {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const isSuperAdmin = loaded.isSuperAdmin === true
    const organizations = loaded.organizations ?? null
    if (
      !isSuperAdmin &&
      scope.organizationId !== null &&
      Array.isArray(organizations) &&
      !organizations.includes(scope.organizationId)
    ) {
      return EMPTY_ACL
    }
    return { features: Array.isArray(loaded.features) ? loaded.features : [], isSuperAdmin }
  } catch (err) {
    logger.warn('failed to load invoker ACL; treating as no grants', {
      invokerKind: invoker.kind,
      error: err instanceof Error ? err.message : String(err),
    })
    getTelemetryRuntime()?.reportError(err, {
      module: 'agent_orchestrator',
      code: 'agent_invoker_acl_load_failed',
      attributes: { invokerKind: invoker.kind },
    })
    return EMPTY_ACL
  }
}

export function isAgentInvocable(
  entry: Pick<AgentRegistryEntry, 'requiredFeatures'>,
  acl: InvokerAcl | null,
): boolean {
  const required = entry.requiredFeatures ?? []
  if (required.length === 0) return true
  if (acl === null) return false
  return authorizeFeatures(required, { grantedFeatures: acl.features, unrestricted: acl.isSuperAdmin })
}

export function assertAgentInvocable(
  entry: Pick<AgentRegistryEntry, 'id' | 'requiredFeatures'>,
  acl: InvokerAcl | null,
): void {
  if (isAgentInvocable(entry, acl)) return
  throw new AgentInvokeDeniedError(entry.id)
}

/**
 * The single invoke gate called by `AgentRuntimeService.run()` before
 * admission. Agents without `requiredFeatures` skip the ACL load entirely.
 */
export async function enforceAgentInvocable(
  container: AwilixContainer,
  entry: Pick<AgentRegistryEntry, 'id' | 'requiredFeatures'>,
  ctx: AgentRunCtx,
): Promise<void> {
  if (!entry.requiredFeatures || entry.requiredFeatures.length === 0) return
  const invoker = resolveInvoker(ctx)
  const acl = invoker
    ? await loadInvokerAcl(container, invoker, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
    : null
  try {
    assertAgentInvocable(entry, acl)
  } catch (err) {
    if (!(err instanceof AgentInvokeDeniedError) || isAgentInvokeEnforcementEnabled()) throw err
    logger.warn('agent invoke denied but enforcement is off; allowing run', {
      agentId: entry.id,
      invokerKind: invoker?.kind ?? null,
      entryPoint: ctx.entryPoint ?? null,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  }
}
