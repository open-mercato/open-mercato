import React from 'react'

const locationIcon = React.createElement(
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
  React.createElement('path', { d: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' }),
  React.createElement('circle', { cx: '12', cy: '10', r: '3' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['fms_locations.ports.view'],
  pageTitle: 'Ports',
  pageTitleKey: 'fms_locations.nav.ports',
  pageGroup: 'FMS',
  pageGroupKey: 'fms_quotes.nav.group',
  pagePriority: 50,
  pageOrder: 110,
  icon: locationIcon,
  breadcrumb: [{ label: 'Ports', labelKey: 'fms_locations.nav.ports' }],
}
