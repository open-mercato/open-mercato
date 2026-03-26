import React from 'react'

const syncIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }),
  React.createElement('path', { d: 'M3 3v5h5' }),
  React.createElement('path', { d: 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' }),
  React.createElement('path', { d: 'M16 16h5v5' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_sync.view'],
  pageTitle: 'Data Sync',
  pageTitleKey: 'data_sync.nav.title',
  pageGroup: 'External systems',
  pageGroupKey: 'backend.nav.externalSystems',
  pageOrder: 51,
  icon: syncIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Data Sync', labelKey: 'data_sync.nav.title' }],
}
