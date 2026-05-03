import React from 'react'

// Boxes / inventory icon — visually conveys "material master data"
const materialsIcon = React.createElement(
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
  React.createElement('path', { d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' }),
  React.createElement('polyline', { points: '3.27 6.96 12 12.01 20.73 6.96' }),
  React.createElement('line', { x1: '12', y1: '22.08', x2: '12', y2: '12' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['materials.material.view'],
  pageTitle: 'Materials',
  pageTitleKey: 'materials.page.title',
  pageGroup: 'Materials',
  pageGroupKey: 'materials.nav.group',
  pagePriority: 65,
  pageOrder: 10,
  icon: materialsIcon,
  breadcrumb: [{ label: 'Materials', labelKey: 'materials.page.title' }],
}
