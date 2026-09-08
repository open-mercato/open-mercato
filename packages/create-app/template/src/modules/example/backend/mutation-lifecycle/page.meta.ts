export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.view'],
  pageTitle: 'Phase M — Mutation Lifecycle',
  pageTitleKey: 'example.menu.mutationLifecycle',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20700,
  icon: 'shield',
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase M — Mutation Lifecycle', labelKey: 'example.mutationLifecycle.title' },
  ],
}

export default metadata
