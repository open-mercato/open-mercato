import type { AwilixContainer } from 'awilix'
import { intersectFeatureGrants, type FeatureGrantSet } from '@open-mercato/shared/security/features'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { agentPrincipalToolAclModeSchema, type AgentPrincipalToolAclMode } from '../../data/validators'
import type { AgentRegistryEntry } from '../sdk/defineAgent'
import { resolveCallerAcl, type AgentRunCtx } from '../runtime/persistence'
import { AgentPrincipalMissingError } from '../runtime/errors'

const logger = createLogger('agent_orchestrator').child({ component: 'tool-acl' })

export const TOOL_ACL_MODE_ENV = 'OM_AGENT_TOOL_ACL_MODE'

export type EffectiveToolAcl = {
  features: string[]
  isSuperAdmin: boolean
  mode: AgentPrincipalToolAclMode
}

type RbacAclLoader = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[] }>
}

let warnedMalformedEnvValue: string | null = null

export function resetToolAclModeWarning(): void {
  warnedMalformedEnvValue = null
}

function readEnvToolAclMode(): AgentPrincipalToolAclMode {
  const raw = process.env[TOOL_ACL_MODE_ENV]
  if (raw === undefined || raw.trim() === '') return 'caller'
  const parsed = agentPrincipalToolAclModeSchema.safeParse(raw.trim().toLowerCase())
  if (parsed.success) return parsed.data
  if (warnedMalformedEnvValue !== raw) {
    warnedMalformedEnvValue = raw
    logger.warn(`${TOOL_ACL_MODE_ENV} has an unknown value; using caller`, { value: raw })
  }
  return 'caller'
}

/**
 * The tool ACL mode of an agent: its declared `principal.toolAcl`, else the
 * deployment default from `OM_AGENT_TOOL_ACL_MODE`, else `caller`.
 */
export function resolveToolAclMode(entry: Pick<AgentRegistryEntry, 'principal'> | null | undefined): AgentPrincipalToolAclMode {
  return entry?.principal?.toolAcl ?? readEnvToolAclMode()
}

async function loadPrincipalAcl(
  container: AwilixContainer,
  agentId: string,
  principalUserId: string,
  ctx: Pick<AgentRunCtx, 'tenantId' | 'organizationId'>,
): Promise<FeatureGrantSet> {
  try {
    const rbac = container.resolve('rbacService') as RbacAclLoader
    const loaded = await rbac.loadAcl(principalUserId, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    return { features: loaded.features ?? [], isSuperAdmin: !!loaded.isSuperAdmin }
  } catch (error) {
    logger.warn('agent principal ACL could not be loaded; tools fail closed', {
      agentId,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.principal_acl_load_failed',
      attributes: { agentId },
    })
    return { features: [], isSuperAdmin: false }
  }
}

/**
 * The ACL an agent's tools run under (identity spec Phase 3). `caller` is the
 * caller's own ACL, unchanged. `intersect` keeps only what both the bound agent
 * principal (`ctx.runAs`) and the caller hold; a super-admin caller collapses to
 * the principal's grants. Without a principal `intersect` uses the caller's ACL,
 * or refuses with {@link AgentPrincipalMissingError} when the agent declares
 * `principal.required: true`.
 */
export async function resolveEffectiveToolAcl(
  container: AwilixContainer,
  agentId: string,
  entry: Pick<AgentRegistryEntry, 'principal'> | null | undefined,
  ctx: AgentRunCtx,
): Promise<EffectiveToolAcl> {
  const mode = resolveToolAclMode(entry)
  const callerAcl = await resolveCallerAcl(container, ctx)
  if (mode === 'caller') return { ...callerAcl, mode }
  if (!ctx.runAs) {
    if (entry?.principal?.required === true) throw new AgentPrincipalMissingError(agentId)
    return { ...callerAcl, mode }
  }
  const principalAcl = await loadPrincipalAcl(container, agentId, ctx.runAs.agentUserId, ctx)
  const effective = intersectFeatureGrants(principalAcl, callerAcl)
  return { features: [...effective.features], isSuperAdmin: effective.isSuperAdmin, mode }
}
