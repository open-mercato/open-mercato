import React from 'react'

const enforcementIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
  React.createElement('path', { d: 'M12 8v5' }),
  React.createElement('circle', { cx: 12, cy: 16, r: 1 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['security.admin.manage'],
  pageTitle: 'MFA enforcement',
  pageTitleKey: 'security.admin.enforcement.title',
  pageGroup: 'Security',
  pageGroupKey: 'settings.sections.security',
  pageOrder: 1,
  icon: enforcementIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Security', labelKey: 'security.label' },
    { label: 'MFA enforcement', labelKey: 'security.admin.enforcement.title' },
  ],
}
