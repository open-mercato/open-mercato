import type { AppContainer } from '@/lib/di/container'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { HybridQueryEngine } from './lib/engine'
import { upsertIndexRow, markDeleted } from './lib/indexer'

export function register(container: AppContainer) {
  // Override queryEngine with hybrid that prefers JSONB index when available
  try {
    const em = container.resolve<any>('em')
    const basic = new BasicQueryEngine(em)
    const hybrid = new HybridQueryEngine(em, basic)
    // Replace existing registration
    ;(container as any).register({ queryEngine: { resolve: () => hybrid } })
  } catch {}

  // Programmatically register subscribers for example.todo CRUD to maintain index
  try {
    const bus = container.resolve<any>('eventBus')
    const handler = async (payload: any, ctx: any) => {
      try {
        const em = ctx.resolve('em')
        let orgId = payload?.organizationId || payload?.orgId || null
        let tenantId = payload?.tenantId || null
        const id = String(payload?.id || payload?.recordId || '')
        if (!id) return
        if (!orgId || !tenantId) {
          try {
            const knex = (em as any).getConnection().getKnex()
            const row = await knex('todos').select(['organization_id', 'tenant_id']).where({ id }).first()
            orgId = row?.organization_id ?? orgId
            tenantId = row?.tenant_id ?? tenantId
          } catch {}
        }
        await upsertIndexRow(em, { entityType: 'example:todo', recordId: id, organizationId: orgId, tenantId })
      } catch {}
    }
    const delHandler = async (payload: any, ctx: any) => {
      try {
        const em = ctx.resolve('em')
        let orgId = payload?.organizationId || payload?.orgId || null
        const id = String(payload?.id || payload?.recordId || '')
        if (!id) return
        if (!orgId) {
          try {
            const knex = (em as any).getConnection().getKnex()
            const row = await knex('todos').select(['organization_id']).where({ id }).first()
            orgId = row?.organization_id ?? orgId
          } catch {}
        }
        await markDeleted(em, { entityType: 'example:todo', recordId: id, organizationId: orgId })
      } catch {}
    }
    bus.on('example.todo.created', handler)
    bus.on('example.todo.updated', handler)
    bus.on('example.todo.deleted', delHandler)
  } catch {}
}
