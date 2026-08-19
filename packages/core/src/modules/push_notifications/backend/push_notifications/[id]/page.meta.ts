export const metadata = {
  requireAuth: true,
  requireFeatures: ['push_notifications.view_deliveries'],
  pageTitle: 'Push Delivery',
  pageTitleKey: 'push_notifications.deliveries.detail.pageTitle',
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [{ label: 'Push Deliveries', labelKey: 'push_notifications.deliveries.pageTitle', href: '/backend/push_notifications' }],
} as const
