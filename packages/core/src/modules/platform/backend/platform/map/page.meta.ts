import React from 'react'

const mapIcon = React.createElement(
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
  React.createElement('path', { d: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z' }),
  React.createElement('path', { d: 'M9 3v15' }),
  React.createElement('path', { d: 'M15 6v15' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['platform.inspect.view'],
  pageTitle: 'Platform map',
  pageTitleKey: 'platform.map.pageTitle',
  pageGroup: 'Developer',
  pageGroupKey: 'platform.map.pageGroup',
  pageOrder: 90,
  icon: mapIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Platform map', labelKey: 'platform.map.pageTitle' },
  ],
} as const
