import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import type { VectorIndexService } from '@open-mercato/search/vector'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY } from '@open-mercato/shared/lib/crud/types'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { HybridQueryEngine } from './lib/engine'
import {
  loadQueryIndexRowScope,
  QueryIndexScopeError,
  resolveQueryIndexRecordScope,
  resolveQueryIndexSourceMetadata,
} from './lib/subscriber-scope'

const logger = createLogger('query_index').child({ component: 'crud-bridge' })

function hasOwn(value: unknown, key: string): boolean {
  return !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
}

function readScopeValue(
  source: unknown,
  keys: string[],
): { value: string | null | undefined; present: boolean } {
  const sourceRecord = source && typeof source === 'object' ? source as Record<string, unknown> : {}
  const key = keys.find((candidate) => hasOwn(source, candidate))
  if (!key) return { value: undefined, present: false }
  const value = sourceRecord[key]
  if (value === null) return { value: null, present: true }
  if (typeof value === 'string' && value.trim().length > 0) return { value, present: true }
  return { value: undefined, present: false }
}

async function resolveBridgeRecordScope(
  em: EntityManager,
  entityType: string,
  recordId: string,
  payload: unknown,
  action: 'upsert' | 'delete',
  options?: { validateCompletePayload?: boolean },
) {
  let organization = readScopeValue(payload, ['organizationId', 'orgId'])
  let tenant = readScopeValue(payload, ['tenantId'])
  if (organization.present && tenant.present && options?.validateCompletePayload !== true) {
    return {
      organizationId: organization.value ?? null,
      tenantId: tenant.value ?? null,
      sourceValidated: false,
    }
  }
  const source = resolveQueryIndexSourceMetadata(em, entityType)
  const sourceScope = await loadQueryIndexRowScope(em, source, recordId)

  if (sourceScope.kind === 'global') {
    if (!organization.present) organization = { value: null, present: true }
    if (!tenant.present) tenant = { value: null, present: true }
  } else if (sourceScope.kind === 'missing' && action === 'upsert') {
    throw new QueryIndexScopeError(
      'Query index upsert event source row scope could not be resolved',
    )
  }

  const resolvedScope = resolveQueryIndexRecordScope({
    payloadOrganizationId: organization.value,
    payloadTenantId: tenant.value,
    hasPayloadOrganizationId: organization.present,
    hasPayloadTenantId: tenant.present,
    sourceScope,
  })
  return { ...resolvedScope, sourceValidated: true }
}

async function recordBridgeError(input: {
  em: EntityManager | null
  handler: 'upsert' | 'delete'
  error: unknown
  entityType: string
  recordId: string
  payload: unknown
}): Promise<void> {
  const handler = `event:query_index.crud_bridge.${input.handler}`
  if (!input.em) {
    logger.error('CRUD bridge event failed before the entity manager was resolved', {
      handler,
      entityType: input.entityType,
      recordId: input.recordId,
      err: input.error,
    })
    return
  }
  await recordIndexerError(
    { em: input.em },
    {
      source: 'query_index',
      handler,
      error: input.error,
      entityType: input.entityType,
      recordId: input.recordId,
      payload: input.payload,
    },
  ).catch((loggingError) => {
    logger.error('Failed to record CRUD bridge error', {
      handler,
      entityType: input.entityType,
      recordId: input.recordId,
      err: loggingError,
    })
  })
}

export function register(container: AppContainer) {
  // Override queryEngine with hybrid that prefers JSONB index when available
  try {
    const em = (container.resolve('em') as any)
    const basic = new BasicQueryEngine(
      em,
      undefined,
      () => {
        try {
          return container.resolve('tenantEncryptionService') as any
        } catch {
          return null
        }
      },
    )
    const hybrid = new HybridQueryEngine(
      em,
      basic,
      () => {
        try {
          return (container.resolve('eventBus') as EventBus)
        } catch {
          return null
        }
      },
      () => {
        try {
          return (container.resolve('vectorIndexService') as VectorIndexService)
        } catch {
          return null
        }
      },
      () => {
        try {
          return container.resolve('tenantEncryptionService') as any
        } catch {
          return null
        }
      },
    )
    // Replace existing registration
    ;(container as any).register({ queryEngine: { resolve: () => hybrid } })
  } catch {}

  // Subscribe to CRUD events and forward to query_index subscribers for unified handling
  const setup = () => {
    let bus: any
    try { bus = (container.resolve('eventBus') as any) } catch { bus = null }
    if (!bus) { setTimeout(setup, 0); return }

    const makeUpsertHandler = (entityType: string) => async (payload: any, ctx: any) => {
      let em: EntityManager | null = null
      let id = ''
      try {
        // DataEngine emits the canonical query_index.upsert_one itself. The
        // bridge only covers domain events from write paths that do not own an
        // indexer, otherwise failures and error logs are duplicated.
        if (payload?.[CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY] === true) return
        em = ctx.resolve('em') as EntityManager
        id = String(payload?.id || payload?.recordId || '')
        if (!id) return
        const { organizationId: orgId, tenantId, sourceValidated } = await resolveBridgeRecordScope(
          em,
          entityType,
          id,
          payload,
          'upsert',
        )
        // Optional: only index when custom field definitions exist for this entity (org/global)
        let hasCustomFields: boolean | null = null
        try {
          const db = (em as any).getKysely()
          let cfQuery = db
            .selectFrom('custom_field_defs' as any)
            .select(['id' as any])
            .where('entity_id' as any, '=', entityType)
            .where('is_active' as any, '=', true)
          if (orgId != null) {
            cfQuery = cfQuery.where((eb: any) => eb.or([
              eb('organization_id' as any, '=', orgId),
              eb('organization_id' as any, 'is', null),
            ]))
          } else {
            cfQuery = cfQuery.where('organization_id' as any, 'is', null as any)
          }
          if (tenantId != null) {
            cfQuery = cfQuery.where((eb: any) => eb.or([
              eb('tenant_id' as any, '=', tenantId),
              eb('tenant_id' as any, 'is', null),
            ]))
          } else {
            cfQuery = cfQuery.where('tenant_id' as any, 'is', null as any)
          }
          hasCustomFields = !!await cfQuery.executeTakeFirst()
        } catch {}
        if (hasCustomFields === false) {
          if (!sourceValidated) {
            await resolveBridgeRecordScope(
              em,
              entityType,
              id,
              payload,
              'upsert',
              { validateCompletePayload: true },
            )
          }
          return
        }
        const bus = ctx.resolve('eventBus') as any
        await bus.emitEvent('query_index.upsert_one', { entityType, recordId: id, organizationId: orgId, tenantId })
      } catch (error) {
        await recordBridgeError({ em, handler: 'upsert', error, entityType, recordId: id, payload })
      }
    }
    const makeDeleteHandler = (entityType: string) => async (payload: any, ctx: any) => {
      let em: EntityManager | null = null
      let id = ''
      try {
        if (payload?.[CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY] === true) return
        em = ctx.resolve('em') as EntityManager
        id = String(payload?.id || payload?.recordId || '')
        if (!id) return
        const { organizationId: orgId, tenantId } = await resolveBridgeRecordScope(
          em,
          entityType,
          id,
          payload,
          'delete',
        )
        const bus = ctx.resolve('eventBus') as any
        await bus.emitEvent('query_index.delete_one', { entityType, recordId: id, organizationId: orgId, tenantId })
      } catch (error) {
        await recordBridgeError({ em, handler: 'delete', error, entityType, recordId: id, payload })
      }
    }

    // Build list of entity ids to subscribe to
    try {
      const em = (container.resolve('em') as any)
      const db = (em as any).getKysely()
      const cfEntityIds: string[] = []
      db
        .selectFrom('custom_field_defs' as any)
        .select(['entity_id' as any])
        .distinct()
        .execute()
        .then((rows: any[]) => {
          for (const r of rows || []) cfEntityIds.push(String(r.entity_id))
        })
        .catch(() => {})
        .finally(() => {
          const proceed = (ids: string[]) => {
            for (const entityType of Array.from(new Set(ids))) {
              const [mod, ent] = entityType.split(':')
              if (!mod || !ent) continue
              bus.on(`${mod}.${ent}.created`, makeUpsertHandler(entityType), { moduleId: 'query_index' })
              bus.on(`${mod}.${ent}.updated`, makeUpsertHandler(entityType), { moduleId: 'query_index' })
              bus.on(`${mod}.${ent}.deleted`, makeDeleteHandler(entityType), { moduleId: 'query_index' })
            }
          }
          if (cfEntityIds.length > 0) {
            proceed(cfEntityIds)
          } else {
            // Fallback to generated entity ids without await
          import('#generated/entities.ids.generated').then((core) => {
              const flatten = (E: any): string[] => Object.values(E || {}).flatMap((o: any) => Object.values(o || {}) as string[])
              const guesses = new Set<string>([...flatten((core as any).E)])
              proceed(Array.from(guesses))
            }).catch(() => {})
          }
        })
    } catch {}
  }

  try { setup() } catch {}
}
