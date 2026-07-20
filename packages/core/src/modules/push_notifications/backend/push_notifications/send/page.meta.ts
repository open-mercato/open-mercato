import React from 'react'

const megaphoneIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'm3 11 18-5v12L3 14v-3z' }),
  React.createElement('path', { d: 'M11.6 16.8a3 3 0 1 1-5.8-1.6' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['push_notifications.send_custom'],
  pageTitle: 'Send Push',
  pageTitleKey: 'push_notifications.send.pageTitle',
  pageGroup: 'External systems',
  pageGroupKey: 'backend.nav.externalSystems',
  pageOrder: 55,
  icon: megaphoneIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Push Deliveries', labelKey: 'push_notifications.deliveries.pageTitle', href: '/backend/push_notifications' },
    { label: 'Send Push', labelKey: 'push_notifications.send.pageTitle' },
  ],
} as const
