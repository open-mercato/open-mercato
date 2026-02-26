import React from 'react'

const inboxIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }),
  React.createElement('path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['inbox_ops.proposals.view'],
  pageTitle: 'Proposals',
  pageTitleKey: 'inbox_ops.nav.proposals',
  pageGroup: 'InboxOps',
  pageGroupKey: 'inbox_ops.nav.group',
  pagePriority: 45,
  pageOrder: 100,
  icon: inboxIcon,
  breadcrumb: [{ label: 'InboxOps', labelKey: 'inbox_ops.nav.group' }],
} as const
