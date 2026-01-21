export const metadata = {
  requireAuth: true,
  requireFeatures: ['resources.manage_resources'],
  pageTitle: 'Edit resource',
  pageTitleKey: 'resources.resources.form.editTitle',
  pageGroup: 'Resource planning',
  pageGroupKey: 'resources.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Resources', labelKey: 'resources.resources.page.title', href: '/backend/resources/resources' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
