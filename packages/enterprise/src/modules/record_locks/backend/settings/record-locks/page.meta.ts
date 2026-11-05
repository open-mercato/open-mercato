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
  React.createElement('rect', { x: 5, y: 11, width: 14, height: 10, rx: 2, ry: 2 }),
  React.createElement('path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['record_locks.manage'],
  pageTitle: 'Record Locking',
  pageTitleKey: 'record_locks.settings.title',
  pageGroup: 'Settings',
  pageGroupKey: 'backend.nav.settings',
  pageOrder: 280,
  icon: lockIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Record Locking', labelKey: 'record_locks.settings.title' }],
}
