import { incidentFind } from '../lib/read'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { Incident, IncidentImpact } from '../data/entities'
import { recomputeIncidentRevenue } from '../commands/impacts'
import { emitIncidentSideEffects } from '../commands/incident'

const EVENT_ID = 'sales.order.updated'
const TARGET_TYPE = 'sales_order'

export const metadata = {
  event: EVENT_ID,
  persistent: true,
  id: 'incidents-impact-refresh-sales-order-updated',
}

type SalesOrderUpdatedPayload = {
  id?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

type IncidentScope = {
  organizationId: string
  tenantId: string
}

function text(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function buildCommandContext(ctx: ResolverContext, scope: IncidentScope): CommandRuntimeContext {
  return {
    container: ctx as unknown as AwilixContainer,
    auth: null,
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}

export default async function handle(payload: SalesOrderUpdatedPayload, ctx: ResolverContext): Promise<void> {
  const tenantId = text(payload.tenantId)
  const organizationId = text(payload.organizationId)
  const orderId = text(payload.id)
  if (!tenantId || !organizationId || !orderId) return

  const scope = { tenantId, organizationId }
  const em = ctx.resolve<EntityManager>('em').fork()

  try {
    const impacts = await incidentFind(em, IncidentImpact, {
      ...scope,
      targetType: TARGET_TYPE,
      targetId: orderId,
      deletedAt: null,
    })
    if (impacts.length === 0) return

    const incidentIds = Array.from(new Set(impacts.map((impact) => impact.incidentId)))
    const incidents = await incidentFind(em, Incident, {
      id: { $in: incidentIds },
      ...scope,
      status: { $nin: ['resolved', 'closed'] },
      deletedAt: null,
    })
    if (incidents.length === 0) return

    const commandContext = buildCommandContext(ctx, scope)
    for (const incident of incidents) {
      try {
        const refreshedAt = new Date()
        await withAtomicFlush(em, [
          async () => {
            const activeImpacts = await incidentFind(em, IncidentImpact, {
              incidentId: incident.id,
              ...scope,
              deletedAt: null,
            })
            for (const impact of activeImpacts) {
              impact.revenueRefreshedAt = refreshedAt
              impact.updatedAt = refreshedAt
              em.persist(impact)
            }
            incident.updatedAt = refreshedAt
            em.persist(incident)
          },
          async () => {
            await recomputeIncidentRevenue(em, scope, incident)
          },
        ], { transaction: true, label: 'incidents.impacts.impact_refresh' })

        await emitIncidentSideEffects(commandContext, 'updated', incident)
      } catch (error) {
        console.error('[incidents:impact-refresh] failed to refresh incident revenue', {
          incidentId: incident.id,
          orderId,
          error,
        })
      }
    }
  } catch (error) {
    console.error('[incidents:impact-refresh]', error)
  }
}
