import React from 'react'

const createIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
  React.createElement('polyline', { points: '14 2 14 8 20 8' }),
  React.createElement('path', { d: 'M12 11v6M9 14h6' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.channels.manage'],
  pageTitle: 'Create channel',
  pageTitleKey: 'sales.channels.form.createTitle',
  pageGroup: 'Sales',
  pageGroupKey: 'sales.nav.group',
  pageOrder: 121,
  icon: createIcon,
  breadcrumb: [
    { label: 'Sales', labelKey: 'sales.nav.group', href: '/backend/sales/channels' },
    { label: 'Channels', labelKey: 'sales.channels.nav.title', href: '/backend/sales/channels' },
    { label: 'Create', labelKey: 'sales.channels.form.createTitle' },
  ],
} as const
