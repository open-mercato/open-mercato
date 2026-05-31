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
  React.createElement('path', { d: 'm9 12 2 2 4-4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_quality.view'],
  pageTitle: 'Data Quality',
  pageTitleKey: 'data_quality.nav.title',
  pageGroup: 'Operations',
  pageGroupKey: 'backend.nav.operations',
  pageOrder: 70,
  icon: shieldCheckIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Data Quality', labelKey: 'data_quality.nav.title' }],
}
