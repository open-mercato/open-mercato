import React from 'react'

const globeIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
  React.createElement('path', { d: 'M2 12h20' }),
  React.createElement('path', { d: 'M12 2a15 15 0 0 1 0 20' }),
  React.createElement('path', { d: 'M12 2a15 15 0 0 0 0 20' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.channels.manage'],
  pageTitle: 'Sales channels',
  pageTitleKey: 'sales.channels.nav.title',
  pageGroup: 'Sales',
  pageGroupKey: 'sales.nav.group',
  pageOrder: 120,
  icon: globeIcon,
  breadcrumb: [
    { label: 'Sales', labelKey: 'sales.nav.group', href: '/backend/sales/channels' },
    { label: 'Channels', labelKey: 'sales.channels.nav.title' },
  ],
} as const
