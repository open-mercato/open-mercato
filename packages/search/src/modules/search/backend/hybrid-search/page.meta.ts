import React from 'react'

const hybridSearchIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  // Search circle
  React.createElement('circle', { cx: 11, cy: 11, r: 8 }),
  // Search handle
  React.createElement('path', { d: 'm21 21-4.3-4.3' }),
  // Small dots representing multiple strategies
  React.createElement('circle', { cx: 8, cy: 9, r: 1.5, fill: 'currentColor', stroke: 'none' }),
  React.createElement('circle', { cx: 11, cy: 13, r: 1.5, fill: 'currentColor', stroke: 'none' }),
  React.createElement('circle', { cx: 14, cy: 9, r: 1.5, fill: 'currentColor', stroke: 'none' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['search.view'],
  pageTitle: 'Search',
  pageTitleKey: 'search.nav.hybridSearch',
  pageGroup: 'Data designer',
  pageGroupKey: 'entities.nav.group',
  pageOrder: 15,
  icon: hybridSearchIcon,
  // Settings panel requires additional permissions (checked at component level)
  // search.embeddings.manage - for changing embedding provider
  // search.reindex - for reindexing data
}
