import React from 'react'

const pipelineIcon = React.createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('rect', { x: 3, y: 4, width: 5, height: 16, rx: 1 }),
  React.createElement('rect', { x: 10, y: 4, width: 5, height: 16, rx: 1 }),
  React.createElement('rect', { x: 17, y: 4, width: 4, height: 16, rx: 1 })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.deals.view'],
  pageTitle: 'Sales Pipeline',
  pageTitleKey: 'customers.nav.deals.pipeline',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pagePriority: 10,
  pageOrder: 121,
  icon: pipelineIcon,
  breadcrumb: [
    { label: 'Deals', labelKey: 'customers.nav.deals', href: '/backend/customers/deals' },
    { label: 'Sales Pipeline', labelKey: 'customers.nav.deals.pipeline' },
  ],
}

