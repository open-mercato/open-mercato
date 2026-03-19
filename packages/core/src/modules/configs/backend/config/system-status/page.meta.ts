import React from 'react'

const heartbeatIcon = React.createElement(
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
  React.createElement('path', { d: 'M4 12h3l2 4 4-8 2 4h5' }),
  React.createElement('path', { d: 'M21 8.5a6.5 6.5 0 0 0-13 0c0 4.5 6.5 9 6.5 9s6.5-4.5 6.5-9z' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['configs.system_status.view'],
  pageTitle: 'System status',
  pageTitleKey: 'configs.config.nav.systemStatus',
  pageGroup: 'System',
  pageGroupKey: 'settings.sections.system',
  pageOrder: 1,
  icon: heartbeatIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'System status', labelKey: 'configs.config.nav.systemStatus' },
  ],
} as const
