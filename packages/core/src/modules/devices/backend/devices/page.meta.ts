import React from 'react'

const deviceIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 5, y: 2, width: 14, height: 20, rx: 2, ry: 2 }),
  React.createElement('path', { d: 'M12 18h.01' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['devices.admin'],
  pageTitle: 'Devices',
  pageTitleKey: 'devices.nav.devices',
  pageGroup: 'Auth',
  pageGroupKey: 'settings.sections.auth',
  pageOrder: 4,
  icon: deviceIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Devices', labelKey: 'devices.nav.devices' }],
}
