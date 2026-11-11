import React from 'react'

const resultsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M3 3v18h18' }),
  React.createElement('path', { d: 'M7 15l4-6 4 3 4-7' }),
)

export const metadata = {
  icon: resultsIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.runs.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Results',
  pageTitleKey: 'marketing_automation.results.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Campaigns', labelKey: 'marketing_automation.list.title', href: '/backend/marketing/campaigns' },
    { label: 'Results', labelKey: 'marketing_automation.results.title' },
  ],
}
