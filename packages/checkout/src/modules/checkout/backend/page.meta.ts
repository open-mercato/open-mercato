import React from 'react'

const creditCardIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 2, y: 5, width: 20, height: 14, rx: 2 }),
  React.createElement('path', { d: 'M2 10h20' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['checkout.view'],
  pageTitle: 'Checkout',
  pageGroup: 'Checkout',
  pageGroupKey: 'checkout.nav.group',
  pageOrder: 80,
  icon: creditCardIcon,
  breadcrumb: [{ label: 'Checkout' }],
}
