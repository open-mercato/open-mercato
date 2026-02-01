import React from 'react'

const shieldIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['auth.roles.list'],
  pageTitle: 'Roles',
  pageTitleKey: 'auth.nav.roles',
  pageGroup: 'Auth',
  pageGroupKey: 'auth.nav.group',
  pageOrder: 110,
  icon: shieldIcon,
  pageContext: 'settings' as const,
  breadcrumb: [ { label: 'Roles', labelKey: 'auth.nav.roles' } ],
}

