import React from 'react'

const sendIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('line', { x1: 22, y1: 2, x2: 11, y2: 13 }),
  React.createElement('polygon', { points: '22 2 15 22 11 13 2 9 22 2' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['push_notifications.view_deliveries'],
  pageTitle: 'Push Deliveries',
  pageTitleKey: 'push_notifications.deliveries.pageTitle',
  pageGroup: 'External systems',
  pageGroupKey: 'backend.nav.externalSystems',
  pageOrder: 54,
  icon: sendIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Push Deliveries', labelKey: 'push_notifications.deliveries.pageTitle' }],
} as const
