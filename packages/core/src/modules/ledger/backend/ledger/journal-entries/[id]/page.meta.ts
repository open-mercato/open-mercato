export const metadata = {
  requireAuth: true,
  requireFeatures: ['ledger.entries.view'],
  pageTitle: 'Journal Entry',
  pageTitleKey: 'ledger.journal_entries.detail.pageTitle',
  pageGroup: 'General Ledger',
  pageGroupKey: 'ledger.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Journal Entries', labelKey: 'ledger.journal_entries.page.title', href: '/backend/ledger/journal-entries' },
    { label: 'Journal Entry', labelKey: 'ledger.journal_entries.detail.pageTitle' },
  ],
}
