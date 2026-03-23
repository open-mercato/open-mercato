'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { CheckoutTransactionCompletedRenderer } from './widgets/notifications/CheckoutTransactionCompletedRenderer'
import { CheckoutTransactionFailedRenderer } from './widgets/notifications/CheckoutTransactionFailedRenderer'
import { CheckoutUsageLimitReachedRenderer } from './widgets/notifications/CheckoutUsageLimitReachedRenderer'

export const checkoutNotificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'checkout.transaction.completed',
    module: 'checkout',
    titleKey: 'checkout.notifications.transaction.completed.title',
    bodyKey: 'checkout.notifications.transaction.completed.body',
    icon: 'check-circle',
    severity: 'success',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/checkout/transactions/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/checkout/transactions/{sourceEntityId}',
    Renderer: CheckoutTransactionCompletedRenderer,
    expiresAfterHours: 168,
  },
  {
    type: 'checkout.transaction.failed',
    module: 'checkout',
    titleKey: 'checkout.notifications.transaction.failed.title',
    bodyKey: 'checkout.notifications.transaction.failed.body',
    icon: 'alert-circle',
    severity: 'error',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/checkout/transactions/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/checkout/transactions/{sourceEntityId}',
    Renderer: CheckoutTransactionFailedRenderer,
    expiresAfterHours: 168,
  },
  {
    type: 'checkout.link.usageLimitReached',
    module: 'checkout',
    titleKey: 'checkout.notifications.link.usageLimitReached.title',
    bodyKey: 'checkout.notifications.link.usageLimitReached.body',
    icon: 'alert-triangle',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/checkout/pay-links/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/checkout/pay-links/{sourceEntityId}',
    Renderer: CheckoutUsageLimitReachedRenderer,
    expiresAfterHours: 168,
  },
]

export default checkoutNotificationTypes
