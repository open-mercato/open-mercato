import React from 'react'

const ssoIcon = React.createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['sso.config.view'],
  pageTitle: 'Single Sign-On',
  pageTitleKey: 'sso.admin.title',
  pageGroup: 'Auth',
  pageGroupKey: 'settings.sections.auth',
  pageOrder: 520,
  icon: ssoIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Single Sign-On', labelKey: 'sso.admin.title' }],
}
