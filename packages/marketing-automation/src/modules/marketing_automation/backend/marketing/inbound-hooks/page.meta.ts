import React from 'react'

const hookIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M9 17H7A5 5 0 0 1 7 7h2' }),
  React.createElement('path', { d: 'M15 7h2a5 5 0 0 1 0 10h-2' }),
  React.createElement('path', { d: 'M8 12h8' }),
)

export const metadata = {
  icon: hookIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.campaigns.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Inbound hooks',
  pageTitleKey: 'marketing_automation.hooks.title',
  breadcrumb: [
    { label: 'Inbound hooks', labelKey: 'marketing_automation.hooks.title' },
  ],
}
