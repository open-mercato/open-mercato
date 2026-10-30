import React from 'react'

const flowIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('rect', { x: '3', y: '3', width: '6', height: '6', rx: '1' }),
  React.createElement('rect', { x: '15', y: '15', width: '6', height: '6', rx: '1' }),
  React.createElement('path', { d: 'M9 6h4a2 2 0 0 1 2 2v10' }),
)

export const metadata = {
  icon: flowIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.campaigns.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Campaign',
  pageTitleKey: 'marketing_automation.list.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Campaigns', labelKey: 'marketing_automation.list.title', href: '/backend/marketing/campaigns' },
  ],
}
