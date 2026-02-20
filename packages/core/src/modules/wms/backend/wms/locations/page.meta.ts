import React from 'react'

const locationIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('rect', { x: 2, y: 2, width: 9, height: 9, rx: 1 }),
  React.createElement('rect', { x: 13, y: 2, width: 9, height: 9, rx: 1 }),
  React.createElement('rect', { x: 2, y: 13, width: 9, height: 9, rx: 1 }),
  React.createElement('rect', { x: 13, y: 13, width: 9, height: 9, rx: 1 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['wms.view'],
  pageTitle: 'Locations',
  pageTitleKey: 'wms.locations.list.title',
  pageGroup: 'WMS',
  pageGroupKey: 'wms.nav.group',
  pagePriority: 50,
  pageOrder: 20,
  icon: locationIcon,
  breadcrumb: [{ label: 'Locations', labelKey: 'wms.locations.list.title' }],
}
