import React from 'react'

const activityIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('polyline', { points: '3 12 6 12 9 3 15 21 18 12 21 12' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['audit_logs.view_self'],
  pageTitle: 'Audit Logs',
  pageTitleKey: 'audit_logs.nav.title',
  pageGroup: 'Security',
  pageGroupKey: 'backend.nav.security',
  pageOrder: 160,
  icon: activityIcon,
  breadcrumb: [{ label: 'Audit Logs', labelKey: 'audit_logs.nav.title' }],
}
