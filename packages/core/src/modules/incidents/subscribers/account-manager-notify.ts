import type { EntityManager } from '@mikro-orm/postgresql'
import { buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'incidents.impact.added',
  persistent: true,
  id: 'incidents:account-manager-notify',
}

type IncidentImpactAddedPayload = {
  id: string
  organizationId?: string | null
  tenantId: string
  actorUserId?: string | null
  impactId: string
  targetType: string
  targetId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

const CUSTOMER_TARGET_TYPES = new Set(['customer_person', 'customer_company', 'customer_account'])

export default async function handle(payload: IncidentImpactAddedPayload, ctx: ResolverContext): Promise<void> {
  try {
    if (!CUSTOMER_TARGET_TYPES.has(payload.targetType) || !payload.targetId) return
    if (!payload.organizationId || !payload.tenantId) return

    const em = ctx.resolve<EntityManager>('em')?.fork()
    if (!em) return

    const rows = await em.getConnection().execute<{ owner_user_id: string | null; display_name: string | null }[]>(
      `select "owner_user_id", "display_name" from "customer_entities" where "id" = ? and "organization_id" = ? and "tenant_id" = ? and "deleted_at" is null limit 1`,
      [payload.targetId, payload.organizationId, payload.tenantId],
    ).catch(() => [])

    const ownerUserId = rows[0]?.owner_user_id ?? null
    if (!ownerUserId || ownerUserId === payload.actorUserId) return

    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'incidents.account_manager_alert')
    if (!typeDef) return

    const notificationInput = buildNotificationFromType(typeDef, {
      recipientUserId: ownerUserId,
      bodyVariables: {
        accountName: rows[0]?.display_name ?? '',
      },
      sourceEntityType: 'incidents:incident',
      sourceEntityId: payload.id,
      groupKey: `incidents.account_manager_alert:${payload.id}:${ownerUserId}`,
      linkHref: `/backend/incidents/${payload.id}`,
    })

    await notificationService.create(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.error('[incidents:account-manager-notify]', err)
  }
}
