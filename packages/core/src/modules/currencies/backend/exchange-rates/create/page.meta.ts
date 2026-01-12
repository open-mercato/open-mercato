export const metadata = {
  requireAuth: true,
  requireFeatures: ['currencies.rates.manage'],
  pageTitle: 'Create Exchange Rate',
  pageTitleKey: 'exchangeRates.create.title',
  breadcrumb: [
    { label: 'Currencies', labelKey: 'currencies.page.title', href: '/backend/currencies' },
    { label: 'Exchange Rates', labelKey: 'exchangeRates.page.title', href: '/backend/exchange-rates' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
