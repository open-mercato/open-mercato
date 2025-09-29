export const metadata = {
  requireAuth: true,
  requireRoles: ['admin'] as const,
  pageTitle: 'Edit Todo',
  breadcrumb: [
    { label: 'Todos', href: '/backend/todos' },
    { label: 'Edit' },
  ],
}
