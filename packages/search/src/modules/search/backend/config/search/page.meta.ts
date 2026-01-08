import React from 'react'

const searchIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('circle', { cx: 11, cy: 11, r: 8 }),
  React.createElement('path', { d: 'm21 21-4.3-4.3' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['search.view'],
  pageTitle: 'Search Settings',
  pageTitleKey: 'search.config.nav.hybridSearch',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  pageOrder: 425,
  icon: searchIcon,
  breadcrumb: [
    { label: 'Search Settings', labelKey: 'search.config.nav.hybridSearch' },
  ],
} as const
