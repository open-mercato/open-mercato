export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.credit_memos.view'],
  pageTitle: 'Credit Memo Detail',
  pageTitleKey: 'sales.credit_memos.detail.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Credit Memos', labelKey: 'sales.credit_memos.title', href: '/backend/sales/credit-memos' },
    { label: 'Detail' },
  ],
} as const
