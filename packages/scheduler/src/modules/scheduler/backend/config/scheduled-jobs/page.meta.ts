import React from 'react'

const clockIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('circle', { cx: '12', cy: '12', r: '10' }),
  React.createElement('polyline', { points: '12 6 12 12 16 14' }),
)

export const metadata = {
  icon: clockIcon,
  requireAuth: true,
  requireFeatures: ['scheduler.jobs.view'],
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageTitle: 'Scheduled Jobs',
  pageTitleKey: 'scheduler.title',
  pageOrder: 30,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Scheduled Jobs', labelKey: 'scheduler.title' }],
}
