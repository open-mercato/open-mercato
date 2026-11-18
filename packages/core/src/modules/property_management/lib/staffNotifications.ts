import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { buildBatchNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { notificationTypes } from '../notifications'
import { resolveStaffRecipients, type StaffAudience } from './staffRecipients'
import type { Scope } from './productUse'

const logger = createLogger('property_management')

export type StaffNotificationType =
  | 'property_management.lease.order_orphaned'
  | 'property_management.lease.billing_change_refused'
  | 'property_management.lease.document_status_refused'
  | 'property_management.sales_operation.duplicated'
  | 'property_management.sales_operation.stalled'
  | 'property_management.booking.order_orphaned'
  | 'property_management.booking.order_cancel_refused'
  | 'property_management.booking.order_refused'

export type StaffNotificationInput = {
  container: AwilixContainer
  em: EntityManager
  scope: Scope
  type: StaffNotificationType
  buildingId: string | null
  audience?: StaffAudience
  leaseId?: string | null
  bookingId?: string | null
  bodyVariables: Record<string, string>
  groupKey: string
}

type NotificationSource = { sourceEntityType: string; sourceEntityId: string; linkHref: string }

export const BOOKINGS_HREF = '/backend/property_management/bookings'

function sourceOf(input: StaffNotificationInput): NotificationSource | null {
  if (input.leaseId) {
    return {
      sourceEntityType: 'property_management:lease',
      sourceEntityId: input.leaseId,
      linkHref: `/backend/property_management/leases/${input.leaseId}`,
    }
  }
  if (input.bookingId) {
    return {
      sourceEntityType: 'property_management:booking',
      sourceEntityId: input.bookingId,
      linkHref: `${BOOKINGS_HREF}?id=${input.bookingId}`,
    }
  }
  return null
}

export async function notifyStaff(input: StaffNotificationInput): Promise<string[]> {
  const typeDef = notificationTypes.find((entry) => entry.type === input.type)
  const source = sourceOf(input)
  if (!typeDef || !source) return []
  try {
    const recipientUserIds = await resolveStaffRecipients({
      container: input.container,
      em: input.em,
      scope: input.scope,
      buildingId: input.buildingId,
      audience: input.audience,
    })
    if (!recipientUserIds.length) return []
    const notificationService = resolveNotificationService(input.container)
    await notificationService.createBatch(
      buildBatchNotificationFromType(typeDef, {
        recipientUserIds,
        bodyVariables: input.bodyVariables,
        titleVariables: input.bodyVariables,
        sourceEntityType: source.sourceEntityType,
        sourceEntityId: source.sourceEntityId,
        linkHref: source.linkHref,
        groupKey: input.groupKey,
      }),
      { tenantId: input.scope.tenantId, organizationId: input.scope.organizationId },
    )
    return recipientUserIds
  } catch (err) {
    logger.error('Staff notification failed', { type: input.type, sourceEntityId: source.sourceEntityId, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.staff_notification_failed' })
    return []
  }
}
