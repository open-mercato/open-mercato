import React from 'react'

const moduleTelemetryIcon = React.createElement(
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
  React.createElement('path', { d: 'M4 19V5' }),
  React.createElement('path', { d: 'M4 19h16' }),
  React.createElement('path', { d: 'M7 15l3-3 3 2 5-7' }),
  React.createElement('path', { d: 'M18 7h2v2' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['configs.system_status.view'],
  pageTitle: 'Module telemetry',
  pageTitleKey: 'configs.config.nav.moduleTelemetry',
  pageGroup: 'System',
  pageGroupKey: 'settings.sections.system',
  pageOrder: 2,
  icon: moduleTelemetryIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Module telemetry', labelKey: 'configs.config.nav.moduleTelemetry' },
  ],
} as const
