export const metadata = {
  requireAuth: true,
  requireRoles: ['admin'] as const,
  pageTitle: 'Create Todo',
  pageGroup: 'Example',
  pageOrder: 2,
  icon: 'checkbox',
  breadcrumb: [
    { label: 'Todos', href: '/backend/todos' },
    { label: 'Create' },
  ],
}
