export const metadata = {
    requireAuth: true,
    requireRoles: ['superadmin'],
    pageTitle: 'Feature Toggle Overrides',
    pageTitleKey: 'feature_toggles.nav.global.overrides',
    pageContext: 'admin' as const,
    breadcrumb: [ { label: 'Global', labelKey: 'feature_toggles.nav.global', href: '/backend/feature-toggles/global' }, { label: 'Feature Toggle Overrides', labelKey: 'feature_toggles.nav.global.overrides' } ],
  }
  
  
  