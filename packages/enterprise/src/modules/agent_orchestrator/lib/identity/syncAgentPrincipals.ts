import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  executionPrincipalRoleName,
  provisionExecutionPrincipal,
} from '@open-mercato/core/modules/auth/lib/executionPrincipal'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { AgentPrincipal } from '../../data/entities'
import { emitAgentOrchestratorEvent } from '../../events'
import { listAgentEntries, type AgentRegistryEntry } from '../sdk/defineAgent'
import { getAgentActorScope } from './agentWriteScope'
import type { AgentPrincipalScope } from './agentPrincipalService'

const logger = createLogger('agent_orchestrator').child({ component: 'principal-sync' })

const AGENT_PRINCIPAL_NAME_PREFIX = 'agent'

export type SyncAgentPrincipalsOptions = {
  /** Agents to reconcile; defaults to every registered agent. */
  agents?: readonly AgentRegistryEntry[]
  /** Concrete feature ids a principal may hold; defaults to the bootstrapped module ACL catalog. */
  featureCatalog?: Iterable<string> | null
}

export type SyncAgentPrincipalsResult = {
  created: string[]
  synced: string[]
  reused: string[]
  disabled: string[]
  droppedFeatures: Record<string, string[]>
}

/**
 * Org-qualified principal key of a declaratively provisioned agent (ID-Q4): one
 * role per (agent, organization), so two organizations of a tenant never share
 * an ACL.
 */
export function agentPrincipalKey(agentId: string, organizationId: string): string {
  return `${agentId}@${organizationId}`
}

export function declarativeAgentPrincipalRoleName(agentId: string, organizationId: string): string {
  return executionPrincipalRoleName(agentPrincipalKey(agentId, organizationId), AGENT_PRINCIPAL_NAME_PREFIX)
}

function loadFeatureCatalog(): Set<string> | null {
  const modules = tryGetModules()
  if (!modules) return null
  const catalog = new Set<string>()
  for (const mod of modules) {
    for (const feature of mod.features ?? []) {
      if (feature && typeof feature.id === 'string' && feature.id) catalog.add(feature.id)
    }
  }
  return catalog
}

function isDeclaredFeature(feature: string, catalog: ReadonlySet<string>): boolean {
  if (feature === '*') return false
  if (feature.endsWith('.*')) {
    const prefix = feature.slice(0, -1)
    for (const known of catalog) {
      if (known.startsWith(prefix)) return true
    }
    return false
  }
  return catalog.has(feature)
}

/**
 * Splits declared role features into the grantable ones and the ones no enabled
 * module declares. The bare `*` grant is never grantable — a principal must
 * never reach super-admin breadth. Without a catalog every feature is dropped
 * (fail closed).
 */
export function partitionDeclaredFeatures(
  features: readonly string[],
  catalog: ReadonlySet<string> | null,
): { granted: string[]; dropped: string[] } {
  const granted: string[] = []
  const dropped: string[] = []
  for (const feature of features) {
    if (catalog && isDeclaredFeature(feature, catalog)) granted.push(feature)
    else dropped.push(feature)
  }
  return { granted, dropped }
}

async function isDeclarativelyNamed(
  em: EntityManager,
  principal: AgentPrincipal,
  scope: AgentPrincipalScope,
): Promise<boolean> {
  const role = await findOneWithDecryption(
    em,
    Role,
    { id: principal.roleId, tenantId: scope.tenantId },
    {},
    { tenantId: scope.tenantId, organizationId: null },
  )
  return role?.name === declarativeAgentPrincipalRoleName(principal.agentDefinitionId, scope.organizationId)
}

/**
 * Reconciles the declared agent principals (`defineAgent({ principal })`) of one
 * organization. Per declaring agent:
 *   - an existing live principal created outside the declaration (the external
 *     self-registration path) is reused untouched, so its identity stays stable;
 *   - otherwise core's `provisionExecutionPrincipal` pins the org-qualified role's
 *     ACL to exactly the declared features (`mergeFeatures: false`, so a re-sync
 *     narrows), never super-admin, and an `AgentPrincipal` row is created on first
 *     sync — the only case that emits `agent_orchestrator.agent_principal.registered`.
 * Declaratively named principals of agents that no longer declare one are
 * disabled, never deleted (audit rows keep pointing at their user). Idempotent:
 * an unchanged declaration writes nothing.
 *
 * Refuses to run inside an agent run: the provisioning writes are not audited
 * agent commands, so the no-bypass guard would reject them anyway.
 */
export async function syncAgentPrincipals(
  container: AwilixContainer,
  scope: AgentPrincipalScope,
  options: SyncAgentPrincipalsOptions = {},
): Promise<SyncAgentPrincipalsResult> {
  if (getAgentActorScope()) {
    throw new Error('[internal] agent principal sync cannot run inside an agent run')
  }
  const { tenantId, organizationId } = scope
  if (!tenantId || !organizationId) {
    throw new Error('[internal] agent principal sync requires a tenant and organization scope')
  }

  const agents = options.agents ?? listAgentEntries()
  const catalog = options.featureCatalog === undefined
    ? loadFeatureCatalog()
    : options.featureCatalog === null
      ? null
      : new Set(options.featureCatalog)
  if (!catalog) {
    logger.warn('feature catalog unavailable; declared principal features are dropped', { tenantId, organizationId })
  }

  const em = (container.resolve('em') as EntityManager).fork()
  const result: SyncAgentPrincipalsResult = { created: [], synced: [], reused: [], disabled: [], droppedFeatures: {} }
  const registered: AgentPrincipal[] = []
  const declaredAgentIds = new Set<string>()

  for (const agent of agents) {
    const declaration = agent.principal
    if (!declaration) continue
    declaredAgentIds.add(agent.id)

    const existing = await findOneWithDecryption(
      em,
      AgentPrincipal,
      { tenantId, organizationId, agentDefinitionId: agent.id, deletedAt: null },
      {},
      { tenantId, organizationId },
    )
    if (existing && !(await isDeclarativelyNamed(em, existing, scope))) {
      result.reused.push(agent.id)
      continue
    }

    const { granted, dropped } = partitionDeclaredFeatures(declaration.roleFeatures, catalog)
    if (dropped.length > 0) {
      result.droppedFeatures[agent.id] = dropped
      logger.warn('agent principal declares features no enabled module provides; dropping them', {
        agentId: agent.id,
        features: dropped,
        tenantId,
        organizationId,
      })
    }

    const provisioned = await provisionExecutionPrincipal(container, scope, {
      principalKey: agentPrincipalKey(agent.id, organizationId),
      displayName: declaration.displayName ?? agent.label,
      features: granted,
      kind: 'agent',
      namePrefix: AGENT_PRINCIPAL_NAME_PREFIX,
      mergeFeatures: false,
    })

    if (existing) {
      if (!existing.enabled) {
        existing.enabled = true
        em.persist(existing)
        await em.flush()
      }
      result.synced.push(agent.id)
      continue
    }

    const principal = em.create(AgentPrincipal, {
      tenantId,
      organizationId,
      userId: provisioned.userId,
      agentDefinitionId: agent.id,
      roleId: provisioned.roleId,
      credentialMode: 'internal',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(principal)
    await em.flush()
    registered.push(principal)
    result.created.push(agent.id)
  }

  const live = await findWithDecryption(
    em,
    AgentPrincipal,
    { tenantId, organizationId, enabled: true, deletedAt: null },
    {},
    { tenantId, organizationId },
  )
  const undeclared: AgentPrincipal[] = []
  for (const principal of live) {
    if (declaredAgentIds.has(principal.agentDefinitionId)) continue
    if (await isDeclarativelyNamed(em, principal, scope)) undeclared.push(principal)
  }
  if (undeclared.length > 0) {
    for (const principal of undeclared) {
      principal.enabled = false
      em.persist(principal)
      result.disabled.push(principal.agentDefinitionId)
    }
    await em.flush()
  }

  for (const principal of registered) {
    await emitAgentOrchestratorEvent(
      'agent_orchestrator.agent_principal.registered',
      {
        agentPrincipalId: principal.id,
        agentDefinitionId: principal.agentDefinitionId,
        source: 'declaration',
        tenantId,
        organizationId,
      },
      { persistent: true },
    )
  }

  return result
}
