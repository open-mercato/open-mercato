export const metadata = {
    requireAuth: true,
    requireRoles: ['superadmin'],
    pageTitle: 'Edit Global',
    pageTitleKey: 'feature_toggles.nav.global.edit',
    pageContext: 'admin' as const,
    breadcrumb: [ { label: 'Global', labelKey: 'feature_toggles.nav.global', href: '/backend/feature-toggles/global' }, { label: 'Edit', labelKey: 'feature_toggles.nav.global.edit' } ],
  }
  
  
  