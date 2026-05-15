export const metadata = {
  requireAuth: true,
  requireFeatures: ['materials.material.view'],
  pageTitle: 'Material',
  pageTitleKey: 'materials.detail.title',
  pageGroup: 'Materials',
  pageGroupKey: 'materials.nav.group',
  hidden: true,
  breadcrumb: [
    { label: 'Materials', labelKey: 'materials.page.title', href: '/backend/materials' },
    { label: 'Detail', labelKey: 'materials.detail.breadcrumb' },
  ],
}
