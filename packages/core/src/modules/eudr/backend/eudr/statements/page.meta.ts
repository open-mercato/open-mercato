export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.statements.view'],
  pageTitle: 'Statements',
  pageTitleKey: 'eudr.nav.statements',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  pagePriority: 10,
  pageOrder: 30,
  icon: 'file-text',
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Statements', labelKey: 'eudr.nav.statements' },
  ],
}
