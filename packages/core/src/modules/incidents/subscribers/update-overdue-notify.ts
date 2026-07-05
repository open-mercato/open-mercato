import { incidentFindOne } from '../lib/read'
import type { EntityManager } from '@mikro-orm/postgresql'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService, type NotificationService } from '../../notifications/lib/notificationService'
import { Incident } from '../data/entities'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'incidents.incident.update_overdue',
  persistent: true,
  id: 'incidents:update-overdue-notify',
}

type IncidentUpdateOverduePayload = {
  id?: string | null
  incidentId: string
  number?: string | null
  organizationId?: string | null
  tenantId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

function tryResolveNotificationService(ctx: ResolverContext): NotificationService | null {
  try {
    return resolveNotificationService(ctx)
  } catch {
    return null
  }
}

function dueAtMs(incident: Incident): number | null {
  if (!(incident.nextUpdateDueAt instanceof Date)) return null
  const value = incident.nextUpdateDueAt.getTime()
  return Number.isFinite(value) ? value : null
}

function isClaimCurrent(incident: Incident): boolean {
  if (!(incident.nextUpdateDueAt instanceof Date)) return false
  if (!(incident.updateOverdueNotifiedAt instanceof Date)) return false
  return incident.updateOverdueNotifiedAt.getTime() >= incident.nextUpdateDueAt.getTime()
}

async function resolveIncident(
  payload: IncidentUpdateOverduePayload,
  ctx: ResolverContext,
): Promise<Incident | null> {
  if (!payload.incidentId || !payload.tenantId || !payload.organizationId) return null
  const em = ctx.resolve<EntityManager>('em')?.fork()
  if (!em) return null
  return incidentFindOne(em, Incident, {
    id: payload.incidentId,
    organizationId: payload.organizationId,
    tenantId: payload.tenantId,
    deletedAt: null,
  })
}

export default async function handle(payload: IncidentUpdateOverduePayload, ctx: ResolverContext): Promise<void> {
  try {
    const notificationService = tryResolveNotificationService(ctx)
    if (!notificationService) return

    const typeDef = notificationTypes.find((type) => type.type === 'incidents.update_overdue')
    if (!typeDef) return

    const incident = await resolveIncident(payload, ctx)
    if (!incident || !isClaimCurrent(incident)) return

    const recipientUserId = incident.ownerUserId ?? incident.reporterUserId ?? null
    if (!recipientUserId) return

    const nextUpdateDueAtMs = dueAtMs(incident)
    if (nextUpdateDueAtMs == null) return

    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId,
      bodyVariables: {
        incidentNumber: payload.number ?? incident.number,
      },
      sourceEntityType: 'incidents:incident',
      sourceEntityId: incident.id,
      groupKey: `incidents.update_overdue:${incident.id}:${nextUpdateDueAtMs}`,
      linkHref: `/backend/incidents/${incident.id}`,
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.error('[incidents:update-overdue-notify]', err)
  }
}
