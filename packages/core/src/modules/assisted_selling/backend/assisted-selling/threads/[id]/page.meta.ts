export const metadata = {
  requireAuth: true,
  requireFeatures: ['assisted_selling.threads.view', 'cart.proposals.view'],
  pageTitle: 'Selling conversation',
  pageTitleKey: 'assisted_selling.admin.thread.pageTitle',
  pageGroup: 'Ecommerce',
  pageGroupKey: 'cart.admin.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Selling conversations', labelKey: 'assisted_selling.admin.inbox.pageTitle', href: '/backend/assisted-selling' },
    { label: 'Selling conversation', labelKey: 'assisted_selling.admin.thread.pageTitle' },
  ],
}
