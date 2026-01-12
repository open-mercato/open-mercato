export const metadata = {
  requireAuth: true,
  requireFeatures: ['currencies.rates.view'],
  pageTitle: 'Exchange Rates',
  pageTitleKey: 'exchangeRates.page.title',
  pageGroup: 'Currencies',
  pageGroupKey: 'currencies.nav.group',
  pageOrder: 20,
  breadcrumb: [
    { label: 'Currencies', labelKey: 'currencies.page.title', href: '/backend/currencies' },
    { label: 'Exchange Rates', labelKey: 'exchangeRates.page.title' },
  ],
}
