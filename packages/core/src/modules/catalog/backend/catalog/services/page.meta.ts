import React from 'react'

const servicesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M10 6h4' }),
  React.createElement('path', { d: 'M12 4v4' }),
  React.createElement('rect', { x: 4, y: 8, width: 16, height: 12, rx: 2 }),
  React.createElement('path', { d: 'M8 12h8' }),
  React.createElement('path', { d: 'M8 16h5' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.services.view'],
  pageTitle: 'Services',
  pageTitleKey: 'catalog.services.page.title',
  pageGroup: 'Catalog',
  pageGroupKey: 'catalog.nav.group',
  pagePriority: 30,
  pageOrder: 110,
  icon: servicesIcon,
  breadcrumb: [{ label: 'Services', labelKey: 'catalog.services.page.title' }],
}
