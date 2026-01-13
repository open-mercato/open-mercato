export const metadata = {
  requireAuth: true,
  requireFeatures: ['currencies.rates.manage'],
  pageTitle: 'Edit Exchange Rate',
  pageTitleKey: 'exchangeRates.edit.title',
  breadcrumb: [
    { label: 'Currencies', labelKey: 'currencies.page.title', href: '/backend/currencies' },
    { label: 'Exchange Rates', labelKey: 'exchangeRates.page.title', href: '/backend/exchange-rates' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
