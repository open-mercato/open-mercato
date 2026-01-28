import React from 'react'

const bellIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9' }),
  React.createElement('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['notifications.manage'],
  pageTitle: 'Notification Delivery',
  pageTitleKey: 'notifications.settings.pageTitle',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  pageOrder: 435,
  icon: bellIcon,
  breadcrumb: [
    { label: 'Notification Delivery', labelKey: 'notifications.settings.pageTitle' },
  ],
} as const
