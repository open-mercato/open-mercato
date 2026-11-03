import React from 'react'

const activityIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M3 12h4l3 8 4-16 3 8h4' }),
)

export const metadata = {
  icon: activityIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.runs.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Runs',
  pageTitleKey: 'marketing_automation.runs.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Campaigns', labelKey: 'marketing_automation.list.title', href: '/backend/marketing/campaigns' },
    { label: 'Runs', labelKey: 'marketing_automation.runs.title' },
  ],
}
