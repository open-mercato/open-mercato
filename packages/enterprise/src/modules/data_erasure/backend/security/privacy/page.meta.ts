import React from 'react'

const privacyIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
  React.createElement('path', { d: 'M9 12l2 2 4-4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_erasure.manage'],
  pageTitle: 'Privacy and retention',
  pageTitleKey: 'data_erasure.page.title',
  pageGroup: 'Security',
  pageGroupKey: 'settings.sections.security',
  pageOrder: 4,
  icon: privacyIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Security', labelKey: 'data_erasure.breadcrumb.security' },
    { label: 'Privacy and retention', labelKey: 'data_erasure.page.title' },
  ],
}
