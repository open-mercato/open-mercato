import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import type { VectorIndexService } from '@open-mercato/search/vector'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY } from '@open-mercato/shared/lib/crud/types'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { HybridQueryEngine } from './lib/engine'
import {
  loadQueryIndexRowScope,
  resolveQueryIndexRecordScope,
  resolveQueryIndexSourceMetadata,
} from './lib/subscriber-scope'

function hasOwn(value: unknown, key: string): boolean {
  return !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
}

function resolveBridgeScopeValue(
  payload: unknown,
  ctx: unknown,
  payloadKeys: string[],
  contextKey: string,
): { value: string | null | undefined; present: boolean } {
  const payloadRecord = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const payloadKey = payloadKeys.find((key) => hasOwn(payload, key))
  if (payloadKey) {
    const value = payloadRecord[payloadKey]
    return {
      value: typeof value === 'string' || value === null || value === undefined ? value : String(value),
      present: true,
    }
  }
  const contextRecord = ctx && typeof ctx === 'object' ? ctx as Record<string, unknown> : {}
  const contextValue = contextRecord[contextKey]
  if (typeof contextValue === 'string' && contextValue.trim().length > 0) {
    return { value: contextValue, present: true }
  }
  return { value: undefined, present: false }
}

async function resolveBridgeRecordScope(
  em: EntityManager,
  entityType: string,
  recordId: string,
  payload: unknown,
  ctx: unknown,
) {
  const organization = resolveBridgeScopeValue(payload, ctx, ['organizationId', 'orgId'], 'organizationId')
  const tenant = resolveBridgeScopeValue(payload, ctx, ['tenantId'], 'tenantId')
  const source = resolveQueryIndexSourceMetadata(em, entityType)
  const sourceScope = await loadQueryIndexRowScope(em, source, recordId)
  return resolveQueryIndexRecordScope({
    payloadOrganizationId: organization.value,
    payloadTenantId: tenant.value,
    hasPayloadOrganizationId: organization.present,
    hasPayloadTenantId: tenant.present,
    sourceScope,
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
      try {
        // DataEngine emits the canonical query_index.upsert_one itself. The
        // bridge only covers domain events from write paths that do not own an
        // indexer, otherwise failures and error logs are duplicated.
        if (payload?.[CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY] === true) return
        const em = ctx.resolve('em')
        const id = String(payload?.id || payload?.recordId || '')
        if (!id) return
        const { organizationId: orgId, tenantId } = await resolveBridgeRecordScope(
          em,
          entityType,
          id,
          payload,
          ctx,
        )
        // Optional: only index when custom field definitions exist for this entity (org/global)
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
          const hasCf = await cfQuery.executeTakeFirst()
          if (!hasCf) return
        } catch {}
        try {
          const bus = ctx.resolve('eventBus') as any
          await bus.emitEvent('query_index.upsert_one', { entityType, recordId: id, organizationId: orgId, tenantId })
        } catch {}
      } catch {}
    }
    const makeDeleteHandler = (entityType: string) => async (payload: any, ctx: any) => {
      try {
        if (payload?.[CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY] === true) return
        const em = ctx.resolve('em')
        const id = String(payload?.id || payload?.recordId || '')
        if (!id) return
        const { organizationId: orgId, tenantId } = await resolveBridgeRecordScope(
          em,
          entityType,
          id,
          payload,
          ctx,
        )
        try {
          const bus = ctx.resolve('eventBus') as any
          await bus.emitEvent('query_index.delete_one', { entityType, recordId: id, organizationId: orgId, tenantId })
        } catch {}
      } catch {}
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
