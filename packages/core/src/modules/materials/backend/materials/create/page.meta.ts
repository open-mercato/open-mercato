export const metadata = {
  requireAuth: true,
  requireFeatures: ['materials.material.manage'],
  pageTitle: 'New material',
  pageTitleKey: 'materials.create.title',
  pageGroup: 'Materials',
  pageGroupKey: 'materials.nav.group',
  hidden: true,
  breadcrumb: [
    { label: 'Materials', labelKey: 'materials.page.title', href: '/backend/materials' },
    { label: 'New', labelKey: 'materials.create.breadcrumb' },
  ],
}
