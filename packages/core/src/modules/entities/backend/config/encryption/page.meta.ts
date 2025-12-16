import React from 'react'

const lockIcon = React.createElement(
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
  React.createElement('rect', { x: 3, y: 11, width: 18, height: 11, rx: 2, ry: 2 }),
  React.createElement('path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['entities.definitions.manage'],
  pageTitle: 'Encryption',
  pageTitleKey: 'entities.encryption.title',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  pageOrder: 130,
  icon: lockIcon,
  breadcrumb: [
    { label: 'Encryption', labelKey: 'entities.encryption.title' },
  ],
} as const
