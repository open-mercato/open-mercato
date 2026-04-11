export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.credit_memos.manage'],
  pageTitle: 'Credit Memo Detail',
  pageTitleKey: 'sales.credit_memos.detail.title',
  hidden: true,
  breadcrumb: [
    { label: 'Credit Memos', labelKey: 'sales.credit_memos.title', href: '/backend/sales/credit-memos' },
    { label: 'Detail' },
  ],
} as const
