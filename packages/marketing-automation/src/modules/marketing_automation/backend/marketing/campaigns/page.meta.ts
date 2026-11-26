import React from 'react'

const megaphoneIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'm3 11 18-5v12L3 14v-3z' }),
  React.createElement('path', { d: 'M11.6 16.8a3 3 0 1 1-5.8-1.6' }),
)

export const metadata = {
  icon: megaphoneIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.campaigns.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Campaigns',
  pageTitleKey: 'marketing_automation.list.title',
  pageOrder: 10,
  breadcrumb: [{ label: 'Campaigns', labelKey: 'marketing_automation.list.title' }],
}
