import React from 'react'

const demandIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M4 19V9m5 10V5m5 14v-7m5 7V11' }),
)

export const metadata = {
  icon: demandIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.runs.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Price watches',
  pageTitleKey: 'marketing_automation.demand.title',
  breadcrumb: [
    { label: 'Price watches', labelKey: 'marketing_automation.demand.title' },
  ],
}
