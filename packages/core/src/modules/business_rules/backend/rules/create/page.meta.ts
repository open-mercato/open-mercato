export const metadata = {
  requireAuth: true,
  requireFeatures: ['business_rules.create'],
  pageTitle: 'Create Business Rule',
  pageGroup: 'Business Rules',
    pageGroupKey: 'rules.nav.group',
    pageContext: 'settings' as const,
    breadcrumb: [{ label: 'Business Rules', labelKey: 'rules.nav.rules' }, { label: 'Create Business Rule' }],
}
