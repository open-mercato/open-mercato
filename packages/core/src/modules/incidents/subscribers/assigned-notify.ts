import { incidentFindOne } from '../lib/read'
import type { EntityManager } from '@mikro-orm/postgresql'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { Incident } from '../data/entities'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'incidents.incident.assigned',
  persistent: true,
  id: 'incidents:assigned-notify',
}

type IncidentAssignedPayload = {
  id: string
  organizationId?: string | null
  tenantId: string
  actorUserId?: string | null
  ownerUserId: string | null
  owningTeamId: string | null
  previousOwnerUserId?: string | null
  previousOwningTeamId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

async function resolveIncidentVariables(
  payload: IncidentAssignedPayload,
  ctx: ResolverContext,
): Promise<{ incidentNumber: string; incidentTitle: string }> {
  try {
    if (!payload.id || !payload.tenantId || !payload.organizationId) {
      return { incidentNumber: '', incidentTitle: '' }
    }

    const em = ctx.resolve<EntityManager>('em')?.fork()
    if (!em) return { incidentNumber: '', incidentTitle: '' }

    const incident = await incidentFindOne(em, Incident, {
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

export default async function handle(payload: IncidentAssignedPayload, ctx: ResolverContext): Promise<void> {
  try {
    const ownerUserId = payload.ownerUserId
    if (!ownerUserId || ownerUserId === payload.actorUserId) return

    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'incidents.assigned')
    if (!typeDef) return

    const { incidentNumber, incidentTitle } = await resolveIncidentVariables(payload, ctx)
    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId: ownerUserId,
      bodyVariables: {
        incidentNumber,
        incidentTitle,
      },
      sourceEntityType: 'incidents:incident',
      sourceEntityId: payload.id,
      groupKey: `incidents.assigned:${payload.id}:${ownerUserId}`,
      linkHref: `/backend/incidents/${payload.id}`,
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.error('[incidents:assigned-notify]', err)
  }
}
