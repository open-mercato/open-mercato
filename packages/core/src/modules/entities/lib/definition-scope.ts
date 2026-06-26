import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'

type AuthScope = {
  tenantId?: string | null
  orgId?: string | null
}

export type DefinitionMutationScope = {
  tenantId: string | null
  organizationId: string | null
}

type OrganizationScopeLike = {
  tenantId?: string | null
  selectedId?: string | null
}

type DefinitionKeySelector = string | { $in: string[] }

type DefinitionVisibilityOptions = {
  deletedAt?: null | { $ne: null }
  isActive?: boolean
}

export function resolveDefinitionScopeFromOrganizationScope(
  auth: AuthScope,
  scope: OrganizationScopeLike,
): DefinitionMutationScope {
  const authTenantId = auth.tenantId ?? null
  const scopeTenantId = scope.tenantId ?? null
  const tenantMismatch = Boolean(authTenantId && scopeTenantId && authTenantId !== scopeTenantId)

  return {
    tenantId: tenantMismatch ? authTenantId : (scopeTenantId ?? authTenantId),
    organizationId: tenantMismatch
      ? (auth.orgId ?? null)
      : (scope.selectedId ?? auth.orgId ?? null),
  }
}

export async function resolveDefinitionMutationScope({
  auth,
  container,
  request,
}: {
  auth: AuthScope
  container: unknown
  request: Request
}): Promise<DefinitionMutationScope> {
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request } as any)
  return resolveDefinitionScopeFromOrganizationScope(auth, scope)
}

export function createExactDefinitionWhere(
  entityId: string,
  key: DefinitionKeySelector,
  scope: DefinitionMutationScope,
) {
  return {
    entityId,
    key,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  }
}

export function createVisibleDefinitionWhere(
  entityId: string,
  key: DefinitionKeySelector,
  scope: DefinitionMutationScope,
  options: DefinitionVisibilityOptions = {},
) {
  const organizationCandidates = [{ organizationId: null as string | null }]
  if (scope.organizationId) organizationCandidates.unshift({ organizationId: scope.organizationId })

  const tenantCandidates = [{ tenantId: null as string | null }]
  if (scope.tenantId) tenantCandidates.unshift({ tenantId: scope.tenantId })

  return {
    entityId,
    key,
    ...options,
    $and: [
      { $or: organizationCandidates },
      { $or: tenantCandidates },
    ],
  }
}

function definitionTimestamp(def: any) {
  const updatedAt = def?.updatedAt instanceof Date
    ? def.updatedAt.getTime()
    : (def?.updatedAt ? new Date(def.updatedAt).getTime() : 0)
  if (updatedAt) return updatedAt
  return def?.createdAt instanceof Date
    ? def.createdAt.getTime()
    : (def?.createdAt ? new Date(def.createdAt).getTime() : 0)
}

function definitionScopeScore(def: any) {
  return (def?.tenantId ? 2 : 0) + (def?.organizationId ? 1 : 0)
}

export function selectVisibleDefinitionWinner(definitions: any[]) {
  let winner: any | null = null
  for (const definition of definitions) {
    if (!winner) {
      winner = definition
      continue
    }
    const nextScore = definitionScopeScore(definition)
    const winnerScore = definitionScopeScore(winner)
    if (nextScore > winnerScore) {
      winner = definition
      continue
    }
    if (nextScore < winnerScore) continue
    if (definitionTimestamp(definition) >= definitionTimestamp(winner)) winner = definition
  }
  return winner
}

export function markDefinitionTombstoned(definition: any, now = new Date()) {
  definition.isActive = false
  definition.deletedAt = definition.deletedAt ?? now
  definition.updatedAt = now
  return definition
}

function cloneConfigJson(configJson: unknown) {
  if (configJson == null) return configJson
  return JSON.parse(JSON.stringify(configJson))
}

export function createScopedDefinitionTombstone(
  em: Pick<EntityManager, 'create'>,
  source: {
    entityId: string
    key: string
    kind: string
    configJson?: unknown
  },
  scope: DefinitionMutationScope,
  now = new Date(),
) {
  return em.create(CustomFieldDef, {
    entityId: source.entityId,
    key: source.key,
    kind: source.kind,
    configJson: cloneConfigJson(source.configJson) ?? {},
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    isActive: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: now,
  })
}
