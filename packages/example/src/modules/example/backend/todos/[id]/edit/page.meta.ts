export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.manage'],
  pageTitle: 'Edit Todo',
  pageTitleKey: 'example.todos.edit.title',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  breadcrumb: [
    { label: 'Todos', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Edit', labelKey: 'example.todos.edit.title' },
  ],
}
