import React from 'react'

const referralIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('circle', { cx: 18, cy: 5, r: 3 }),
  React.createElement('circle', { cx: 6, cy: 12, r: 3 }),
  React.createElement('circle', { cx: 18, cy: 19, r: 3 }),
  React.createElement('path', { d: 'M8.6 13.5l6.8 4M15.4 6.5l-6.8 4' }),
)

export const metadata = {
  icon: referralIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.runs.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Referrals',
  pageTitleKey: 'marketing_automation.referrals.title',
  breadcrumb: [
    { label: 'Referrals', labelKey: 'marketing_automation.referrals.title' },
  ],
}
