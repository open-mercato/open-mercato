export const metadata = {
  requireAuth: true,
  requireFeatures: ['ledger.periods.manage'],
  pageTitle: 'Create Fiscal Period',
  pageTitleKey: 'ledger.fiscal_periods.create.title',
  pageGroup: 'General Ledger',
  pageGroupKey: 'ledger.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Fiscal Periods', labelKey: 'ledger.fiscal_periods.page.title', href: '/backend/ledger/fiscal-periods' },
    { label: 'Create', labelKey: 'ledger.fiscal_periods.create.title' },
  ],
}
