import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { BasicQueryEngine, resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { HybridQueryEngine } from './lib/engine'
import { markDeleted } from './lib/indexer'
import type { EventBus } from '@open-mercato/events'
import type { VectorIndexService } from '@open-mercato/vector'

function toEntityTypeFromEvent(event: string): string | null {
  // Expect '<module>.<entity>.<action>'
  const parts = event.split('.')
  if (parts.length !== 3) return null
  const [mod, ent] = parts
  return `${mod}:${ent}`
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
        const em = ctx.resolve('em')
        let orgId = payload?.organizationId || payload?.orgId || null
        let tenantId = payload?.tenantId || null
        const id = String(payload?.id || payload?.recordId || '')
        if (!id) return
        if (!orgId || !tenantId) {
          try {
            const knex = (em as any).getConnection().getKnex()
            const table = resolveEntityTableName(em, entityType)
            const row = await knex(table).select(['organization_id', 'tenant_id']).where({ id }).first()
            orgId = row?.organization_id ?? orgId
            tenantId = row?.tenant_id ?? tenantId
          } catch {}
        }
        // Optional: only index when custom field definitions exist for this entity (org/global)
        try {
          const knex = (em as any).getConnection().getKnex()
          const hasCf = await knex('custom_field_defs')
            .where({ entity_id: entityType, is_active: true })
            .modify((qb: any) => {
              if (orgId != null) qb.andWhere((b: any) => b.where({ organization_id: orgId }).orWhereNull('organization_id'))
              else qb.whereNull('organization_id')
              if (tenantId != null) qb.andWhere((b: any) => b.where({ tenant_id: tenantId }).orWhereNull('tenant_id'))
              else qb.whereNull('tenant_id')
            })
            .first()
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
        const em = ctx.resolve('em')
        let orgId = payload?.organizationId || payload?.orgId || null
        const id = String(payload?.id || payload?.recordId || '')
        if (!id) return
        if (!orgId) {
          try {
            const knex = (em as any).getConnection().getKnex()
            const table = resolveEntityTableName(em, entityType)
            const row = await knex(table).select(['organization_id']).where({ id }).first()
            orgId = row?.organization_id ?? orgId
          } catch {}
        }
        try {
          const bus = ctx.resolve('eventBus') as any
          await bus.emitEvent('query_index.delete_one', { entityType, recordId: id, organizationId: orgId })
        } catch {}
      } catch {}
    }

    // Build list of entity ids to subscribe to
    try {
      const em = (container.resolve('em') as any)
      const knex = (em as any).getConnection().getKnex()
      const cfEntityIds: string[] = []
      knex('custom_field_defs').distinct('entity_id')
        .then((rows: any[]) => {
          for (const r of rows || []) cfEntityIds.push(String(r.entity_id))
        })
        .catch(() => {})
        .finally(() => {
          const proceed = (ids: string[]) => {
            for (const entityType of Array.from(new Set(ids))) {
              const [mod, ent] = entityType.split(':')
              if (!mod || !ent) continue
              bus.on(`${mod}.${ent}.created`, makeUpsertHandler(entityType))
              bus.on(`${mod}.${ent}.updated`, makeUpsertHandler(entityType))
              bus.on(`${mod}.${ent}.deleted`, makeDeleteHandler(entityType))
            }
          }
          if (cfEntityIds.length > 0) {
            proceed(cfEntityIds)
          } else {
            // Fallback to generated entity ids without await
          Promise.all([
            import('@open-mercato/core/datamodel/entities').catch(() => ({} as any)),
            import('@open-mercato/example/datamodel/entities').catch(() => ({} as any)),
          ]).then(([core, example]) => {
              const flatten = (E: any): string[] => Object.values(E || {}).flatMap((o: any) => Object.values(o || {}) as string[])
              const guesses = new Set<string>([...flatten((core as any).E), ...flatten((example as any).E)])
              proceed(Array.from(guesses))
            }).catch(() => {})
          }
        })
    } catch {}
  }

  try { setup() } catch {}
}
