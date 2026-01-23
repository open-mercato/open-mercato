import React from 'react'

const resourceTypesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M3 5h6l2 3h10v11H3z' }),
  React.createElement('path', { d: 'M3 5v14' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['resources.manage_resources'],
  pageTitle: 'Resource types',
  pageTitleKey: 'resources.resourceTypes.page.title',
  pageGroup: 'Resource planning',
  pageGroupKey: 'resources.nav.group',
  pageOrder: 30,
  icon: resourceTypesIcon,
  breadcrumb: [
    { label: 'Resource types', labelKey: 'resources.resourceTypes.page.title' },
  ],
}
