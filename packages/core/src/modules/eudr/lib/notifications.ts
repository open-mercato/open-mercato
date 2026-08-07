import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { notificationTypes } from '../notifications'

const logger = createLogger('eudr').child({ component: 'notifications' })

export type EudrNotificationTypeId =
  | 'eudr.statement.submitted'
  | 'eudr.statement.reference_issued'
  | 'eudr.statement.withdrawn'
  | 'eudr.risk.non_negligible'
  | 'eudr.mitigation.completed'

export type EudrNotificationContainer = {
  resolve: (name: string) => unknown
}

type EudrNotificationPayload = {
  tenantId: string
  organizationId: string | null
  entityId: string
  occurredAt: string
  bodyVariables: Record<string, string>
  linkHref: string
  sourceEntityType: string
}

type DeliverEudrNotificationInput = {
  container: EudrNotificationContainer
  typeId: EudrNotificationTypeId
  payload: EudrNotificationPayload
}

const REQUIRED_FEATURE_BY_TYPE: Record<EudrNotificationTypeId, string> = {
  'eudr.statement.submitted': 'eudr.statements.manage',
  'eudr.statement.reference_issued': 'eudr.statements.manage',
  'eudr.statement.withdrawn': 'eudr.statements.manage',
  'eudr.risk.non_negligible': 'eudr.risk.manage',
  'eudr.mitigation.completed': 'eudr.risk.manage',
}

export async function deliverEudrNotification({
  container,
  typeId,
  payload,
}: DeliverEudrNotificationInput): Promise<void> {
  let notificationService: ReturnType<typeof resolveNotificationService>
  try {
    notificationService = resolveNotificationService(container)
  } catch (err) {
    logger.debug('Notification service unavailable; skipping EUDR notification', {
      typeId,
      entityId: payload.entityId,
      err,
    })
    return
  }

  const typeDef = notificationTypes.find((candidate) => candidate.type === typeId)
  if (!typeDef) {
    throw new Error(`[internal] EUDR notification type is not registered: ${typeId}`)
  }

  const requiredFeature = REQUIRED_FEATURE_BY_TYPE[typeId]
  const content = buildFeatureNotificationFromType(typeDef, {
    requiredFeature,
    bodyVariables: payload.bodyVariables,
    sourceEntityType: payload.sourceEntityType,
    sourceEntityId: payload.entityId,
    linkHref: payload.linkHref,
    groupKey: `${typeId}:${payload.entityId}:${payload.occurredAt}`,
  })

  await notificationService.createForFeature(
    {
      ...content,
      restrictRecipientsToOrganization: true,
    },
    {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
    },
  )
}
