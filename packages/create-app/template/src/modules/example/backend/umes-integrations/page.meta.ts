export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.view'],
  pageTitle: 'Phase L integrations',
  pageTitleKey: 'example.menu.umesIntegrations',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20700,
  icon: 'link',
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase L integrations', labelKey: 'example.umes.integrations.title' },
  ],
}

export default metadata
