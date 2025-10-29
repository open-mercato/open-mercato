import React from 'react'

const vectorIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 6, cy: 6, r: 2 }),
  React.createElement('circle', { cx: 18, cy: 7, r: 2 }),
  React.createElement('circle', { cx: 12, cy: 18, r: 2 }),
  React.createElement('line', { x1: 7.7, y1: 6.9, x2: 16.2, y2: 7.7 }),
  React.createElement('line', { x1: 12, y1: 18, x2: 6, y2: 6 }),
  React.createElement('line', { x1: 12, y1: 18, x2: 18, y2: 7 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['vector.view'],
  pageTitle: 'Vector Search',
  pageTitleKey: 'vector.nav.vectorSearch',
  pageGroup: 'Data designer',
  pageGroupKey: 'entities.nav.group',
  pageOrder: 14,
  icon: vectorIcon,
}
