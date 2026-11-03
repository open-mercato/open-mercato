import React from 'react'

const profileIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 12, cy: 7, r: 4 }),
)

export const metadata = {
  icon: profileIcon,
  requireAuth: true,
  // Both, for the same reason the API requires both: this page names a person and reports behaviour.
  requireFeatures: ['marketing_automation.runs.view', 'customers.people.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Customer profile',
  pageTitleKey: 'marketing_automation.profile.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Campaigns', labelKey: 'marketing_automation.list.title', href: '/backend/marketing/campaigns' },
    { label: 'Customer profile', labelKey: 'marketing_automation.profile.title' },
  ],
}
