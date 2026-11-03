export const metadata = {
  requireAuth: true,
  requireFeatures: ['promotions.codes.manage'],
  pageTitle: 'Promotional code details',
  pageTitleKey: 'promotions.codes.detail.title',
  pageGroup: 'Promotions',
  pageGroupKey: 'promotions.nav.group',
  navHidden: true,
  breadcrumb: [{ label: 'Promotional codes', labelKey: 'promotions.codes.list.title', href: '/backend/codes' }],
}
