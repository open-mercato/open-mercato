export const metadata = {
  requireAuth: true,
  requireFeatures: ['resources.manage_resources'],
  pageTitle: 'Edit resource',
  pageTitleKey: 'resources.resource.form.editTitle',
  pageGroup: 'Resource planning',
  pageGroupKey: 'resources.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Resources', labelKey: 'resources.resource.page.title', href: '/backend/resources/resources' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
