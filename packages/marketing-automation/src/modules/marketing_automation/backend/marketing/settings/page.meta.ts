import React from 'react'

const settingsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
  React.createElement('path', { d: 'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10l2 2M19 5l-2 2M7 17l-2 2' }),
)

export const metadata = {
  icon: settingsIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.manage'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Marketing settings',
  pageTitleKey: 'marketing_automation.settings.title',
  breadcrumb: [
    { label: 'Marketing settings', labelKey: 'marketing_automation.settings.title' },
  ],
}
