'use client'

import type {
  NotificationTypeAction,
  NotificationTypeDefinition,
} from '@open-mercato/shared/modules/notifications/types'
import { WarrantyClaimNotificationRenderer } from './widgets/notifications/WarrantyClaimNotificationRenderer'

const CLAIM_DETAIL_HREF = '/backend/warranty_claims/{sourceEntityId}'

function viewClaimAction(): NotificationTypeAction {
  return {
    id: 'view',
    labelKey: 'common.view',
    variant: 'outline',
    href: CLAIM_DETAIL_HREF,
    icon: 'external-link',
  }
}

function claimNotificationType(
  type: string,
  titleKey: string,
  bodyKey: string,
  icon: string,
): NotificationTypeDefinition {
  return {
    type,
    module: 'warranty_claims',
    titleKey,
    bodyKey,
    icon,
    severity: 'info',
    actions: [viewClaimAction()],
    linkHref: CLAIM_DETAIL_HREF,
    Renderer: WarrantyClaimNotificationRenderer,
    expiresAfterHours: 168,
  }
}

export const warrantyClaimsNotificationTypes: NotificationTypeDefinition[] = [
  claimNotificationType(
    'warranty_claims.claim.submitted',
    'warranty_claims.notifications.submitted.title',
    'warranty_claims.notifications.submitted.body',
    'clipboard-check',
  ),
  claimNotificationType(
    'warranty_claims.claim.assigned',
    'warranty_claims.notifications.assigned.title',
    'warranty_claims.notifications.assigned.body',
    'user-check',
  ),
  claimNotificationType(
    'warranty_claims.claim.status_changed',
    'warranty_claims.notifications.statusChanged.title',
    'warranty_claims.notifications.statusChanged.body',
    'refresh-cw',
  ),
  claimNotificationType(
    'warranty_claims.claim.customer_replied',
    'warranty_claims.notifications.customerReplied.title',
    'warranty_claims.notifications.customerReplied.body',
    'message-square',
  ),
]

export const notificationTypes = warrantyClaimsNotificationTypes

export default warrantyClaimsNotificationTypes
