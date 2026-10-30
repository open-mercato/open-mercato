import React from 'react'

const segmentIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('circle', { cx: 9, cy: 12, r: 6 }),
  React.createElement('circle', { cx: 15, cy: 12, r: 6 }),
)

export const metadata = {
  icon: segmentIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.campaigns.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Segments',
  pageTitleKey: 'marketing_automation.segments.title',
  breadcrumb: [
    { label: 'Segments', labelKey: 'marketing_automation.segments.title' },
  ],
}
