import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { AgentPrincipalScope } from './agentPrincipalService'
import {
  syncAgentPrincipals,
  type SyncAgentPrincipalsOptions,
  type SyncAgentPrincipalsResult,
} from './syncAgentPrincipals'

export type PrincipalSyncScopeFilter = {
  tenantId?: string
  organizationId?: string
}

export type PrincipalSyncScopeOutcome = {
  scope: AgentPrincipalScope
  result: SyncAgentPrincipalsResult | null
  error: string | null
}

export type PrincipalSyncTotals = {
  created: number
  synced: number
  reused: number
  disabled: number
  failed: number
}

export type PrincipalSyncSummary = {
  outcomes: PrincipalSyncScopeOutcome[]
  totals: PrincipalSyncTotals
}

export type PrincipalSyncDeps = {
  listScopes: (filter: PrincipalSyncScopeFilter) => Promise<AgentPrincipalScope[]>
  loadAgents: () => Promise<NonNullable<SyncAgentPrincipalsOptions['agents']>>
  sync: (
    scope: AgentPrincipalScope,
    options: SyncAgentPrincipalsOptions,
  ) => Promise<SyncAgentPrincipalsResult>
}

/**
 * Live organizations to reconcile, oldest first. Without a filter every tenant's
 * organizations are listed; `tenantId` / `organizationId` narrow the set.
 */
export async function listPrincipalSyncScopes(
  em: EntityManager,
  filter: PrincipalSyncScopeFilter,
): Promise<AgentPrincipalScope[]> {
  const where: Record<string, unknown> = { deletedAt: null }
  if (filter.tenantId) where.tenant = filter.tenantId
  if (filter.organizationId) where.id = filter.organizationId
  const organizations = await findWithDecryption(
    em,
    Organization,
    where,
    { orderBy: { createdAt: 'asc' } },
    { tenantId: filter.tenantId ?? null, organizationId: null },
  )
  const scopes: AgentPrincipalScope[] = []
  for (const organization of organizations) {
    const tenantId = organization.tenant?.id
    if (!tenantId) continue
    scopes.push({ tenantId: String(tenantId), organizationId: String(organization.id) })
  }
  return scopes
}

export function createPrincipalSyncDeps(container: AwilixContainer): PrincipalSyncDeps {
  return {
    listScopes: (filter) => listPrincipalSyncScopes((container.resolve('em') as EntityManager).fork(), filter),
    loadAgents: async () => {
      const { ensureAgentsLoaded, listAgentEntries } = await import('../sdk/defineAgent')
      await ensureAgentsLoaded()
      return listAgentEntries()
    },
    sync: (scope, options) => syncAgentPrincipals(container, scope, options),
  }
}

/**
 * Reconciles declared agent principals for every selected organization. One
 * organization's failure is recorded and the rest still sync.
 */
export async function runPrincipalSync(
  filter: PrincipalSyncScopeFilter,
  deps: PrincipalSyncDeps,
): Promise<PrincipalSyncSummary> {
  const scopes = await deps.listScopes(filter)
  const agents = await deps.loadAgents()
  const outcomes: PrincipalSyncScopeOutcome[] = []
  const totals: PrincipalSyncTotals = { created: 0, synced: 0, reused: 0, disabled: 0, failed: 0 }
  for (const scope of scopes) {
    try {
      const result = await deps.sync(scope, { agents })
      outcomes.push({ scope, result, error: null })
      totals.created += result.created.length
      totals.synced += result.synced.length
      totals.reused += result.reused.length
      totals.disabled += result.disabled.length
    } catch (error) {
      outcomes.push({ scope, result: null, error: error instanceof Error ? error.message : String(error) })
      totals.failed += 1
    }
  }
  return { outcomes, totals }
}

function formatIds(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(', ') : '-'
}

export function formatPrincipalSyncSummary(summary: PrincipalSyncSummary): string[] {
  const lines: string[] = []
  for (const outcome of summary.outcomes) {
    const label = `tenant=${outcome.scope.tenantId} org=${outcome.scope.organizationId}`
    if (!outcome.result) {
      lines.push(`${label}: failed (${outcome.error ?? 'unknown error'})`)
      continue
    }
    const { created, synced, reused, disabled, droppedFeatures } = outcome.result
    lines.push(
      `${label}: created ${formatIds(created)}; updated ${formatIds(synced)}; reused ${formatIds(reused)}; disabled ${formatIds(disabled)}`,
    )
    for (const [agentId, features] of Object.entries(droppedFeatures)) {
      lines.push(`  ${agentId}: dropped undeclared features ${features.join(', ')}`)
    }
  }
  const { totals } = summary
  lines.push(
    `Done. ${summary.outcomes.length} organization(s): ${totals.created} created, ${totals.synced} updated, ${totals.reused} reused, ${totals.disabled} disabled, ${totals.failed} failed.`,
  )
  return lines
}
