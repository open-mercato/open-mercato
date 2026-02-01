import React from 'react'

const cacheIcon = React.createElement(
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
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 6, rx: 2 }),
  React.createElement('path', { d: 'M5 6h.01' }),
  React.createElement('path', { d: 'M9 6h.01' }),
  React.createElement('path', { d: 'M21 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6' }),
  React.createElement('path', { d: 'M5 14h.01' }),
  React.createElement('path', { d: 'M9 14h.01' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['configs.cache.view'],
  pageTitle: 'Cache',
  pageTitleKey: 'configs.config.nav.cache',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  pageOrder: 125,
  icon: cacheIcon,
  breadcrumb: [
    { label: 'Cache', labelKey: 'configs.config.nav.cache' },
  ],
} as const
