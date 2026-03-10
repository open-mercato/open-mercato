import React from 'react'

const creditCardIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('rect', { width: 22, height: 16, x: 1, y: 4, rx: 2 }),
  React.createElement('line', { x1: 1, x2: 23, y1: 10, y2: 10 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.backend'],
  pageTitle: 'Payment Gateway Demo',
  pageTitleKey: 'example.payments.title',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20010,
  icon: creditCardIcon,
}

export default metadata
