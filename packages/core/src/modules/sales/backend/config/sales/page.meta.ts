import React from 'react'

const statusIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M4 4h16v4H4z' }),
  React.createElement('path', { d: 'M4 10h16v4H4z' }),
  React.createElement('path', { d: 'M4 16h16v4H4z' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.settings.manage'],
  pageTitle: 'Sales',
  pageTitleKey: 'sales.config.nav.sales',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  pageOrder: 410,
  icon: statusIcon,
  breadcrumb: [
    { label: 'Sales', labelKey: 'sales.config.nav.sales' },
  ],
} as const
