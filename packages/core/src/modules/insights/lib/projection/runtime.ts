import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { ProcessActorDimensionContext } from '@open-mercato/shared/modules/insights/process'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import {
  compareCodeUnits,
  fieldNameCandidates,
  getProcessRegistry,
  type ProcessRegistrySnapshot,
  type RegisteredProcessField,
} from '../process/registry'
import { valueCapScope } from '../process/values'
import type { ActorDimensions, XrayIngestDeps } from './ingest'
import { createActorPseudonymizer } from './pseudonym'
import type { ServiceResolver } from './killSwitch'
import { createProjectionStore, type ProjectionStore } from './store'
import { supersedeProcessSuggestions } from '../suggestions/store'
import { clearSuggestionPass } from '../suggestions/passes'
import type { ProjectionScope, XrayDatabase } from './types'

const logger = createLogger('insights').child({ component: 'xray-runtime' })

export type XrayContainer = {
  resolve: (name: string) => unknown
  hasRegistration?: (name: string) => boolean
}

export function createServiceResolver(container: XrayContainer): ServiceResolver {
  return <TService>(name: string): TService | undefined => {
    try {
      return container.resolve(name) as TService
    } catch {
      return undefined
    }
  }
}

/** The Kysely handle of the X-Ray tables on an entity manager's connection. */
export function createXrayDatabase(em: EntityManager): Kysely<XrayDatabase> {
  return em.getKysely<XrayDatabase>()
}

export function createXrayStore(em: EntityManager): ProjectionStore {
  return createProjectionStore(createXrayDatabase(em))
}

export function createLeaseOwner(): string {
  return `${hostname()}:${process.pid}:${randomUUID()}`
}

type EncryptedFieldLookup = Pick<TenantDataEncryptionService, 'getEncryptedFieldNames'>

/**
 * Field scopes (`<processKey>␟<field>`) whose values the tenant has chosen to encrypt through
 * its own encryption maps. Their projected values are replaced with `other`. A missing
 * encryption service or a lookup failure fails the slice (fail closed) instead of copying a
 * possibly encrypted value or flipping every process contract.
 */
export async function resolveRedactedFields(
  registry: ProcessRegistrySnapshot,
  encryption: EncryptedFieldLookup | undefined,
  scope: ProjectionScope,
  em: EntityManager,
): Promise<Set<string>> {
  if (!encryption) {
    throw new Error('[internal] The tenant encryption service is unavailable, so Process X-Ray cannot tell which declared fields the tenant encrypts')
  }
  const redacted = new Set<string>()
  const cache = new Map<string, Set<string>>()
  const encryptedFor = async (entityId: string): Promise<Set<string>> => {
    const cached = cache.get(entityId)
    if (cached) return cached
    const names = await encryption.getEncryptedFieldNames(entityId, scope.tenantId, scope.organizationId, { ignoreRuntimeHealth: true, em })
    const set = new Set(names.map((name) => name.trim().toLowerCase()))
    cache.set(entityId, set)
    return set
  }
  const matches = (field: RegisteredProcessField, encrypted: ReadonlySet<string>) =>
    fieldNameCandidates(field).some((candidate) => encrypted.has(candidate))
  for (const process of registry.processes) {
    const rootEncrypted = await encryptedFor(process.entityId)
    for (const field of [...process.stageFields, ...process.followupFields]) {
      if (matches(field, rootEncrypted)) redacted.add(valueCapScope(process.processKey, field.key))
    }
    for (const milestone of process.milestones) {
      const milestoneEncrypted = await encryptedFor(milestone.entityId)
      for (const field of milestone.fields) {
        if (matches(field, milestoneEncrypted)) redacted.add(valueCapScope(process.processKey, `${milestone.key}.${field.key}`))
      }
    }
  }
  return redacted
}

function normalizeDimensionIds(values: readonly string[] | undefined): string[] {
  const ids = new Set((values ?? []).filter((value) => isUuid(value)).map((value) => value.toLowerCase()))
  return Array.from(ids).sort(compareCodeUnits)
}

/**
 * Resolves the role and team dimensions of a batch of actors with one provider call per
 * dimension. Only UUID dimension ids are kept; a user in several teams is attributed to the
 * lowest team id so the attribution is deterministic. A failing provider is reported and fails
 * the slice (retried), because events are inserted once and would otherwise keep no dimension.
 */
export function createActorDimensionResolver(
  registry: ProcessRegistrySnapshot,
  ctx: ProcessActorDimensionContext,
): (userIds: string[]) => Promise<Map<string, ActorDimensions>> {
  return async (userIds) => {
    const ids = Array.from(new Set(userIds.filter((id) => isUuid(id))))
    const resolved = new Map<string, ActorDimensions>(ids.map((id) => [id, { roleIds: null, teamId: null }]))
    if (ids.length === 0) return resolved
    const read = async (kind: 'role' | 'team'): Promise<Record<string, string[]>> => {
      const provider = registry.actorDimensions.get(kind)
      if (!provider) return {}
      try {
        return await provider.provider.resolve(ctx, ids)
      } catch (error) {
        logger.warn('[internal] X-Ray actor dimension provider failed', { kind, moduleId: provider.moduleId, err: error })
        getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_dimension_failed', attributes: { kind } })
        throw error
      }
    }
    const [roles, teams] = await Promise.all([read('role'), read('team')])
    for (const id of ids) {
      const roleIds = normalizeDimensionIds(roles[id])
      const teamIds = normalizeDimensionIds(teams[id])
      resolved.set(id, { roleIds: roleIds.length > 0 ? roleIds : null, teamId: teamIds[0] ?? null })
    }
    return resolved
  }
}

export async function createXrayIngestDeps(
  container: XrayContainer,
  scope: ProjectionScope,
  registry: ProcessRegistrySnapshot = getProcessRegistry(),
): Promise<{ deps: XrayIngestDeps; em: EntityManager }> {
  const resolve = createServiceResolver(container)
  const em = (container.resolve('em') as EntityManager).fork()
  const actionLogService = container.resolve('actionLogService') as ActionLogService
  const encryption = resolve<TenantDataEncryptionService>('tenantEncryptionService')
  const pseudonymizer = await createActorPseudonymizer(scope.tenantId, encryption ?? null)
  const redactedFields = await resolveRedactedFields(registry, encryption, scope, em)
  return {
    em,
    deps: {
      store: createXrayStore(em),
      logSource: actionLogService,
      registry,
      pseudonymizer,
      resolveActorDimensions: createActorDimensionResolver(registry, { em, tenantId: scope.tenantId, organizationId: scope.organizationId }),
      redactedFields,
      owner: createLeaseOwner(),
      onProcessRebuild: async (rebuildScope, processKeys) => {
        try {
          const db = createXrayDatabase(em)
          await supersedeProcessSuggestions(db, rebuildScope, processKeys)
          await clearSuggestionPass(db, rebuildScope)
        } catch (error) {
          logger.warn('[internal] Could not supersede the X-Ray suggestions of rebuilt processes', { organizationId: rebuildScope.organizationId, processKeys, err: error })
          getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_suggestions_supersede_failed', attributes: { reason: 'contract_change' } })
        }
      },
    },
  }
}
