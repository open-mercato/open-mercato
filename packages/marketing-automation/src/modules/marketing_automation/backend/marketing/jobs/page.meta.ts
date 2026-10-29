import React from 'react'

const jobsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
  React.createElement('path', { d: 'M12 7v5l3 2' }),
)

export const metadata = {
  icon: jobsIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.runs.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Background jobs',
  pageTitleKey: 'marketing_automation.jobs.title',
  breadcrumb: [
    { label: 'Background jobs', labelKey: 'marketing_automation.jobs.title' },
  ],
}
