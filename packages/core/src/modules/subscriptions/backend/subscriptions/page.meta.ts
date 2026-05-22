import React from 'react'

const subscriptionsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 14, rx: 2 }),
  React.createElement('path', { d: 'M3 10h18' }),
  React.createElement('path', { d: 'M8 14h.01' }),
  React.createElement('path', { d: 'M12 14h.01' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['subscriptions.admin'],
  pageTitle: 'Subscriptions',
  pageTitleKey: 'subscriptions.nav.title',
  pageGroup: 'Billing',
  pageGroupKey: 'subscriptions.nav.group',
  pagePriority: 60,
  pageOrder: 100,
  icon: subscriptionsIcon,
  breadcrumb: [{ label: 'Subscriptions', labelKey: 'subscriptions.nav.title' }],
}
