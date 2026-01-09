import React from 'react'

const quoteIcon = React.createElement(
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
  React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
  React.createElement('polyline', { points: '14 2 14 8 20 8' }),
  React.createElement('line', { x1: '16', y1: '13', x2: '8', y2: '13' }),
  React.createElement('line', { x1: '16', y1: '17', x2: '8', y2: '17' }),
  React.createElement('polyline', { points: '10 9 9 9 8 9' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['fms_quotes.quotes.view'],
  pageTitle: 'Freight Quotes',
  pageTitleKey: 'fms_quotes.nav.quotes',
  pageGroup: 'FMS',
  pageGroupKey: 'fms_quotes.nav.group',
  pagePriority: 50,
  pageOrder: 100,
  icon: quoteIcon,
  breadcrumb: [{ label: 'Freight Quotes', labelKey: 'fms_quotes.nav.quotes' }],
}
