import React from 'react'

const icon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 11, cy: 11, r: 7 }),
  React.createElement('line', { x1: 16.65, y1: 16.65, x2: 21, y2: 21 }),
  React.createElement('line', { x1: 8, y1: 11, x2: 14, y2: 11 }),
  React.createElement('line', { x1: 11, y1: 8, x2: 11, y2: 14 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['vector_search.view'],
  pageTitle: 'Vector Search Index',
  pageTitleKey: 'vector_search.nav.index',
  pageGroup: 'Data Designer',
  pageGroupKey: 'entities.nav.group',
  pageOrder: 35,
  icon,
}
