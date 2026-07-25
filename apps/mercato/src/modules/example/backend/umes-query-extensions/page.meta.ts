export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.view'],
  pageTitle: 'Phase N query extensions',
  pageTitleKey: 'example.menu.umesQueryExtensions',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20800,
  icon: 'database',
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase N query extensions', labelKey: 'example.umes.queryExtensions.title' },
  ],
}

export default metadata
