import React from 'react'

const tenantsIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M3 21h18' }),
  React.createElement('path', { d: 'M5 21V7a2 2 0 0 1 2-2h4v16' }),
  React.createElement('path', { d: 'M13 21V9h4a2 2 0 0 1 2 2v10' }),
  React.createElement('path', { d: 'M9 21v-6h4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.tenants.view'],
  pageTitle: 'Tenants',
  pageTitleKey: 'directory.nav.tenants',
  pageGroup: 'Directory',
  pageGroupKey: 'directory.nav.group',
  pageOrder: 20,
  icon: tenantsIcon,
  pageContext: 'admin' as const,
  breadcrumb: [{ label: 'Tenants', labelKey: 'directory.nav.tenants' }],
}
