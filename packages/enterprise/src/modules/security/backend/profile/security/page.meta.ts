import React from 'react'

const shieldCheckIcon = React.createElement(
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
  React.createElement('path', { d: 'M9 12l2 2 4-4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['security.profile.view'],
  pageTitle: 'Security & MFA',
  pageTitleKey: 'security.profile.pageTitle',
  pageGroup: 'Account',
  pageGroupKey: 'profile.sections.account',
  pageOrder: 40,
  icon: shieldCheckIcon,
  pageContext: 'profile' as const,
  breadcrumb: [
    { label: 'Profile', labelKey: 'auth.profile.title' },
    { label: 'Security & MFA', labelKey: 'security.profile.pageTitle' },
  ],
}
