export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.view'],
  pageTitle: 'Phase E-H handlers',
  pageTitleKey: 'example.menu.umesExtensions',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20600,
  icon: 'shapes',
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase E-H extensions', labelKey: 'example.umes.extensions.title' },
  ],
}

export default metadata
