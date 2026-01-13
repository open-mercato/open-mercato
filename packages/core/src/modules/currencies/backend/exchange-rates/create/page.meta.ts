import React from "react"

const createIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
  React.createElement('polyline', { points: '14 2 14 8 20 8' }),
  React.createElement('path', { d: 'M12 11v6M9 14h6' }),
)

export const metadata = {
  icon: createIcon,
  requireAuth: true,
  requireFeatures: ['currencies.rates.manage'],
  pageTitle: 'Create Exchange Rate',
  pageTitleKey: 'exchangeRates.create.title',
  pageGroup: 'Currencies',
  pageGroupKey: 'currencies.nav.group',
  breadcrumb: [
    { label: 'Currencies', labelKey: 'currencies.page.title', href: '/backend/currencies' },
    { label: 'Exchange Rates', labelKey: 'exchangeRates.page.title', href: '/backend/exchange-rates' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
