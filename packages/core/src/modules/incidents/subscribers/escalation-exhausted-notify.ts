import type { EntityManager } from '@mikro-orm/postgresql'
import { buildBatchNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { Incident } from '../data/entities'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'incidents.incident.escalation_exhausted',
  persistent: true,
  id: 'incidents:escalation-exhausted-notify',
}

type IncidentEscalationExhaustedPayload = {
  id: string
  organizationId?: string | null
  tenantId: string
  actorUserId?: string | null
  level?: number | string | null
  escalationStatus: 'exhausted'
  recipientUserIds?: string[]
  dedupeKey?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

async function resolveIncidentVariables(
  payload: IncidentEscalationExhaustedPayload,
  ctx: ResolverContext,
): Promise<{ incidentNumber: string; incidentTitle: string }> {
  try {
    if (!payload.id || !payload.tenantId || !payload.organizationId) {
      return { incidentNumber: '', incidentTitle: '' }
    }

    const em = ctx.resolve<EntityManager>('em')?.fork()
    if (!em) return { incidentNumber: '', incidentTitle: '' }

    const incident = await em.findOne(Incident, {
      id: payload.id,
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
      deletedAt: null,
    })

    return {
      incidentNumber: incident?.number ?? '',
      incidentTitle: incident?.title ?? '',
    }
  } catch {
    return { incidentNumber: '', incidentTitle: '' }
  }
}

export default async function handle(payload: IncidentEscalationExhaustedPayload, ctx: ResolverContext): Promise<void> {
  try {
    if (!payload.recipientUserIds?.length) return

    const recipientUserIds = Array.from(new Set(payload.recipientUserIds)).filter(Boolean)
    if (!recipientUserIds.length) return

    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'incidents.escalation_exhausted')
    if (!typeDef) return

    const { incidentNumber } = await resolveIncidentVariables(payload, ctx)
    const notificationInput = buildBatchNotificationFromType(typeDef, {
      recipientUserIds,
      bodyVariables: {
        incidentNumber,
      },
      sourceEntityType: 'incidents:incident',
      sourceEntityId: payload.id,
      groupKey: payload.dedupeKey ?? `incidents.escalation_exhausted:${payload.id}:${payload.level ?? ''}`,
      linkHref: `/backend/incidents/${payload.id}`,
    })

    await notificationService.createBatch(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.error('[incidents:escalation-exhausted-notify]', err)
  }
}
