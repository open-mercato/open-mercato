import React from 'react'

const exchangeRateIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M7 16l-4-4 4-4' }),
  React.createElement('path', { d: 'M3 12h11' }),
  React.createElement('path', { d: 'M17 8l4 4-4 4' }),
  React.createElement('path', { d: 'M21 12H10' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['currencies.rates.view'],
  pageTitle: 'Exchange Rates',
  pageTitleKey: 'exchangeRates.page.title',
  pageGroup: 'Currencies',
  pageGroupKey: 'currencies.nav.group',
  pageOrder: 20,
  icon: exchangeRateIcon,
  breadcrumb: [
    { label: 'Currencies', labelKey: 'currencies.page.title', href: '/backend/currencies' },
    { label: 'Exchange Rates', labelKey: 'exchangeRates.page.title' },
  ],
}
