import React from 'react'

const settingsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('line', { x1: 4, y1: 5, x2: 4, y2: 21 }),
  React.createElement('line', { x1: 12, y1: 3, x2: 12, y2: 21 }),
  React.createElement('line', { x1: 20, y1: 7, x2: 20, y2: 21 }),
  React.createElement('circle', { cx: 4, cy: 9, r: 2 }),
  React.createElement('circle', { cx: 12, cy: 7, r: 2 }),
  React.createElement('circle', { cx: 20, cy: 11, r: 2 })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.settings.manage', 'customers.people.view'],
  pageTitle: 'Customers',
  pageTitleKey: 'customers.config.nav.customers',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  pageOrder: 400,
  icon: settingsIcon,
  breadcrumb: [
    { label: 'Customers', labelKey: 'customers.config.nav.customers' },
  ],
} as const
