import React from 'react'

const globeIcon = React.createElement(
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
  React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
  React.createElement('path', { d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' }),
  React.createElement('path', { d: 'M2 12h20' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['markets.manage'],
  pageTitle: 'Market display',
  pageTitleKey: 'markets.settings.title',
  pageGroup: 'Settings',
  pageGroupKey: 'backend.nav.settings',
  pageOrder: 320,
  icon: globeIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Settings', labelKey: 'backend.nav.settings', href: '/backend/settings' },
    { label: 'Market display', labelKey: 'markets.settings.title' },
  ],
}

export default metadata
