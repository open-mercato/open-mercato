import React from 'react'

const cardIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 2, y: 5, width: 20, height: 14, rx: 2 }),
  React.createElement('path', { d: 'M2 10h20' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['payment_gateways.view'],
  pageTitle: 'Payment Transactions',
  pageTitleKey: 'payment_gateways.nav.transactions',
  pageGroup: 'Payments',
  pageGroupKey: 'payment_gateways.nav.paymentsGroup',
  pageOrder: 10,
  icon: cardIcon,
  breadcrumb: [{ label: 'Payment Transactions', labelKey: 'payment_gateways.nav.transactions' }],
}
