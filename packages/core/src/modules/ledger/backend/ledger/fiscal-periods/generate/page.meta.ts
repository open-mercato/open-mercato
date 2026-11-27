export const metadata = {
  requireAuth: true,
  requireFeatures: ['ledger.periods.manage'],
  pageTitle: 'Generate 12 months',
  pageTitleKey: 'ledger.fiscal_periods.generate.title',
  pageGroup: 'General Ledger',
  pageGroupKey: 'ledger.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Fiscal Periods', labelKey: 'ledger.fiscal_periods.page.title', href: '/backend/ledger/fiscal-periods' },
    { label: 'Generate 12 months', labelKey: 'ledger.fiscal_periods.generate.title' },
  ],
}
