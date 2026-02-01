import React from 'react'

const orgIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M3 21v-4a2 2 0 0 1 2-2h4' }),
  React.createElement('path', { d: 'M15 15h4a2 2 0 0 1 2 2v4' }),
  React.createElement('path', { d: 'M7 17V9a2 2 0 0 1 2-2h6' }),
  React.createElement('rect', { x: 9, y: 3, width: 6, height: 6, rx: 1 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.organizations.view'],
  pageTitle: 'Organizations',
  pageTitleKey: 'directory.nav.organizations',
  pageGroup: 'Directory',
  pageGroupKey: 'directory.nav.group',
  pageOrder: 30,
  icon: orgIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Organizations', labelKey: 'directory.nav.organizations' }],
}
