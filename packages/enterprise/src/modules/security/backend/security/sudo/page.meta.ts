import React from 'react'

const sudoIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z' }),
  React.createElement('circle', { cx: 10, cy: 12, r: 2.25 }),
  React.createElement('path', { d: 'M12.25 12h4.25' }),
  React.createElement('path', { d: 'M14.75 12v2' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['security.sudo.manage'],
  pageTitle: 'Sudo protection',
  pageTitleKey: 'security.admin.sudo.title',
  pageGroup: 'Security',
  pageGroupKey: 'settings.sections.security',
  pageOrder: 1,
  icon: sudoIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Security', labelKey: 'security.label' },
    { label: 'Sudo protection', labelKey: 'security.admin.sudo.title' },
  ],
}
