import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'property_management.lease.order_orphaned',
    module: 'property_management',
    channels: ['in_app'],
    titleKey: 'property_management.notifications.leaseOrderOrphaned.title',
    bodyKey: 'property_management.notifications.leaseOrderOrphaned.body',
    icon: 'alert-triangle',
    severity: 'error',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/property_management/leases/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/property_management/leases/{sourceEntityId}',
    expiresAfterHours: 720,
  },
  {
    type: 'property_management.lease.billing_change_refused',
    module: 'property_management',
    channels: ['in_app'],
    titleKey: 'property_management.notifications.leaseBillingChangeRefused.title',
    bodyKey: 'property_management.notifications.leaseBillingChangeRefused.body',
    icon: 'alert-circle',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/property_management/leases/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/property_management/leases/{sourceEntityId}',
    expiresAfterHours: 720,
  },
  {
    type: 'property_management.sales_operation.duplicated',
    module: 'property_management',
    channels: ['in_app'],
    titleKey: 'property_management.notifications.salesOperationDuplicated.title',
    bodyKey: 'property_management.notifications.salesOperationDuplicated.body',
    icon: 'copy',
    severity: 'error',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/property_management/leases/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/property_management/leases/{sourceEntityId}',
    expiresAfterHours: 720,
  },
]

export default notificationTypes
