export const metadata = {
  requireAuth: true,
  requireFeatures: ['promotions.codes.manage'],
  pageTitle: 'Create promotional code',
  pageTitleKey: 'promotions.codes.form.title.create',
  pageGroup: 'Promotions',
  pageGroupKey: 'promotions.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Promotional codes', labelKey: 'promotions.codes.list.title', href: '/backend/codes' },
    { label: 'Create promotional code', labelKey: 'promotions.codes.form.title.create' },
  ],
}
