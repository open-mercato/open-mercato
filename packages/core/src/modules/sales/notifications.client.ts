'use client'

import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { SalesOrderCreatedRenderer } from './widgets/notifications/SalesOrderCreatedRenderer'
import { SalesQuoteCreatedRenderer } from './widgets/notifications/SalesQuoteCreatedRenderer'

/**
 * Client-side notification type definitions with custom renderers.
 * These should be used in client components where custom rendering is needed.
 *
 * Example usage:
 * ```tsx
 * import { salesNotificationTypes } from '@open-mercato/core/modules/sales/notifications.client'
 *
 * // Use in NotificationPanel or NotificationItem
 * const renderer = salesNotificationTypes.find(t => t.type === notification.type)?.Renderer
 * if (renderer) {
 *   return <renderer notification={notification} onAction={...} onDismiss={...} actions={...} />
 * }
 * ```
 */
export const salesNotificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'sales.order.created',
    module: 'sales',
    titleKey: 'sales.notifications.order.created.title',
    bodyKey: 'sales.notifications.order.created.body',
    icon: 'shopping-cart',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/sales/orders/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/sales/orders/{sourceEntityId}',
    Renderer: SalesOrderCreatedRenderer,
    expiresAfterHours: 168,
  },
  {
    type: 'sales.quote.created',
    module: 'sales',
    titleKey: 'sales.notifications.quote.created.title',
    bodyKey: 'sales.notifications.quote.created.body',
    icon: 'file-text',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/sales/quotes/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/sales/quotes/{sourceEntityId}',
    Renderer: SalesQuoteCreatedRenderer,
    expiresAfterHours: 168,
  },
]

export default salesNotificationTypes
