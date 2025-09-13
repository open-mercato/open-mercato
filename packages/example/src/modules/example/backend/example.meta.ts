export const metadata = {
  requireAuth: true,
  requireRoles: ['admin'] as const,
  pageTitle: 'Example Admin',
  pageGroup: 'Example',
  visible: (ctx: { auth?: any }) => (ctx.auth?.roles || []).includes('admin'),
}

