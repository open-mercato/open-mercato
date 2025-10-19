import React from 'react'

const icon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M12 20h9' }),
  React.createElement('path', { d: 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['dictionaries.manage', 'dictionaries.view'],
  pageTitle: 'Dictionaries',
  pageTitleKey: 'dictionaries.config.nav.title',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  pageOrder: 410,
  icon,
  breadcrumb: [
    { label: 'Dictionaries', labelKey: 'dictionaries.config.nav.title' },
  ],
} as const
