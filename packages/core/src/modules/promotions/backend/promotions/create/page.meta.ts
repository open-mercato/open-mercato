export const metadata = {
  requireAuth: true,
  requireFeatures: ['promotions.create'],
  pageTitle: 'Create promotion',
  pageTitleKey: 'promotions.form.title.create',
  pageGroup: 'Promotions',
  pageGroupKey: 'promotions.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Promotions', labelKey: 'promotions.list.title', href: '/backend/promotions' },
    { label: 'Create promotion', labelKey: 'promotions.form.title.create' },
  ],
}
